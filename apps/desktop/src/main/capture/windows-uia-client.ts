import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import type { DesktopTargetSnapshot, UiaInspectionResult } from './capture-types';

interface SidecarResponse {
  requestId?: string;
  ok?: boolean;
  target?: DesktopTargetSnapshot | null;
  error?: string;
}

interface PendingRequest {
  resolve: (result: UiaInspectionResult) => void;
  timeout: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 1_500;

export class WindowsUiaClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private output: ReadLineInterface | null = null;
  private pending = new Map<string, PendingRequest>();
  private permanentlyUnavailableReason: string | null = null;

  async inspectPoint(x: number, y: number): Promise<UiaInspectionResult> {
    return this.request({
      command: 'elementFromPoint',
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  async inspectFocusedElement(): Promise<UiaInspectionResult> {
    return this.request({ command: 'focusedElement' });
  }

  dispose(): void {
    this.rejectPending('Windows UI Automation sidecar stopped');
    this.output?.close();
    this.output = null;

    if (this.child && !this.child.killed) {
      this.child.kill();
    }

    this.child = null;
  }

  private async request(payload: Record<string, unknown>): Promise<UiaInspectionResult> {
    if (process.platform !== 'win32') {
      return { target: null, error: 'Windows UI Automation is only available on Windows' };
    }

    if (this.permanentlyUnavailableReason) {
      return { target: null, error: this.permanentlyUnavailableReason };
    }

    const child = this.ensureStarted();
    if (!child) {
      return {
        target: null,
        error: this.permanentlyUnavailableReason ?? 'Windows UI Automation sidecar unavailable',
      };
    }

    const requestId = randomUUID();

    return new Promise<UiaInspectionResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ target: null, error: 'Windows UI Automation request timed out' });
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, timeout });

      child.stdin.write(`${JSON.stringify({ ...payload, requestId })}\n`, 'utf8', (error) => {
        if (!error) return;

        const pending = this.pending.get(requestId);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.resolve({ target: null, error: error.message });
      });
    });
  }

  private ensureStarted(): ChildProcessWithoutNullStreams | null {
    if (this.child && !this.child.killed) {
      return this.child;
    }

    const scriptPath = this.resolveScriptPath();
    if (!existsSync(scriptPath)) {
      this.permanentlyUnavailableReason = `Windows UI Automation script not found: ${scriptPath}`;
      return null;
    }

    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    this.child = child;
    this.output = createInterface({ input: child.stdout });
    this.output.on('line', (line) => this.handleResponseLine(line));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (message) {
        console.warn('[desktop] Windows UI Automation sidecar:', message);
      }
    });

    child.on('error', (error) => {
      this.permanentlyUnavailableReason = error.message;
      this.rejectPending(error.message);
      this.child = null;
    });

    child.on('exit', (code) => {
      const reason = `Windows UI Automation sidecar exited (${code ?? 'unknown'})`;
      this.rejectPending(reason);
      this.child = null;
      this.output = null;
    });

    return child;
  }

  private resolveScriptPath(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'windows-uia.ps1');
    }

    return join(app.getAppPath(), 'resources', 'windows-uia.ps1');
  }

  private handleResponseLine(line: string): void {
    let response: SidecarResponse;

    try {
      response = JSON.parse(line) as SidecarResponse;
    } catch {
      console.warn('[desktop] Ignoring malformed Windows UI Automation response');
      return;
    }

    if (!response.requestId) return;

    const pending = this.pending.get(response.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(response.requestId);
    pending.resolve({
      target: response.ok ? (response.target ?? null) : null,
      error: response.ok ? undefined : (response.error ?? 'Windows UI Automation query failed'),
    });
  }

  private rejectPending(reason: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.resolve({ target: null, error: reason });
      this.pending.delete(requestId);
    }
  }
}
