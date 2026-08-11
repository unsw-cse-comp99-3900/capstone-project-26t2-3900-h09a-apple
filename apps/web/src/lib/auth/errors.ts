/**
 * Normalises FastAPI auth error payloads for forms.
 */

type ValidationDetail = {
  loc?: unknown[];
  msg?: string;
};

/** Flatten FastAPI detail payloads into a user-facing string. */
export function formatApiDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (typeof item !== 'object' || item === null) {
          return null;
        }

        const entry = item as ValidationDetail;
        if (!entry.msg) {
          return null;
        }

        const location = Array.isArray(entry.loc)
          ? entry.loc.filter((part) => part !== 'body').join('.')
          : '';

        return location ? `${location}: ${entry.msg}` : entry.msg;
      })
      .filter((message): message is string => Boolean(message));

    return messages.length > 0 ? messages.join(' ') : fallback;
  }

  if (typeof detail === 'object' && detail !== null && 'msg' in detail) {
    const message = (detail as ValidationDetail).msg;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback;
}
