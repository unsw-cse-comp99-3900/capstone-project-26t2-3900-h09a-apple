/**
 * Convert runtime friction timestamps to the datetime representation expected
 * by the API while preserving already-serialized events.
 *
 * @param {unknown} events
 * @returns {unknown[]}
 */
export function serializeFrictionEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events.map((event) => {
    if (
      event === null ||
      typeof event !== 'object' ||
      typeof event.occurred_at !== 'number' ||
      !Number.isFinite(event.occurred_at)
    ) {
      return event;
    }

    const occurredAt = new Date(event.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) {
      return event;
    }

    return {
      ...event,
      occurred_at: occurredAt.toISOString(),
    };
  });
}
