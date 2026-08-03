/** Split display names / email locals on spaces and common separators. */
export function nameTokens(source) {
  return String(source || '')
    .replace(/[._-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function displayNameFromEmail(email) {
  const local =
    String(email || '')
      .split('@')[0]
      ?.trim() || 'User';
  return nameTokens(local)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Avatar initials:
 * - "Wek Man" / "week6-manager" -> WM
 * - "ANN BEE WEE" -> AB
 * - single token "Man" -> MA, "Wan" -> WA
 */
export function avatarInitials(displayName, email = '') {
  const source = String(displayName || '').trim() || String(email || '').split('@')[0] || 'U';
  const parts = nameTokens(source);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  const single = parts[0] || 'U';
  return single.slice(0, 2).toUpperCase();
}
