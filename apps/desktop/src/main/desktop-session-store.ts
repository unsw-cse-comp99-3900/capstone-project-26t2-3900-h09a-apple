import {
  assembleSessionFromRows,
  getSessionWithEvents,
  openLocalBuffer,
  saveEvent,
  saveSession,
  type LocalBufferDatabase,
} from '@h09a/desktop-storage';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface DesktopEventInput {
  category: 'mouse' | 'keyboard';
  type: 'click' | 'input';
  timestamp_ms: number;
  raw_x: number | null;
  raw_y: number | null;
  attrs: Record<string, unknown>;
}

export interface CompletedLocalSession {
  sessionId: string;
  sessionDirectory: string;
  artifactPath: string;
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

  saveCapturedEvent(event: DesktopEventInput): void {
    const session = this.requireActiveSession();

    saveEvent(this.db, {
      id: randomUUID(),
      session_id: session.id,
      seq: session.nextSequence,
      source: 'user',
      layer: 'desktop',
      category: event.category,
      type: event.type,
      timestamp_ms: event.timestamp_ms,
      target_selector: null,
      target_label: null,
      value: null,
      url: null,
      screenshot_id: null,
      is_identified: false,
      identification_source: 'unidentified',
      raw_x: event.raw_x,
      raw_y: event.raw_y,
      attrs: event.attrs,
    });

    session.nextSequence += 1;
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

    const payload = assembleSessionFromRows(rows);
    const artifactPath = join(session.directory, 'session.json');

    writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.activeSession = null;

    return {
      sessionId: session.id,
      sessionDirectory: session.directory,
      artifactPath,
    };
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
