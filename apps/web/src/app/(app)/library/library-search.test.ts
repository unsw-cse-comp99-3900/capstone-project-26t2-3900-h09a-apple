import { describe, expect, it } from 'vitest';
import type { SopLibraryItem } from '@h09a/types';

import {
  applyLibraryChip,
  countLibraryChips,
  filterAndRankSops,
  isRecentlyUpdated,
  rankTitleMatch,
} from './library-search';

function sop(
  partial: Partial<SopLibraryItem> & Pick<SopLibraryItem, 'id' | 'title'>,
): SopLibraryItem {
  return {
    step_count: 3,
    status: 'published',
    ...partial,
  };
}

describe('rankTitleMatch', () => {
  it('matches a substring anywhere in the title', () => {
    expect(rankTitleMatch('How to create a weather agent in Claude', 'weather')).toBe(2);
  });

  it('requires every word for multi-word queries in any order', () => {
    expect(rankTitleMatch('How to create a weather agent', 'agent weather')).toBe(3);
    expect(rankTitleMatch('How to create a weather agent', 'agent storm')).toBeNull();
  });

  it('ranks exact, prefix, substring, then scattered words', () => {
    expect(rankTitleMatch('weather', 'weather')).toBe(0);
    expect(rankTitleMatch('weather agent setup', 'weather')).toBe(1);
    expect(rankTitleMatch('create a weather agent', 'weather')).toBe(2);
    expect(rankTitleMatch('create a weather agent', 'agent weather')).toBe(3);
  });
});

describe('filterAndRankSops', () => {
  it('returns best matches first', () => {
    const items = [
      sop({ id: '1', title: 'create a weather agent' }),
      sop({ id: '2', title: 'weather' }),
      sop({ id: '3', title: 'weather agent setup' }),
      sop({ id: '4', title: 'agent for weather checks' }),
    ];

    expect(filterAndRankSops(items, 'weather').map((item) => item.id)).toEqual([
      '2',
      '3',
      '4',
      '1',
    ]);
  });
});

describe('library chips', () => {
  const now = Date.parse('2026-07-28T00:00:00.000Z');

  const items = [
    sop({
      id: 'mine-recent',
      title: 'Mine recent',
      published_at: '2026-07-20T00:00:00.000Z',
    }),
    sop({
      id: 'other-old',
      title: 'Other old',
      published_at: '2026-01-01T00:00:00.000Z',
    }),
    sop({
      id: 'mine-old',
      title: 'Mine old',
      published_at: '2025-12-01T00:00:00.000Z',
    }),
  ];

  const mineIds = new Set(['mine-recent', 'mine-old']);

  it('counts All, Recently updated, and Mine independently', () => {
    expect(countLibraryChips(items, mineIds, now)).toEqual({
      all: 3,
      recent: 1,
      mine: 2,
    });
  });

  it('applies chip filters', () => {
    expect(applyLibraryChip(items, 'recent', mineIds, now).map((item) => item.id)).toEqual([
      'mine-recent',
    ]);
    expect(applyLibraryChip(items, 'mine', mineIds, now).map((item) => item.id)).toEqual([
      'mine-recent',
      'mine-old',
    ]);
  });

  it('treats missing published_at as not recent', () => {
    expect(isRecentlyUpdated(sop({ id: 'd', title: 'Draft' }), now)).toBe(false);
  });
});
