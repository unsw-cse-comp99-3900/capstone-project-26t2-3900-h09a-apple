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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

type IdentificationSource =
  | 'accessibility_api'
  | 'ocr'
  | 'vision_model'
  | 'unidentified';

export interface DesktopEventInput {
  category: string;
  type: string;
  timestamp_ms: number;
  raw_x: number | null;
  raw_y: number | null;
  target_selector?: string | null;
  target_label?: string | null;
  screenshot_id?: string | null;
  is_identified?: boolean;
  identification_source?: IdentificationSource | null;
  value?: string | null;
  attrs: Record<string, unknown>;
}

export interface DesktopScreenshotInput {
  data: Buffer;
  content_type: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
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
  screenshots: Array<{
    id: string;
    filePath: string;
    contentType: DesktopScreenshotInput['content_type'];
    width: number;
    height: number;
  }>;
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
      screenshots: [],
    };

    return id;
  }

  getActiveSessionId(): string | null {
    return this.activeSession?.id ?? null;
  }

  saveCapturedScreenshot(screenshot: DesktopScreenshotInput): string {
    const session = this.requireActiveSession();
    const id = randomUUID();
    const extension =
      screenshot.content_type === 'image/png'
        ? 'png'
        : screenshot.content_type === 'image/webp'
          ? 'webp'
          : 'jpg';
    const filePath = join(session.directory, 'screenshots', `${id}.${extension}`);

    writeFileSync(filePath, screenshot.data);
    session.screenshots.push({
      id,
      filePath,
      contentType: screenshot.content_type,
      width: screenshot.width,
      height: screenshot.height,
    });

    return id;
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
      target_selector: event.target_selector ?? null,
      target_label: event.target_label ?? null,
      value: event.value ?? null,
      url: null,
      screenshot_id: event.screenshot_id ?? null,
      is_identified: event.is_identified ?? false,
      identification_source:
        event.identification_source ?? (event.is_identified ? 'accessibility_api' : 'unidentified'),
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

    const payload = assembleSessionFromRows(rows) as {
      screenshots: Array<{
        id: string;
        data_base64: string;
        content_type: DesktopScreenshotInput['content_type'];
        width: number;
        height: number;
      }>;
      [key: string]: unknown;
    };
    payload.screenshots = session.screenshots.map((screenshot) => ({
      id: screenshot.id,
      data_base64: readFileSync(screenshot.filePath).toString('base64'),
      content_type: screenshot.contentType,
      width: screenshot.width,
      height: screenshot.height,
    }));
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

  private requireActiveSession(): ActiveSession {
    if (!this.activeSession) {
      throw new Error('No desktop recording session is active');
    }

    return this.activeSession;
  }
}
