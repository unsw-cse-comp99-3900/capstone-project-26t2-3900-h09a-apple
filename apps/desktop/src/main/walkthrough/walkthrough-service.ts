import { clipboard, dialog, screen } from 'electron';
import { writeFile } from 'node:fs/promises';
import { WalkthroughAutoAdvance } from './auto-advance';
import { postWalkthroughCompletion } from './completion-client';
import { WalkthroughOverlayWindow } from './overlay-window';
import { formatAgentPromptDocument, hasCompleteCoachingSections } from './prompt-export';
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

  private readonly overlay = new WalkthroughOverlayWindow();
  private readonly autoAdvance = new WalkthroughAutoAdvance();

  isPlaying(): boolean {
    return this.status === 'playing';
  }

  getUiState(): WalkthroughUiState {
    const steps = this.payload?.steps ?? [];
    const step = steps[this.stepIndex] ?? null;
    const exportAvailable = hasCompleteCoachingSections(this.payload?.coaching_sections);

    return {
      status: this.status,
      sopId: this.payload?.sop_id ?? null,
      stepIndex: this.stepIndex,
      stepCount: steps.length,
      instruction: step?.instruction ?? '',
      eyebrow: steps.length > 0 ? `Step ${this.stepIndex + 1} of ${steps.length}` : 'Walkthrough',
      screenshotUrl: step?.screenshot_url ?? null,
      fallbackNote: this.lastResolvedNote,
      highlight: this.lastHighlight,
      previousDisabled: this.stepIndex <= 0,
      isLastStep: steps.length > 0 && this.stepIndex >= steps.length - 1,
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

    const display = screen.getPrimaryDisplay().bounds;
    this.overlay.coverDisplay(display);
    this.overlay.show();

    this.autoAdvance.start(() => {
      void this.handleAutoAdvance();
    });

    await this.enterCurrentStep();
    return this.publish();
  }

  async previous(): Promise<WalkthroughUiState> {
    if (this.status !== 'playing' || this.stepIndex <= 0 || !this.payload) {
      return this.publish();
    }

    const destinationIndex = this.stepIndex - 1;
    const destinationStep = this.payload.steps[destinationIndex];
    const destinationStepNumber = destinationStep?.step_number ?? destinationIndex + 1;

    this.abandonCurrentStep();
    this.stepTimings = retractTimingsToStep(this.stepTimings, destinationStepNumber);
    this.frictionEvents = retractFrictionToStep(this.frictionEvents, destinationStepNumber);
    this.stepIndex = destinationIndex;
    this.advanceArmed = true;
    await this.enterCurrentStep();
    return this.publish();
  }

  async next(): Promise<WalkthroughUiState> {
    if (this.status !== 'playing' || !this.payload) {
      return this.publish();
    }

    if (this.stepIndex >= this.payload.steps.length - 1) {
      return this.finish();
    }

    this.leaveCurrentStep();
    this.stepIndex += 1;
    this.advanceArmed = true;
    await this.enterCurrentStep();
    return this.publish();
  }

  async finish(): Promise<WalkthroughUiState> {
    if (!this.payload) {
      return this.publish();
    }

    this.leaveCurrentStep();
    this.autoAdvance.stop();

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
    return this.publish();
  }

  async dismiss(): Promise<void> {
    this.autoAdvance.stop();
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
    this.overlay.setClickThrough(!enabled);
  }

  private async handleAutoAdvance(): Promise<void> {
    if (this.status !== 'playing' || !this.advanceArmed) {
      return;
    }
    this.advanceArmed = false;
    await this.next();
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

    const display = screen.getPrimaryDisplay().bounds;
    this.overlay.coverDisplay(display);

    const resolved = await resolvePlaybackTarget(step, display);
    this.lastHighlight = resolved.rect
      ? {
          x: resolved.rect.x - display.x,
          y: resolved.rect.y - display.y,
          width: resolved.rect.width,
          height: resolved.rect.height,
        }
      : null;
    this.lastResolvedNote = resolved.fallbackNote;

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
