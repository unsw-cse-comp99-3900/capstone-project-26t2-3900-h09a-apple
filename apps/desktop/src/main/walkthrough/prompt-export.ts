import type { CoachingSections } from './types';

const SECTION_ORDER: Array<keyof CoachingSections> = [
  'identity',
  'context',
  'steps',
  'output',
  'guardrails',
];

const SECTION_TITLES: Record<keyof CoachingSections, string> = {
  identity: 'Identity',
  context: 'Context',
  steps: 'Steps',
  output: 'Output',
  guardrails: 'Guardrails',
};

export function hasCompleteCoachingSections(
  sections: CoachingSections | null | undefined,
): sections is CoachingSections {
  if (!sections) {
    return false;
  }

  return SECTION_ORDER.every((key) => typeof sections[key] === 'string' && sections[key].trim());
}

export function formatAgentPromptDocument(sections: CoachingSections): string {
  const blocks = SECTION_ORDER.map((key) => {
    const body = sections[key].trim();
    return `## ${SECTION_TITLES[key]}\n\n${body}`;
  });

  return `${blocks.join('\n\n')}\n`;
}
