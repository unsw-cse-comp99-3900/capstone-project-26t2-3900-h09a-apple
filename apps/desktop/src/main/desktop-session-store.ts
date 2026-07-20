import {
  assembleSessionFromRows,
  clearSessionAudit,
  deleteSession,
  getSessionAuditSummary,
  getSessionWithEvents,
  markSessionSubmitted,
  openLocalBuffer,
  saveEvent,
  saveSession,
  type LocalBufferDatabase,
  type SessionAuditSummary,
} from '@h09a/desktop-storage';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

export interface DesktopEventInput {
  category: string;
  type: string;
  timestamp_ms: number;
  raw_x: number | null;
  raw_y: number | null;
  value?: string | null;
  target_label?: string | null;
  url?: string | null;
  screenshot_id?: string | null;
  attrs: Record<string, unknown>;
}

export interface CompletedLocalSession {
  sessionId: string;
  sessionDirectory: string;
  artifactPath: string;
  auditSummaryPath: string;
  auditSummary: SessionAuditSummary;
}

interface ActiveSession {
  id: string;
  workflowName: string;
  startedAtMs: number;
  nextSequence: number;
  directory: string;
}

export class DesktopSessionStore {
  private readonly db: LocalBufferDatabase;
  private activeSession: ActiveSession | null = null;

  constructor(
    dbPath: string,
    private readonly sessionsRoot: string,
  ) {
    mkdirSync(sessionsRoot, { recursive: true });
    this.db = openLocalBuffer(dbPath);
  }

  startSession(workflowName = 'Untitled desktop recording'): string {
    if (this.activeSession) {
      throw new Error('A desktop recording session is already active');
    }

    const id = randomUUID();
    const startedAtMs = Date.now();
    const directory = join(this.sessionsRoot, id);

    mkdirSync(join(directory, 'screenshots'), { recursive: true });
    saveSession(this.db, {
      client_session_id: id,
      workflow_name: workflowName,
      recorded_by: null,
      started_at_ms: startedAtMs,
      stopped_at_ms: null,
      status: 'recording',
    });

    this.activeSession = {
      id,
      workflowName,
      startedAtMs,
      nextSequence: 1,
      directory,
    };

    return id;
  }

  getActiveSessionId(): string | null {
    return this.activeSession?.id ?? null;
  }

  getActiveSessionDirectory(): string | null {
    return this.activeSession?.directory ?? null;
  }

  screenshotsDirectory(): string | null {
    const session = this.activeSession;
    return session ? join(session.directory, 'screenshots') : null;
  }

  /**
   * Persist a PNG capture for the active session under `id` (or a new UUID).
   * The same id is used as the event.screenshot_id reference.
   */
  saveScreenshotPng(
    pngBuffer: Buffer,
    meta?: { width?: number; height?: number; id?: string },
  ): string | null {
    const session = this.activeSession;
    if (!session) {
      return null;
    }

    const id = meta?.id ?? randomUUID();
    const filePath = join(session.directory, 'screenshots', `${id}.png`);
    writeFileSync(filePath, pngBuffer);

    if (meta?.width != null || meta?.height != null) {
      writeFileSync(
        join(session.directory, 'screenshots', `${id}.meta.json`),
        `${JSON.stringify({ width: meta.width ?? null, height: meta.height ?? null })}\n`,
        'utf8',
      );
    }

    return id;
  }

  allocateScreenshotId(): string | null {
    if (!this.activeSession) {
      return null;
    }
    return randomUUID();
  }

  saveCapturedEvent(event: DesktopEventInput): boolean {
    const session = this.requireActiveSession();

    const candidate = {
      id: randomUUID(),
      session_id: session.id,
      seq: session.nextSequence,
      source: 'user',
      layer: 'desktop',
      category: event.category,
      type: event.type,
      timestamp_ms: event.timestamp_ms,
      target_selector: null,
      target_label: event.target_label ?? null,
      value: event.value ?? null,
      url: event.url ?? null,
      screenshot_id: event.screenshot_id ?? null,
      is_identified: false,
      identification_source: 'unidentified' as const,
      raw_x: event.raw_x,
      raw_y: event.raw_y,
      attrs: event.attrs,
    };

    // Policy/redaction runs once inside saveEvent so audit counters stay accurate.
    const result = saveEvent(this.db, candidate);

    if (!result.saved) {
      return false;
    }

    session.nextSequence += 1;
    return true;
  }

  completeSession(status: 'captured' | 'failed' = 'captured'): CompletedLocalSession {
    const session = this.requireActiveSession();
    const stoppedAtMs = Date.now();

    saveSession(this.db, {
      client_session_id: session.id,
      workflow_name: session.workflowName,
      recorded_by: null,
      started_at_ms: session.startedAtMs,
      stopped_at_ms: stoppedAtMs,
      status,
    });

    const rows = getSessionWithEvents(this.db, session.id);

    if (!rows) {
      throw new Error(`Completed session ${session.id} could not be read from SQLite`);
    }

    const screenshots = this.loadScreenshotsForEvents(
      session.directory,
      rows.events as Array<{ screenshot_id?: string | null }>,
    );

    const payload = assembleSessionFromRows({ ...rows, screenshots });
    const artifactPath = join(session.directory, 'session.json');
    const auditSummary = getSessionAuditSummary(session.id);
    const auditSummaryPath = join(session.directory, 'capture-policy-audit.json');

    writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    writeFileSync(auditSummaryPath, `${JSON.stringify(auditSummary, null, 2)}\n`, 'utf8');

    this.activeSession = null;

    return {
      sessionId: session.id,
      sessionDirectory: session.directory,
      artifactPath,
      auditSummaryPath,
      auditSummary,
    };
  }

  markSubmitted(sessionId: string): {
    sessionId: string;
    submittedAtMs: number;
    purgedEventCount: number;
  } {
    const result = markSessionSubmitted(this.db, sessionId);
    clearSessionAudit(sessionId);
    return result;
  }

  getAuditSummary(sessionId: string): SessionAuditSummary {
    return getSessionAuditSummary(sessionId);
  }

  async deleteCompletedSession(sessionId: string, sessionDirectory: string): Promise<void> {
    deleteSession(this.db, sessionId);

    await rm(sessionDirectory, {
      recursive: true,
      force: true,
    });
  }

  hasActiveSession(): boolean {
    return this.activeSession !== null;
  }

  close(): void {
    this.db.close();
  }

  private loadScreenshotsForEvents(
    sessionDirectory: string,
    events: Array<{ screenshot_id?: string | null }>,
  ): Array<{
    id: string;
    data_base64: string;
    content_type: 'image/png';
    width: number | null;
    height: number | null;
  }> {
    const ids = new Set(
      events.map((event) => event.screenshot_id).filter((id): id is string => Boolean(id)),
    );
    const screenshots: Array<{
      id: string;
      data_base64: string;
      content_type: 'image/png';
      width: number | null;
      height: number | null;
    }> = [];

    for (const id of ids) {
      const pngPath = join(sessionDirectory, 'screenshots', `${id}.png`);
      if (!existsSync(pngPath)) {
        continue;
      }

      let width: number | null = null;
      let height: number | null = null;
      const metaPath = join(sessionDirectory, 'screenshots', `${id}.meta.json`);
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
            width?: number | null;
            height?: number | null;
          };
          width = typeof meta.width === 'number' ? meta.width : null;
          height = typeof meta.height === 'number' ? meta.height : null;
        } catch {
          // Meta is optional; PNG alone is enough for API upload.
        }
      }

      screenshots.push({
        id,
        data_base64: readFileSync(pngPath).toString('base64'),
        content_type: 'image/png',
        width,
        height,
      });
    }

    return screenshots;
  }

  private requireActiveSession(): ActiveSession {
    if (!this.activeSession) {
      throw new Error('No desktop recording session is active');
    }

    return this.activeSession;
  }
}
