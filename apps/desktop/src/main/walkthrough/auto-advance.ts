import { uIOhook } from 'uiohook-napi';
import type { WalkthroughStep } from './types';

export type AutoAdvanceEvent = { reason: 'click'; x: number; y: number } | { reason: 'keydown' };

export type AutoAdvanceListener = (event: AutoAdvanceEvent) => void;

export class WalkthroughAutoAdvance {
  private listening = false;
  private expected: WalkthroughStep['expected_action'] = null;
  private onAdvance: AutoAdvanceListener | null = null;
  private hooksBound = false;

  setExpectedAction(action: WalkthroughStep['expected_action']): void {
    this.expected = action ?? 'click';
  }

  start(listener: AutoAdvanceListener): void {
    this.onAdvance = listener;
    this.bindHooks();
    this.listening = true;
  }

  stop(): void {
    this.listening = false;
    this.onAdvance = null;
  }

  private bindHooks(): void {
    if (this.hooksBound) {
      return;
    }

    uIOhook.on('click', (event) => {
      if (!this.listening || !this.onAdvance) {
        return;
      }
      const expected = String(this.expected ?? 'click').toLowerCase();
      if (expected === 'click' || expected === 'pointer_click' || expected === '') {
        this.onAdvance({
          reason: 'click',
          x: Number(event.x),
          y: Number(event.y),
        });
      }
    });

    // Keydown is reported for diagnostics only; the service does not auto-advance
    // on global keydown (too loose without a focused-field signal).
    uIOhook.on('keydown', () => {
      if (!this.listening || !this.onAdvance) {
        return;
      }
      const expected = String(this.expected ?? '').toLowerCase();
      if (expected === 'input' || expected === 'keydown' || expected === 'keypress') {
        this.onAdvance({ reason: 'keydown' });
      }
    });

    this.hooksBound = true;
  }
}
