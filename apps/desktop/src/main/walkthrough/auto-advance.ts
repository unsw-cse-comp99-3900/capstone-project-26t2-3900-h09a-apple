import { uIOhook } from 'uiohook-napi';
import type { WalkthroughStep } from './types';

export type AutoAdvanceListener = (reason: 'click' | 'keydown') => void;

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

    uIOhook.on('click', () => {
      if (!this.listening || !this.onAdvance) {
        return;
      }
      const expected = String(this.expected ?? 'click').toLowerCase();
      if (expected === 'click' || expected === 'pointer_click' || expected === '') {
        this.onAdvance('click');
      }
    });

    uIOhook.on('keydown', () => {
      if (!this.listening || !this.onAdvance) {
        return;
      }
      const expected = String(this.expected ?? '').toLowerCase();
      if (expected === 'input' || expected === 'keydown' || expected === 'keypress') {
        this.onAdvance('keydown');
      }
    });

    this.hooksBound = true;
  }
}
