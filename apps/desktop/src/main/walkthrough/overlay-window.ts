import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { ScreenRect, WalkthroughUiState } from './types';

const RENDERER_READY_CHANNEL = 'walkthrough:renderer-ready';

export class WalkthroughOverlayWindow {
  private window: BrowserWindow | null = null;
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | null = null;
  private rendererReady = false;
  private pendingState: WalkthroughUiState | null = null;

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    this.rendererReady = false;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    this.window = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/walkthrough.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setIgnoreMouseEvents(true, { forward: true });

    const markReady = () => {
      if (this.rendererReady) {
        return;
      }
      this.rendererReady = true;
      this.resolveReady?.();
      this.resolveReady = null;
      if (this.pendingState) {
        this.sendState(this.pendingState);
      }
    };

    // Preferred signal: renderer has attached walkthrough:state listeners.
    this.window.webContents.ipc.on(RENDERER_READY_CHANNEL, markReady);

    this.window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL) => {
        console.error(
          '[walkthrough] overlay failed to load:',
          errorCode,
          errorDescription,
          validatedURL,
        );
        markReady();
      },
    );

    // Fallback if the renderer never signals (e.g. script error).
    this.window.webContents.once('did-finish-load', () => {
      setTimeout(() => markReady(), 1500);
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void this.window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/walkthrough.html`);
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/walkthrough.html'));
    }

    this.window.on('closed', () => {
      this.window = null;
      this.rendererReady = false;
      this.resolveReady = null;
      this.pendingState = null;
      this.readyPromise = Promise.resolve();
    });

    return this.window;
  }

  async awaitReady(): Promise<void> {
    this.ensure();
    await this.readyPromise;
  }

  show(): void {
    this.ensure().showInactive();
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Briefly cloak the overlay for vision/OCR capture without destroying the
   * BrowserWindow (less flicker than hide/show).
   */
  setCaptureCloak(cloaked: boolean): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.setOpacity(cloaked ? 0 : 1);
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.rendererReady = false;
    this.resolveReady = null;
    this.pendingState = null;
    this.readyPromise = Promise.resolve();
  }

  coverDisplay(bounds: ScreenRect): void {
    this.ensure().setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  setClickThrough(enabled: boolean): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.setIgnoreMouseEvents(enabled, { forward: true });
  }

  pushState(state: WalkthroughUiState): void {
    this.pendingState = state;
    this.ensure();
    if (!this.rendererReady) {
      return;
    }
    this.sendState(state);
  }

  private sendState(state: WalkthroughUiState): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send('walkthrough:state', state);
  }
}
