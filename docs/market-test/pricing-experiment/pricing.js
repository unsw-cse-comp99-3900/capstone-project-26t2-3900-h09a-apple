(function () {
  const api = window.WorkTracePaintedDoor;
  if (!api) return;

  function refreshCounts() {
    const counts = api.countsByTier();
    const ids = ['free', 'solo', 'team', 'business'];
    for (const id of ids) {
      const el = document.getElementById(`count-${id}`);
      if (el) el.textContent = String(counts[id] ?? 0);
    }
  }

  document.querySelectorAll('[data-cta]').forEach((button) => {
    button.addEventListener('click', () => {
      const tier = button.getAttribute('data-cta') || 'unknown';
      const action = button.getAttribute('data-action') || 'unknown';
      api.recordClick(tier, action);
      refreshCounts();
      const target = new URL('./coming-soon.html', location.href);
      target.searchParams.set('tier', tier);
      target.searchParams.set('action', action);
      location.assign(target.toString());
    });
  });

  const exportButton = document.getElementById('export-log');
  if (exportButton) {
    exportButton.addEventListener('click', () => api.exportCsv());
  }

  const clearButton = document.getElementById('clear-log');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      if (confirm('Clear painted-door click log for this browser?')) {
        api.clearLog();
        refreshCounts();
      }
    });
  }

  refreshCounts();
})();
