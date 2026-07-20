import { clipboard, dialog, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import {
  accessibilityDegradeNote,
  isAccessibilityResolveSupported,
  resolveAccessibilityTarget,
} from './accessibility-resolve';
import { getActiveDisplayBounds } from './active-display';
import { WalkthroughAutoAdvance } from './auto-advance';
import { postWalkthroughCompletion } from './completion-client';
import { readForegroundBrowserUrl } from './foreground-url';
import { resolveOcrTarget } from './ocr-resolve';
import { WalkthroughOverlayWindow } from './overlay-window';
import { formatAgentPromptDocument, hasCompleteCoachingSections } from './prompt-export';
import { shouldApplyResolution } from './resolve-failure';
import {
  appendStepTiming,
  retractFrictionToStep,
  retractTimingsToStep,
  totalDurationSeconds,
} from './step-timing';
import { resolvePlaybackTarget } from './target-resolve';
import type {
  FrictionEvent,
  StepTiming,
  WalkthroughPayload,
  WalkthroughStatus,
  WalkthroughStep,
  WalkthroughUiState,
} from './types';
import { resolveStepPageUrl } from './step-navigation';
import { learnFromStepTransition, resolvePlaybackTargetUrl } from './walkthrough-url-resolve';
import { resetVisionSessionGate, resolveVisionGridOnScreen } from './vision-locate-client';
import { parseVoiceCommand, voiceCommandToAction } from './voice-commands';

export class WalkthroughService {
  private status: WalkthroughStatus = 'idle';
  private payload: WalkthroughPayload | null = null;
  private stepIndex = 0;
  private visitEnteredAt: number | null = null;
  private visitStepNumber: number | null = null;
  private lastEnteredStepIndex: number | null = null;
  private missFrictionStepIndex: number | null = null;
  private stepTimings: StepTiming[] = [];
  private frictionEvents: FrictionEvent[] = [];
  private lastResolvedNote: string | null = null;
  private lastHighlight: WalkthroughUiState['highlight'] = null;
  private exportPreview: string | null = null;
  private error: string | null = null;
  private advanceArmed = true;
  /** Bumped on every step enter so stale async resolve results are discarded. */
  private resolveGeneration = 0;
  /** Ignore global-hook auto-advance while UI Previous/Next/Finish is in flight. */
  private ignoreAutoAdvanceUntil = 0;
  /** Last URL opened for a step (re-open when Previous/Next changes target). */
  private lastOpenedUrl: string | null = null;
  /** Serialize Previous/Next so overlapping clicks cannot race stepIndex. */
  private navInFlight = false;
  /** Session map: generalized resource template -> live absolute URL (extension parity). */
  private resolvedUrls: Record<string, string> = {};
  /** Note when we refuse to reopen a stale recorded dynamic URL. */
  private urlNavNote: string | null = null;

  private readonly overlay = new WalkthroughOverlayWindow();
  private readonly autoAdvance = new WalkthroughAutoAdvance();

  isPlaying(): boolean {
    return this.status === 'playing';
  }

  getUiState(): WalkthroughUiState {
    const steps = this.payload?.steps ?? [];
    const step = steps[this.stepIndex] ?? null;
    const exportAvailable = hasCompleteCoachingSections(this.payload?.coaching_sections);
    const noteParts = [this.lastResolvedNote, this.urlNavNote].filter((part): part is string =>
      Boolean(part && part.trim()),
    );

    return {
      status: this.status,
      sopId: this.payload?.sop_id ?? null,
      stepIndex: this.stepIndex,
      stepCount: steps.length,
      instruction: step?.instruction ?? '',
      eyebrow: steps.length > 0 ? `Step ${this.stepIndex + 1} of ${steps.length}` : 'Walkthrough',
      screenshotUrl: step?.screenshot_url ?? null,
      fallbackNote: noteParts.length > 0 ? noteParts.join(' ') : null,
      highlight: this.lastHighlight,
      previousDisabled: this.stepIndex <= 0 || this.navInFlight,
      isLastStep: steps.length > 0 && this.stepIndex >= steps.length - 1,
      navBusy: this.navInFlight,
      exportAvailable,
      exportPreview: this.exportPreview,
      error: this.error,
    };
  }

  async start(payload: WalkthroughPayload): Promise<WalkthroughUiState> {
    if (!payload?.sop_id || !Array.isArray(payload.steps) || payload.steps.length === 0) {
      throw new Error('Walkthrough payload is missing sop_id or steps');
    }

    this.payload = payload;
    this.status = 'playing';
    this.stepIndex = 0;
    this.resetVisitBookkeeping();
    this.stepTimings = [];
    this.frictionEvents = [];
    this.exportPreview = null;
    this.error = null;
    this.advanceArmed = true;
    this.resolveGeneration = 0;
    this.ignoreAutoAdvanceUntil = 0;
    this.lastOpenedUrl = null;
    this.navInFlight = false;
    this.resolvedUrls = {};
    this.urlNavNote = null;
    resetVisionSessionGate();

    if (!isAccessibilityResolveSupported()) {
      console.info(
        `[walkthrough] starting on ${process.platform}: a11y is Windows-only; ` +
          'OCR + vision-only mode for this session',
      );
    }

    const display = await getActiveDisplayBounds();
    this.overlay.coverDisplay(display);
    // Wait until walkthrough.html has loaded and can receive IPC, otherwise the
    // first walkthrough:state is dropped and the overlay stays blank/transparent.
    await this.overlay.awaitReady();
    this.overlay.show();

    this.autoAdvance.start(() => {
      void this.handleAutoAdvance();
    });

    await this.enterCurrentStep();
    return this.publish();
  }

  async previous(): Promise<WalkthroughUiState> {
    if (this.status !== 'playing' || this.stepIndex <= 0 || !this.payload || this.navInFlight) {
      return this.publish();
    }

    this.navInFlight = true;
    this.publish();
    try {
      const destinationIndex = this.stepIndex - 1;
      const destinationStep = this.payload.steps[destinationIndex];
      const destinationStepNumber = destinationStep?.step_number ?? destinationIndex + 1;

      this.learnLiveResourceUrlFromForeground();
      this.abandonCurrentStep();
      this.stepTimings = retractTimingsToStep(this.stepTimings, destinationStepNumber);
      this.frictionEvents = retractFrictionToStep(this.frictionEvents, destinationStepNumber);
      this.stepIndex = destinationIndex;
      this.lastHighlight = null;
      this.lastResolvedNote = null;
      this.urlNavNote = null;
      this.suppressAutoAdvance();
      this.advanceArmed = false;
      // Paint step copy immediately; resolve can take seconds.
      this.publish();
      console.info(`[walkthrough] Previous -> step ${this.stepIndex + 1}`);
      await this.enterCurrentStep();
      this.advanceArmed = true;
      return this.publish();
    } finally {
      this.navInFlight = false;
      this.publish();
    }
  }

  async next(): Promise<WalkthroughUiState> {
    if (this.status !== 'playing' || !this.payload || this.navInFlight) {
      return this.publish();
    }

    if (this.stepIndex >= this.payload.steps.length - 1) {
      return this.finish();
    }

    this.navInFlight = true;
    this.publish();
    try {
      // Tooltip Next is itself a global click; without this, auto-advance fires
      // on the same click and skips an extra step (2 -> 4).
      this.suppressAutoAdvance();
      this.learnLiveResourceUrlFromForeground();
      this.leaveCurrentStep();
      this.stepIndex += 1;
      this.lastHighlight = null;
      this.lastResolvedNote = null;
      this.urlNavNote = null;
      this.advanceArmed = false;
      this.publish();
      console.info(`[walkthrough] Next -> step ${this.stepIndex + 1}`);
      await this.enterCurrentStep();
      this.advanceArmed = true;
      return this.publish();
    } finally {
      this.navInFlight = false;
      this.publish();
    }
  }

  async finish(): Promise<WalkthroughUiState> {
    // Complete screen Finish/Close should dismiss, not re-POST completion.
    if (this.status === 'finished') {
      await this.dismiss();
      return this.getUiState();
    }

    if (!this.payload || this.status !== 'playing') {
      return this.publish();
    }

    this.leaveCurrentStep();
    this.autoAdvance.stop();
    this.resolveGeneration += 1;

    const result = await postWalkthroughCompletion({
      sop_id: this.payload.sop_id,
      completed_at: new Date().toISOString(),
      duration_seconds: totalDurationSeconds(this.stepTimings),
      friction_events: this.frictionEvents,
      step_timings: this.stepTimings,
    });

    if (!result.ok) {
      this.error = result.error ?? 'Failed to report walkthrough completion';
    }

    this.exportPreview = hasCompleteCoachingSections(this.payload.coaching_sections)
      ? formatAgentPromptDocument(this.payload.coaching_sections)
      : null;

    this.status = 'finished';
    this.lastHighlight = null;
    return this.publish();
  }

  async dismiss(): Promise<void> {
    this.autoAdvance.stop();
    this.resolveGeneration += 1;
    this.overlay.hide();
    this.overlay.destroy();
    this.status = 'idle';
    this.payload = null;
    this.exportPreview = null;
    this.resetVisitBookkeeping();
  }

  async handleVoiceTranscript(transcript: string): Promise<WalkthroughUiState> {
    const command = parseVoiceCommand(transcript);
    if (!command) {
      return this.publish();
    }

    const action = voiceCommandToAction(command);
    if (action === 'previous') {
      return this.previous();
    }
    if (action === 'next') {
      return this.next();
    }
    if (action === 'finish') {
      return this.finish();
    }
    if (action === 'repeat') {
      // Replay instruction only: no new resolve / vision / LLM call.
      return this.publish();
    }

    return this.publish();
  }

  async copyExport(): Promise<{ ok: boolean; error?: string }> {
    if (!this.exportPreview) {
      return { ok: false, error: 'No agent prompt available to export' };
    }
    clipboard.writeText(this.exportPreview);
    return { ok: true };
  }

  async saveExport(): Promise<{ ok: boolean; path?: string; error?: string }> {
    if (!this.exportPreview) {
      return { ok: false, error: 'No agent prompt available to export' };
    }

    const result = await dialog.showSaveDialog({
      title: 'Save agent prompt',
      defaultPath: 'agent-prompt.md',
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, error: 'Save cancelled' };
    }

    await writeFile(result.filePath, this.exportPreview, 'utf8');
    return { ok: true, path: result.filePath };
  }

  setTooltipHitTesting(enabled: boolean): void {
    void enabled;
    // Panel window always receives clicks; spotlight stays click-through.
  }

  /** Called from preload before Previous/Next/Finish IPC (beats uIOhook race). */
  armUiNavigationGuard(): void {
    this.suppressAutoAdvance(2500);
  }

  private suppressAutoAdvance(ms = 800): void {
    this.ignoreAutoAdvanceUntil = Date.now() + ms;
  }

  private async handleAutoAdvance(): Promise<void> {
    if (this.status !== 'playing' || !this.advanceArmed || this.navInFlight) {
      return;
    }
    if (Date.now() < this.ignoreAutoAdvanceUntil) {
      return;
    }
    // Only auto-advance on a real target action, not UI chrome.
    this.suppressAutoAdvance();
    this.advanceArmed = false;
    await this.next();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private abandonCurrentStep(): void {
    this.visitEnteredAt = null;
    this.visitStepNumber = null;
  }

  private leaveCurrentStep(): void {
    if (this.visitEnteredAt == null || this.visitStepNumber == null) {
      return;
    }

    this.stepTimings = appendStepTiming(
      this.stepTimings,
      this.visitStepNumber,
      Date.now() - this.visitEnteredAt,
    );
    this.abandonCurrentStep();
  }

  private async enterCurrentStep(): Promise<void> {
    const step = this.currentStep();
    if (!step || !this.payload) {
      return;
    }

    const stepNumber = step.step_number ?? this.stepIndex + 1;
    const generation = ++this.resolveGeneration;

    if (this.lastEnteredStepIndex !== this.stepIndex) {
      this.missFrictionStepIndex = null;
      this.visitEnteredAt = Date.now();
      this.visitStepNumber = stepNumber;
      this.lastEnteredStepIndex = this.stepIndex;
    } else if (this.visitEnteredAt == null) {
      this.visitEnteredAt = Date.now();
      this.visitStepNumber = stepNumber;
    }

    this.autoAdvance.setExpectedAction(step.expected_action ?? 'click');

    // 1) Align the live page (URL), 2) place overlay on the active display,
    // 3) wait briefly so navigation can settle, 4) re-identify target.
    const openedUrl = this.maybeOpenInstructionUrl(step);
    const display = await getActiveDisplayBounds();
    this.overlay.coverDisplay(display);
    this.overlay.show();

    if (openedUrl) {
      await this.sleep(900);
    }
    if (!shouldApplyResolution(generation, this.resolveGeneration)) {
      return;
    }

    let cloaked = false;
    const ensureCloak = () => {
      if (!cloaked) {
        cloaked = true;
        this.overlay.setCaptureCloak(true);
      }
    };
    const clearCloak = () => {
      if (cloaked) {
        cloaked = false;
        this.overlay.setCaptureCloak(false);
      }
    };

    let resolved;
    try {
      resolved = await resolvePlaybackTarget(step, display, {
        a11yAvailable: isAccessibilityResolveSupported(),
        a11yDegradeNote: accessibilityDegradeNote(),
        resolveAccessibility: async (liveStep) => resolveAccessibilityTarget(liveStep),
        resolveOcr: async (liveStep) => {
          ensureCloak();
          return resolveOcrTarget(liveStep, display);
        },
        resolveVisionGrid: async (liveStep) => {
          ensureCloak();
          return resolveVisionGridOnScreen(liveStep, display);
        },
      });
    } finally {
      clearCloak();
    }

    if (!shouldApplyResolution(generation, this.resolveGeneration)) {
      console.info(
        `[walkthrough] discarded stale resolve for step index ${this.stepIndex} (gen ${generation} != ${this.resolveGeneration})`,
      );
      return;
    }

    this.lastHighlight = resolved.rect
      ? {
          x: resolved.rect.x - display.x,
          y: resolved.rect.y - display.y,
          width: resolved.rect.width,
          height: resolved.rect.height,
        }
      : null;
    this.lastResolvedNote = resolved.fallbackNote;
    console.info(
      `[walkthrough] step ${this.stepIndex + 1} resolve source=${resolved.source}`,
      resolved.rect
        ? `rect=${Math.round(resolved.rect.x)},${Math.round(resolved.rect.y)} ${Math.round(resolved.rect.width)}x${Math.round(resolved.rect.height)}`
        : 'no highlight',
    );

    if (
      resolved.source === 'unidentified' &&
      this.missFrictionStepIndex !== this.stepIndex &&
      hasTargetHint(step)
    ) {
      this.missFrictionStepIndex = this.stepIndex;
      this.recordFriction(stepNumber, 'selector_miss');
    }
  }

  private recordFriction(stepNumber: number, eventType: FrictionEvent['event_type']): void {
    this.frictionEvents.push({
      step_number: stepNumber,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
    });
  }

  /**
   * Learn create -> live id transitions from the foreground browser URL
   * (extension resolvedUrls parity). active-win supplies URL on macOS browsers;
   * when unavailable we still refuse stale dynamic opens via unresolved_dynamic.
   */
  private learnLiveResourceUrlFromForeground(): void {
    const step = this.currentStep();
    if (!step) {
      return;
    }
    const recorded = resolveStepPageUrl(step);
    const live = readForegroundBrowserUrl();
    if (!live) {
      return;
    }
    const before = Object.keys(this.resolvedUrls).length;
    this.resolvedUrls = learnFromStepTransition(this.resolvedUrls, recorded, live);
    if (Object.keys(this.resolvedUrls).length > before) {
      console.info('[walkthrough] learned live resource URL from foreground:', live);
    }
  }

  /**
   * Open the step page URL using extension-style dynamic resource resolution.
   * Never reopens a stale recorded id when the create flow produced a new resource.
   * @returns opened URL, or null if nothing new was opened
   */
  private maybeOpenInstructionUrl(step: WalkthroughStep): string | null {
    const recorded = resolveStepPageUrl(step);
    const live = readForegroundBrowserUrl();
    const { url, mode } = resolvePlaybackTargetUrl(recorded, this.resolvedUrls, live);

    if (mode === 'unresolved_dynamic') {
      console.info(
        '[walkthrough] skipping stale dynamic URL (stay on the resource you created):',
        recorded,
      );
      this.urlNavNote =
        'This step recorded a dynamic resource URL. Stay on the page you just created in the browser; ' +
        'desktop will not reopen the old recorded id.';
      return null;
    }

    if (mode === 'live') {
      // Already on a matching live resource; do not bounce to the recorded id.
      this.lastOpenedUrl = url;
      this.urlNavNote = null;
      console.info('[walkthrough] using live matching resource URL (no reopen):', url);
      return null;
    }

    if (!url || url === this.lastOpenedUrl) {
      return null;
    }

    this.lastOpenedUrl = url;
    this.urlNavNote = null;
    console.info(`[walkthrough] opening step URL (${mode}) in default browser:`, url);
    void shell.openExternal(url);
    return url;
  }

  private resetVisitBookkeeping(): void {
    this.visitEnteredAt = null;
    this.visitStepNumber = null;
    this.lastEnteredStepIndex = null;
    this.missFrictionStepIndex = null;
  }

  private currentStep(): WalkthroughStep | null {
    return this.payload?.steps[this.stepIndex] ?? null;
  }

  private publish(): WalkthroughUiState {
    const state = this.getUiState();
    if (this.overlay.isOpen() || this.status === 'playing' || this.status === 'finished') {
      this.overlay.pushState(state);
    }
    return state;
  }
}

function hasTargetHint(step: WalkthroughStep): boolean {
  return Boolean(step.target_label || step.css_selector || step.xpath || step.raw_coordinates);
}
