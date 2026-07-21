import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { ScreenRect, WalkthroughUiState } from './types';

const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 520;

/**
 * Two windows on purpose:
 * - spotlight: full display, always click-through (user can click the real app)
 * - panel: solid control card, NEVER click-through (Previous/Next always work)
 */
export class WalkthroughOverlayWindow {
  private spotlight: BrowserWindow | null = null;
  private panel: BrowserWindow | null = null;
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | null = null;
  private panelReady = false;
  private spotlightReady = false;
  private pendingState: WalkthroughUiState | null = null;
  private displayBounds: ScreenRect | null = null;

  isOpen(): boolean {
    return (
      (this.panel !== null && !this.panel.isDestroyed()) ||
      (this.spotlight !== null && !this.spotlight.isDestroyed())
    );
  }

  ensure(): void {
    if (
      this.panel &&
      !this.panel.isDestroyed() &&
      this.spotlight &&
      !this.spotlight.isDestroyed()
    ) {
      return;
    }

    this.panelReady = false;
    this.spotlightReady = false;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    const display = screen.getPrimaryDisplay().bounds;
    this.displayBounds = { ...display };

    this.spotlight = this.createWindow({
      role: 'spotlight',
      bounds: display,
      clickThrough: true,
    });

    this.panel = this.createWindow({
      role: 'panel',
      bounds: panelBoundsForDisplay(display),
      clickThrough: false,
    });
  }

  async awaitReady(): Promise<void> {
    this.ensure();
    await this.readyPromise;
  }

  show(): void {
    this.ensure();
    this.spotlight?.showInactive();
    this.panel?.show();
    this.panel?.moveTop();
  }

  hide(): void {
    if (this.spotlight && !this.spotlight.isDestroyed()) {
      this.spotlight.hide();
    }
    if (this.panel && !this.panel.isDestroyed()) {
      this.panel.hide();
    }
  }

  /**
   * Hide overlay chrome for screen capture. CSS cloak alone is not enough on
   * Windows: always-on-top transparent windows still make desktopCapturer fail
   * or return empty/useless frames.
   */
  setCaptureCloak(cloaked: boolean): void {
    if (this.spotlight && !this.spotlight.isDestroyed()) {
      this.spotlight.webContents.send('walkthrough:capture-cloak', cloaked);
      if (cloaked) {
        this.spotlight.hide();
      } else {
        this.spotlight.showInactive();
      }
    }
    if (this.panel && !this.panel.isDestroyed()) {
      if (cloaked) {
        this.panel.hide();
      } else {
        this.panel.show();
        this.panel.moveTop();
      }
    }
  }

  destroy(): void {
    if (this.spotlight && !this.spotlight.isDestroyed()) {
      this.spotlight.destroy();
    }
    if (this.panel && !this.panel.isDestroyed()) {
      this.panel.destroy();
    }
    this.spotlight = null;
    this.panel = null;
    this.panelReady = false;
    this.spotlightReady = false;
    this.resolveReady = null;
    this.pendingState = null;
    this.displayBounds = null;
    this.readyPromise = Promise.resolve();
  }

  coverDisplay(bounds: ScreenRect): void {
    this.ensure();
    this.displayBounds = { ...bounds };
    this.spotlight?.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
    this.panel?.setBounds(panelBoundsForDisplay(bounds));
  }

  /** Panel is never click-through; kept for API compatibility. */
  setClickThrough(enabled: boolean): void {
    void enabled;
    if (this.spotlight && !this.spotlight.isDestroyed()) {
      this.spotlight.setIgnoreMouseEvents(true);
    }
  }

  pushState(state: WalkthroughUiState): void {
    this.pendingState = state;
    this.ensure();
    if (this.panelReady && this.panel && !this.panel.isDestroyed()) {
      this.panel.webContents.send('walkthrough:state', state);
    }
    if (this.spotlightReady && this.spotlight && !this.spotlight.isDestroyed()) {
      this.spotlight.webContents.send('walkthrough:state', state);
    }
  }

  private createWindow(options: {
    role: 'panel' | 'spotlight';
    bounds: ScreenRect;
    clickThrough: boolean;
  }): BrowserWindow {
    const win = new BrowserWindow({
      x: Math.round(options.bounds.x),
      y: Math.round(options.bounds.y),
      width: Math.round(options.bounds.width),
      height: Math.round(options.bounds.height),
      frame: false,
      transparent: true,
      resizable: false,
      movable: options.role === 'panel',
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: options.role === 'panel',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/walkthrough.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--walkthrough-role=${options.role}`],
      },
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (options.clickThrough) {
      // No forward flag: clicks go to apps below. Panel handles all UI clicks.
      win.setIgnoreMouseEvents(true);
    }

    const markReady = () => {
      if (options.role === 'panel') {
        this.panelReady = true;
      } else {
        this.spotlightReady = true;
      }
      if (this.panelReady && this.spotlightReady) {
        this.resolveReady?.();
        this.resolveReady = null;
        if (this.pendingState) {
          this.pushState(this.pendingState);
        }
      }
    };

    win.webContents.ipc.on('walkthrough:renderer-ready', markReady);
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[walkthrough] overlay failed to load:', options.role, code, desc, url);
      markReady();
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => markReady(), 1500);
    });

    if (process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(
        `${process.env.ELECTRON_RENDERER_URL}/walkthrough.html?role=${options.role}`,
      );
    } else {
      void win.loadFile(join(__dirname, '../renderer/walkthrough.html'), {
        query: { role: options.role },
      });
    }

    win.on('closed', () => {
      if (options.role === 'panel') {
        this.panel = null;
        this.panelReady = false;
      } else {
        this.spotlight = null;
        this.spotlightReady = false;
      }
    });

    return win;
  }
}

function panelBoundsForDisplay(display: ScreenRect): ScreenRect {
  return {
    x: display.x + Math.max(16, display.width - PANEL_WIDTH - 24),
    y: display.y + Math.max(16, Math.round((display.height - PANEL_HEIGHT) / 2)),
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
  };
}
