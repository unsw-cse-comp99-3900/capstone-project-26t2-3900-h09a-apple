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

/** Event types accepted by POST /api/v1/sessions (apps/api session_schema.EventType). */
export const API_SESSION_EVENT_TYPES = new Set([
  'click',
  'navigation',
  'input',
  'submit',
  'tab_switch',
  'keydown',
  'clipboard_copy',
  'clipboard_paste',
  'file_select',
  'file_open',
  'file_save',
  'file_upload',
  'file_download',
]);

/**
 * Local / legacy capture type names mapped onto canonical API event types.
 * TEXT_INPUT is semantic typed text and becomes `input`; raw key presses stay
 * `keydown`.
 */
const API_EVENT_TYPE_ALIASES = new Map([
  ['CLICK', 'click'],
  ['NAVIGATION', 'navigation'],
  ['INPUT', 'input'],
  ['TEXT_INPUT', 'input'],
  ['text_input', 'input'],
  ['DOM_INPUT', 'input'],
  ['dom_input', 'input'],
  ['SUBMIT', 'submit'],
  ['TAB_SWITCH', 'tab_switch'],
  ['tab-switch', 'tab_switch'],
  ['KEYDOWN', 'keydown'],
  ['CLIPBOARD_COPY', 'clipboard_copy'],
  ['clipboard_copy', 'clipboard_copy'],
  ['CLIPBOARD_PASTE', 'clipboard_paste'],
  ['clipboard_paste', 'clipboard_paste'],
  ['FILE_SELECT', 'file_select'],
  ['FILE_OPEN', 'file_open'],
  ['FILE_SAVE', 'file_save'],
  ['FILE_UPLOAD', 'file_upload'],
  ['FILE_DOWNLOAD', 'file_download'],
]);

/**
 * Map a locally stored event type onto an API-allowed type, or null if unknown.
 */
export function mapEventTypeForApi(type) {
  if (type == null) {
    return null;
  }

  const raw = String(type);
  if (API_SESSION_EVENT_TYPES.has(raw)) {
    return raw;
  }

  const aliased = API_EVENT_TYPE_ALIASES.get(raw);
  if (aliased) {
    return aliased;
  }

  const lower = raw.toLowerCase();
  if (API_SESSION_EVENT_TYPES.has(lower)) {
    return lower;
  }

  return API_EVENT_TYPE_ALIASES.get(lower) ?? null;
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

  if (attrs.coordinate_space == null && (event.raw_x != null || event.raw_y != null)) {
    attrs.coordinate_space = 'screen';
  }

  if (event.raw_x != null || event.raw_y != null) {
    attrs.raw_coordinates = {
      x: event.raw_x ?? null,
      y: event.raw_y ?? null,
    };
  }

  return attrs;
}

const WT_EVENT_KEYS = new Set([
  'type',
  'target_selector',
  'target_label',
  'value',
  'url',
  'attrs',
  'screenshot_id',
  'timestamp_ms',
]);

function mapStoredEventForApi(event) {
  const type = mapEventTypeForApi(event.type);

  if (!type) {
    return { error: `Unsupported event type for API submit: ${String(event.type)}` };
  }

  return {
    event: removeUndefined({
      type,
      target_selector: event.target_selector ?? null,
      target_label: event.target_label ?? null,
      value: event.value ?? null,
      url: event.url ?? null,
      attrs: buildEventAttrs(event),
      screenshot_id: event.screenshot_id ?? null,
      timestamp_ms: event.timestamp_ms,
    }),
  };
}

function pickWtEventFields(event) {
  return Object.fromEntries(Object.entries(event).filter(([key]) => WT_EVENT_KEYS.has(key)));
}

/**
 * Normalize an assembled or hand-edited session payload for API ingestion.
 * Unknown event types fail loudly — they are never dropped silently.
 */
export function sanitizeSessionPayloadForApi(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Cannot sanitize a session payload without an object');
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const sanitizedEvents = [];
  const referencedScreenshotIds = new Set();

  for (const event of events) {
    const mappedType = mapEventTypeForApi(event?.type);

    if (!mappedType) {
      throw new Error(
        `Unsupported event type for API submit: ${String(event?.type)}. ` +
          `Allowed: ${[...API_SESSION_EVENT_TYPES].join(', ')}`,
      );
    }

    const next = {
      ...pickWtEventFields(event),
      type: mappedType,
      attrs: event?.attrs && typeof event.attrs === 'object' ? event.attrs : {},
      screenshot_id: event?.screenshot_id ?? null,
      timestamp_ms: event?.timestamp_ms,
    };

    if (next.screenshot_id) {
      referencedScreenshotIds.add(String(next.screenshot_id));
    }

    sanitizedEvents.push(next);
  }

  const screenshots = Array.isArray(payload.screenshots)
    ? payload.screenshots.filter((shot) => shot?.id && referencedScreenshotIds.has(String(shot.id)))
    : [];

  const availableIds = new Set(screenshots.map((shot) => String(shot.id)));

  for (const event of sanitizedEvents) {
    if (event.screenshot_id && !availableIds.has(String(event.screenshot_id))) {
      event.screenshot_id = null;
    }
  }

  return {
    payload: {
      client_session_id: payload.client_session_id,
      workflow_name: payload.workflow_name,
      recorded_by: payload.recorded_by ?? null,
      started_at: payload.started_at,
      stopped_at: payload.stopped_at ?? null,
      events: sanitizedEvents,
      screenshots,
    },
    droppedCount: 0,
  };
}

export function assembleSessionFromRows({ session, events, screenshots = [] }) {
  if (!session) {
    throw new Error('Cannot assemble a session without session metadata');
  }

  const sortedEvents = [...events].sort((left, right) => {
    if (left.seq !== right.seq) {
      return left.seq - right.seq;
    }

    return left.timestamp_ms - right.timestamp_ms;
  });

  const apiEvents = [];

  for (const event of sortedEvents) {
    const mapped = mapStoredEventForApi(event);

    if (mapped.error) {
      throw new Error(mapped.error);
    }

    apiEvents.push(mapped.event);
  }

  const referencedScreenshotIds = new Set(
    apiEvents
      .map((event) => event.screenshot_id)
      .filter(Boolean)
      .map(String),
  );

  const apiScreenshots = (screenshots ?? []).filter(
    (shot) => shot?.id && referencedScreenshotIds.has(String(shot.id)),
  );
  const availableIds = new Set(apiScreenshots.map((shot) => String(shot.id)));

  for (const event of apiEvents) {
    if (event.screenshot_id && !availableIds.has(String(event.screenshot_id))) {
      event.screenshot_id = null;
    }
  }

  return {
    client_session_id: session.client_session_id,
    workflow_name: session.workflow_name,
    recorded_by: normalizeRecordedBy(session.recorded_by),
    started_at: toIsoString(session.started_at_ms),
    stopped_at: toIsoString(session.stopped_at_ms),
    events: apiEvents,
    screenshots: apiScreenshots,
  };
}
