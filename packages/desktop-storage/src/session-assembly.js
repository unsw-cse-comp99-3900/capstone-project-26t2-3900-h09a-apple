function toIsoString(timestampMs) {
  if (timestampMs == null) {
    return null;
  }

  return new Date(timestampMs).toISOString();
}

function normalizeRecordedBy(recordedBy) {
  if (recordedBy == null || recordedBy === '') {
    return null;
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(recordedBy) ? recordedBy : null;
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function buildEventAttrs(event) {
  const attrs = {
    ...(event.attrs ?? {}),
    source: event.source ?? 'user',
    layer: event.layer ?? 'desktop',
    category: event.category ?? 'desktop',
    is_identified: event.is_identified,
    identification_source: event.identification_source ?? null,
  };

  if (event.raw_x != null || event.raw_y != null) {
    attrs.raw_coordinates = {
      x: event.raw_x ?? null,
      y: event.raw_y ?? null,
    };
  }

  return attrs;
}

export function assembleSessionFromRows({ session, events }) {
  if (!session) {
    throw new Error('Cannot assemble a session without session metadata');
  }

  const sortedEvents = [...events].sort((left, right) => {
    if (left.seq !== right.seq) {
      return left.seq - right.seq;
    }

    return left.timestamp_ms - right.timestamp_ms;
  });

  return {
    client_session_id: session.client_session_id,
    workflow_name: session.workflow_name,
    recorded_by: normalizeRecordedBy(session.recorded_by),
    started_at: toIsoString(session.started_at_ms),
    stopped_at: toIsoString(session.stopped_at_ms),
    events: sortedEvents.map((event) =>
      removeUndefined({
        type: event.type,
        target_selector: event.target_selector ?? null,
        target_label: event.target_label ?? null,
        value: event.value ?? null,
        url: event.url ?? null,
        attrs: buildEventAttrs(event),
        screenshot_id: null,
        timestamp_ms: event.timestamp_ms,
      }),
    ),
    screenshots: [],
  };
}
