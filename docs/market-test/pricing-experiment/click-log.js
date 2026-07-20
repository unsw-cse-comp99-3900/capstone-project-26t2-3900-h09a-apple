(function () {
  const STORAGE_KEY = 'worktrace-painted-door-clicks';

  function readLog() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeLog(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function recordClick(tier, action) {
    const entry = {
      tier: String(tier || 'unknown'),
      action: String(action || 'unknown'),
      ts: new Date().toISOString(),
      href: location.href,
      ua: navigator.userAgent,
    };
    const next = readLog();
    next.push(entry);
    writeLog(next);
    return entry;
  }

  function countsByTier() {
    const counts = { free: 0, solo: 0, team: 0, business: 0, other: 0 };
    for (const entry of readLog()) {
      if (Object.prototype.hasOwnProperty.call(counts, entry.tier)) {
        counts[entry.tier] += 1;
      } else {
        counts.other += 1;
      }
    }
    return counts;
  }

  function toCsv(entries) {
    const header = ['timestamp_iso', 'tier', 'action', 'page_href', 'user_agent'];
    const rows = entries.map((entry) =>
      [entry.ts, entry.tier, entry.action ?? '', entry.href, entry.ua]
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    return [header.join(','), ...rows].join('\n');
  }

  function exportCsv() {
    const csv = toCsv(readLog());
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `worktrace-painted-door-clicks-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function clearLog() {
    localStorage.removeItem(STORAGE_KEY);
  }

  window.WorkTracePaintedDoor = {
    recordClick,
    readLog,
    countsByTier,
    exportCsv,
    clearLog,
    STORAGE_KEY,
  };
})();
