import type { SopLibraryItem } from '@h09a/types';

export type LibraryFilterChip = 'all' | 'recent' | 'mine';

export const RECENT_UPDATED_DAYS = 14;

export type SearchRank = 0 | 1 | 2 | 3;

/** Lower rank number = better match. Null means no match. */
export function rankTitleMatch(title: string, query: string): SearchRank | null {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }

  const allWordsPresent = words.every((word) => normalizedTitle.includes(word));
  if (!allWordsPresent) {
    return null;
  }

  if (normalizedTitle === normalizedQuery) {
    return 0;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 1;
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return 2;
  }

  return 3;
}

export function filterAndRankSops(sops: SopLibraryItem[], query: string): SopLibraryItem[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [...sops];
  }

  return sops
    .map((sop) => ({ sop, rank: rankTitleMatch(sop.title, trimmed) }))
    .filter((entry): entry is { sop: SopLibraryItem; rank: SearchRank } => entry.rank !== null)
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return a.sop.title.localeCompare(b.sop.title);
    })
    .map((entry) => entry.sop);
}

export function isRecentlyUpdated(
  sop: SopLibraryItem,
  nowMs: number = Date.now(),
  withinDays: number = RECENT_UPDATED_DAYS,
): boolean {
  if (!sop.published_at) {
    return false;
  }

  const publishedMs = Date.parse(sop.published_at);
  if (Number.isNaN(publishedMs)) {
    return false;
  }

  return nowMs - publishedMs <= withinDays * 24 * 60 * 60 * 1000;
}

export function applyLibraryChip(
  sops: SopLibraryItem[],
  chip: LibraryFilterChip,
  mineIds: ReadonlySet<string>,
  nowMs: number = Date.now(),
): SopLibraryItem[] {
  if (chip === 'all') {
    return sops;
  }

  if (chip === 'recent') {
    return sops.filter((sop) => isRecentlyUpdated(sop, nowMs));
  }

  return sops.filter((sop) => mineIds.has(sop.id));
}

export function countLibraryChips(
  sops: SopLibraryItem[],
  mineIds: ReadonlySet<string>,
  nowMs: number = Date.now(),
): Record<LibraryFilterChip, number> {
  return {
    all: sops.length,
    recent: sops.filter((sop) => isRecentlyUpdated(sop, nowMs)).length,
    mine: sops.filter((sop) => mineIds.has(sop.id)).length,
  };
}
