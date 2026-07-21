import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_SENSITIVE_APP_PATTERNS = [
  '1password',
  'bitwarden',
  'keepass',
  'keepassxc',
  'lastpass',
  'dashlane',
  'nordpass',
  'enpass',
  'roboform',
  'credential manager',
  'windows security',
  'banking',
  'bank of',
  'chase',
  'wellsfargo',
  'paypal',
];

export function normalizeSensitivePatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return [...DEFAULT_SENSITIVE_APP_PATTERNS];
  }

  const normalized = patterns
    .map((pattern) =>
      String(pattern ?? '')
        .trim()
        .toLowerCase(),
    )
    .filter((pattern) => pattern.length > 0);

  return normalized.length > 0 ? normalized : [...DEFAULT_SENSITIVE_APP_PATTERNS];
}

export function loadSensitiveAppConfig(configPath) {
  if (!configPath || !existsSync(configPath)) {
    return {
      patterns: [...DEFAULT_SENSITIVE_APP_PATTERNS],
      source: 'default',
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    return {
      patterns: normalizeSensitivePatterns(parsed.patterns ?? parsed),
      source: 'file',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[desktop-storage] Failed to load sensitive-apps config (${configPath}): ${message}`,
    );
    return {
      patterns: [...DEFAULT_SENSITIVE_APP_PATTERNS],
      source: 'default_fallback',
    };
  }
}

export function saveSensitiveAppConfig(configPath, patterns) {
  mkdirSync(dirname(configPath), { recursive: true });
  const payload = {
    patterns: normalizeSensitivePatterns(patterns),
  };
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function matchSensitiveForeground(
  foregroundApp,
  windowTitle,
  patterns = DEFAULT_SENSITIVE_APP_PATTERNS,
) {
  const haystacks = [
    String(foregroundApp ?? '').toLowerCase(),
    String(windowTitle ?? '').toLowerCase(),
  ];

  for (const pattern of normalizeSensitivePatterns(patterns)) {
    if (haystacks.some((haystack) => haystack.includes(pattern))) {
      return pattern;
    }
  }

  return null;
}
