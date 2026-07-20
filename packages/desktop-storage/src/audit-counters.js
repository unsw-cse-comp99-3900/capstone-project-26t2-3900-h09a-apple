const sessionAudits = new Map();

function emptyAudit(sessionId) {
  return {
    session_id: sessionId,
    captured_by_category: {},
    redacted_by_category: {},
    skipped_password_fields: 0,
    windows_skipped: 0,
    skipped_by_app_pattern: {},
    defensive_strips: 0,
  };
}

export function getOrCreateSessionAudit(sessionId) {
  if (!sessionAudits.has(sessionId)) {
    sessionAudits.set(sessionId, emptyAudit(sessionId));
  }

  return sessionAudits.get(sessionId);
}

export function recordCaptured(sessionId, category) {
  const audit = getOrCreateSessionAudit(sessionId);
  const key = category || 'unknown';
  audit.captured_by_category[key] = (audit.captured_by_category[key] ?? 0) + 1;
}

export function recordRedacted(sessionId, category) {
  const audit = getOrCreateSessionAudit(sessionId);
  const key = category || 'unknown';
  audit.redacted_by_category[key] = (audit.redacted_by_category[key] ?? 0) + 1;
}

export function recordPasswordSkip(sessionId) {
  const audit = getOrCreateSessionAudit(sessionId);
  audit.skipped_password_fields += 1;
}

export function recordWindowSkip(sessionId, pattern) {
  const audit = getOrCreateSessionAudit(sessionId);
  audit.windows_skipped += 1;
  const key = pattern || 'unknown';
  audit.skipped_by_app_pattern[key] = (audit.skipped_by_app_pattern[key] ?? 0) + 1;
}

export function recordDefensiveStrip(sessionId) {
  const audit = getOrCreateSessionAudit(sessionId);
  audit.defensive_strips += 1;
}

export function getSessionAuditSummary(sessionId) {
  const audit = sessionAudits.get(sessionId);
  if (!audit) {
    return emptyAudit(sessionId);
  }

  return structuredClone(audit);
}

export function clearSessionAudit(sessionId) {
  sessionAudits.delete(sessionId);
}

export function resetAllSessionAudits() {
  sessionAudits.clear();
}
