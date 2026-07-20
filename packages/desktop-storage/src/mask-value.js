// Mirrors apps/extension/src/content.js maskValue regex stage.
export function maskValue(value, { forceMask = false } = {}) {
  if (value == null || value === '') {
    return value;
  }

  if (forceMask) {
    return '[MASKED]';
  }

  let maskedValue = String(value);
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const idRegex = /\b\d{5,}\b/g;
  const dateRegex = /\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g;

  maskedValue = maskedValue.replace(emailRegex, '[MASKED]');
  maskedValue = maskedValue.replace(idRegex, '[MASKED]');
  maskedValue = maskedValue.replace(dateRegex, '[MASKED]');
  return maskedValue;
}
