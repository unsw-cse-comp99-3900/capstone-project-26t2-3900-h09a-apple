/**
 * Assembles raw buffered events into a structured SessionPayload.
 * Handles chronological sorting and adjacent identical event deduplication.
 */
export function assembleSession(events, metadata) {
  // 1. Sort events chronologically
  const sortedEvents = [...events].sort((a, b) => {
    const timeA = a.payload?.timestamp || a.receivedAt || 0;
    const timeB = b.payload?.timestamp || b.receivedAt || 0;
    return timeA - timeB;
  });

  // 2. Deduplicate adjacent identical events
  const deduplicatedEvents = [];
  for (const current of sortedEvents) {
    const prev = deduplicatedEvents[deduplicatedEvents.length - 1]; // For empty array, arr[-1] will be undefined(js mechanism)

    if (prev && current.type === prev.type) {
      let isDuplicate = false;
      if (current.type === 'NAVIGATION') {
        isDuplicate = current.payload?.url === prev.payload?.url;
      } else if (current.type === 'CLICK') {
        isDuplicate = current.payload?.selector === prev.payload?.selector;
      } else if (current.type === 'INPUT') {
        isDuplicate =
          current.payload?.selector === prev.payload?.selector &&
          current.payload?.value === prev.payload?.value;
      }

      if (isDuplicate) continue; // Skip inserting this event if it's a duplicate
    }
    deduplicatedEvents.push(current);
  }

  // 3. Assemble and return the structured SessionPayload JSON format
  return {
    id: metadata.id || crypto.randomUUID(),
    workflowName: metadata.workflowName || '',
    startedAt: metadata.startedAt || 0,
    stoppedAt: metadata.stoppedAt || Date.now(),
    eventCount: deduplicatedEvents.length,
    events: deduplicatedEvents.map((evt) => ({
      ...evt,
      timestamp_ms: evt.payload?.timestamp || evt.receivedAt || 0, // Enforce schema naming
    })),
  };
}
