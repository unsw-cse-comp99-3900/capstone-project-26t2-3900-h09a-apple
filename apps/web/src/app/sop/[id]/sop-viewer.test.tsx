import type { SopDetailPayload, SopStepResponse } from '@h09a/types';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SopStepCard, SopViewer } from './sop-viewer';

function step(
  order: number,
  title: string,
  sourceEventId: string,
  extra: Partial<SopStepResponse> & { branch?: string | null } = {},
): SopStepResponse & { branch?: string | null } {
  return {
    order,
    title,
    instruction: `Complete ${title.toLowerCase()}.`,
    source_event_ids: [sourceEventId],
    screenshot_url: null,
    screenshot_highlight: null,
    ...extra,
  };
}

describe('SopStepCard', () => {
  it('renders warning, branch and plain step variants', () => {
    const warningMarkup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={1}
        title="Check invoice"
        instruction="Open the invoice details."
        warning="Invoice details were opened twice."
        screenshotUrl={null}
      />,
    );
    const branchMarkup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={2}
        title="Choose approval path"
        instruction="Select the matching approval queue."
        branch="If the amount is over $500, route to manager approval."
        screenshotUrl="https://example.com/approval.png"
      />,
    );
    const plainMarkup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={3}
        title="Submit request"
        instruction="Submit the completed request."
        screenshotUrl={null}
        timeEstimate={5}
      />,
    );

    expect(warningMarkup).toContain('Warning');
    expect(warningMarkup).toContain('Invoice details were opened twice.');
    expect(branchMarkup).toContain('Branch');
    expect(branchMarkup).toContain('If the amount is over $500');
    expect(branchMarkup).toContain('https://example.com/approval.png');
    expect(plainMarkup).toContain('Submit request');
    expect(plainMarkup).toContain('Estimated time: 5s');
    expect(plainMarkup).toContain('No screenshot captured for this step');
    expect(plainMarkup).not.toContain('Warning');
    expect(plainMarkup).not.toContain('Branch');
  });

  it('formats estimated time in seconds and minutes', () => {
    const secondsMarkup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={1}
        title="Short step"
        instruction="Do a quick action."
        screenshotUrl={null}
        timeEstimate={45}
      />,
    );

    const exactMinuteMarkup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={2}
        title="Minute step"
        instruction="Do a longer action."
        screenshotUrl={null}
        timeEstimate={60}
      />,
    );

    const mixedMarkup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={3}
        title="Mixed step"
        instruction="Do a longer action."
        screenshotUrl={null}
        timeEstimate={75}
      />,
    );

    expect(secondsMarkup).toContain('Estimated time: 45s');
    expect(exactMinuteMarkup).toContain('Estimated time: 1m');
    expect(mixedMarkup).toContain('Estimated time: 1m 15s');
  });

  it('moves URL-like titles into a muted subtitle', () => {
    const markup = renderToStaticMarkup(
      <SopStepCard
        stepNumber={1}
        title="https://example.com/login?redirect=/dashboard"
        instruction="Open https://example.com/login?redirect=/dashboard."
        screenshotUrl={null}
      />,
    );

    expect(markup).toContain('<h2>Open page</h2>');
    expect(markup).toContain('example.com/login');
    expect(markup).toContain('title="https://example.com/login?redirect=/dashboard"');
    expect(markup).not.toContain('<h2>https://example.com/login?redirect=/dashboard</h2>');
  });
});

describe('SopViewer', () => {
  it('renders the SOP header and maps ordered steps to cards', () => {
    const sop: SopDetailPayload = {
      id: 'sop-1',
      title: 'Invoice Approval SOP',
      summary: '3 step workflow',
      version: 2,
      generated_at: '2026-06-28T08:20:00Z',
      status: 'draft',
      steps: [
        step(3, 'Submit request', 'event-3', {
          time_estimate: 5,
          screenshot_url: 'https://example.com/submit.png',
          screenshot_highlight: {
            x: 320,
            y: 180,
            width: 160,
            height: 90,
            viewport_width: 1280,
            viewport_height: 720,
          },
        }),
        step(1, 'Check invoice', 'event-1'),
        step(2, 'Choose approval path', 'event-2', {
          branch: 'If the amount is over $500, route to manager approval.',
        }),
      ],
      warnings: [
        {
          type: 'repeated_action',
          message: 'Invoice details were opened twice.',
          source_event_ids: ['event-1'],
        },
      ],
    };

    const markup = renderToStaticMarkup(<SopViewer sop={sop} />);

    expect(markup).toContain('Invoice Approval SOP');
    expect(markup).toContain('v2');
    expect(markup).toContain('3 total');
    expect(markup.indexOf('Check invoice')).toBeLessThan(markup.indexOf('Choose approval path'));
    expect(markup.indexOf('Choose approval path')).toBeLessThan(markup.indexOf('Submit request'));
    expect(markup).toContain('Invoice details were opened twice.');
    expect(markup).toContain('If the amount is over $500');
    expect(markup).toContain('Estimated time: 5s');
    expect(markup).toContain('left:25%');
    expect(markup).toContain('top:25%');
    expect(markup).toContain('width:12.5%');
  });
});
