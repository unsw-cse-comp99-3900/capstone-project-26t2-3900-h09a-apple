import { UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi';

const MAX_RECONSTRUCTED_INPUT_LENGTH = 10_000;

const LETTER_KEYS = new Map<number, string>([
  [UiohookKey.A, 'a'],
  [UiohookKey.B, 'b'],
  [UiohookKey.C, 'c'],
  [UiohookKey.D, 'd'],
  [UiohookKey.E, 'e'],
  [UiohookKey.F, 'f'],
  [UiohookKey.G, 'g'],
  [UiohookKey.H, 'h'],
  [UiohookKey.I, 'i'],
  [UiohookKey.J, 'j'],
  [UiohookKey.K, 'k'],
  [UiohookKey.L, 'l'],
  [UiohookKey.M, 'm'],
  [UiohookKey.N, 'n'],
  [UiohookKey.O, 'o'],
  [UiohookKey.P, 'p'],
  [UiohookKey.Q, 'q'],
  [UiohookKey.R, 'r'],
  [UiohookKey.S, 's'],
  [UiohookKey.T, 't'],
  [UiohookKey.U, 'u'],
  [UiohookKey.V, 'v'],
  [UiohookKey.W, 'w'],
  [UiohookKey.X, 'x'],
  [UiohookKey.Y, 'y'],
  [UiohookKey.Z, 'z'],
]);

const PRINTABLE_KEYS = new Map<number, [string, string]>([
  [UiohookKey['0'], ['0', ')']],
  [UiohookKey['1'], ['1', '!']],
  [UiohookKey['2'], ['2', '@']],
  [UiohookKey['3'], ['3', '#']],
  [UiohookKey['4'], ['4', '$']],
  [UiohookKey['5'], ['5', '%']],
  [UiohookKey['6'], ['6', '^']],
  [UiohookKey['7'], ['7', '&']],
  [UiohookKey['8'], ['8', '*']],
  [UiohookKey['9'], ['9', '(']],
  [UiohookKey.Semicolon, [';', ':']],
  [UiohookKey.Equal, ['=', '+']],
  [UiohookKey.Comma, [',', '<']],
  [UiohookKey.Minus, ['-', '_']],
  [UiohookKey.Period, ['.', '>']],
  [UiohookKey.Slash, ['/', '?']],
  [UiohookKey.Backquote, ['`', '~']],
  [UiohookKey.BracketLeft, ['[', '{']],
  [UiohookKey.Backslash, ['\\', '|']],
  [UiohookKey.BracketRight, [']', '}']],
  [UiohookKey.Quote, ["'", '"']],
  [UiohookKey.Numpad0, ['0', '0']],
  [UiohookKey.Numpad1, ['1', '1']],
  [UiohookKey.Numpad2, ['2', '2']],
  [UiohookKey.Numpad3, ['3', '3']],
  [UiohookKey.Numpad4, ['4', '4']],
  [UiohookKey.Numpad5, ['5', '5']],
  [UiohookKey.Numpad6, ['6', '6']],
  [UiohookKey.Numpad7, ['7', '7']],
  [UiohookKey.Numpad8, ['8', '8']],
  [UiohookKey.Numpad9, ['9', '9']],
  [UiohookKey.NumpadMultiply, ['*', '*']],
  [UiohookKey.NumpadAdd, ['+', '+']],
  [UiohookKey.NumpadSubtract, ['-', '-']],
  [UiohookKey.NumpadDecimal, ['.', '.']],
  [UiohookKey.NumpadDivide, ['/', '/']],
]);

function appendBounded(value: string, addition: string): string {
  return `${value}${addition}`.slice(-MAX_RECONSTRUCTED_INPUT_LENGTH);
}

export function applyKeyboardEventText(
  currentValue: string,
  event: UiohookKeyboardEvent,
): string {
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return currentValue;
  }

  if (event.keycode === UiohookKey.Backspace) {
    return currentValue.slice(0, -1);
  }

  if (event.keycode === UiohookKey.Space) {
    return appendBounded(currentValue, ' ');
  }

  const letter = LETTER_KEYS.get(event.keycode);
  if (letter) {
    return appendBounded(currentValue, event.shiftKey ? letter.toUpperCase() : letter);
  }

  const printable = PRINTABLE_KEYS.get(event.keycode);
  if (printable) {
    return appendBounded(currentValue, printable[event.shiftKey ? 1 : 0]);
  }

  return currentValue;
}
