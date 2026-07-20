import type { VoiceCommand } from './types';

const COMMANDS: VoiceCommand[] = ['next', 'continue', 'previous', 'repeat', 'stop'];

export function parseVoiceCommand(transcript: string | null | undefined): VoiceCommand | null {
  if (typeof transcript !== 'string') {
    return null;
  }

  const normalized = transcript
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  for (const command of COMMANDS) {
    if (normalized === command || normalized === `please ${command}`) {
      return command;
    }
  }

  return null;
}

export function voiceCommandToAction(
  command: VoiceCommand,
): 'next' | 'previous' | 'finish' | 'repeat' {
  if (command === 'next' || command === 'continue') {
    return 'next';
  }
  if (command === 'previous') {
    return 'previous';
  }
  if (command === 'stop') {
    return 'finish';
  }
  return 'repeat';
}
