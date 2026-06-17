function mapBufferedEventToWTEventInput(evt) {
  const payload = evt.payload || {};
  return {
    type: evt.type.toLowerCase(), // Schema expects lowercase, e.g., 'click'
    target_selector: payload.selector, // Flattened
    target_label: payload.label, // Flattened
    value: payload.value, // Flattened
    url: payload.url, // Flattened
    timestamp_ms: payload.timestamp || evt.receivedAt || 0,
  };
}

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
    client_session_id: metadata.client_session_id || crypto.randomUUID(),
    workflow_name: metadata.workflowName || '',
    started_at: new Date(metadata.startedAt || 0).toISOString(),
    stopped_at: new Date(metadata.stoppedAt || Date.now()).toISOString(),
    event_count: deduplicatedEvents.length,
    events: deduplicatedEvents.map(mapBufferedEventToWTEventInput),
  };
}
