import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { ScreenRect, WalkthroughUiState } from './types';

export class WalkthroughOverlayWindow {
  private window: BrowserWindow | null = null;

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

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

    if (process.env.ELECTRON_RENDERER_URL) {
      void this.window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/walkthrough.html`);
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/walkthrough.html'));
    }

    this.window.on('closed', () => {
      this.window = null;
    });

    return this.window;
  }

  show(): void {
    this.ensure().showInactive();
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
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
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send('walkthrough:state', state);
  }
}
