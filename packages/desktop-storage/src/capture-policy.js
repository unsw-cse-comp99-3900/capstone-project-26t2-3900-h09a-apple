import { maskValue } from './mask-value.js';

const CLIPBOARD_TYPES = new Set([
  'CLIPBOARD_COPY',
  'CLIPBOARD_PASTE',
  'clipboard_copy',
  'clipboard_paste',
]);

const FILE_TYPES = new Set([
  'FILE_SELECT',
  'FILE_OPEN',
  'FILE_SAVE',
  'FILE_UPLOAD',
  'FILE_DOWNLOAD',
  'file_select',
  'file_open',
  'file_save',
  'file_upload',
  'file_download',
]);

const TEXT_INPUT_TYPES = new Set(['TEXT_INPUT', 'text_input', 'INPUT', 'DOM_INPUT', 'dom_input']);

const SENSITIVE_ATTR_KEYS = new Set([
  'content',
  'text',
  'clipboard',
  'clipboard_content',
  'clipboardContent',
  'data',
  'raw',
  'raw_value',
  'rawValue',
  'password',
  'secret',
]);

const PATH_ATTR_KEYS = new Set([
  'path',
  'fullPath',
  'full_path',
  'absolutePath',
  'absolute_path',
  'filePath',
  'file_path',
  'sourcePath',
  'source_path',
  'destPath',
  'dest_path',
]);

function normalizeType(type) {
  return String(type ?? '');
}

function normalizeCategory(category) {
  return String(category ?? '').toLowerCase();
}

export function isClipboardEvent(event) {
  const type = normalizeType(event.type);
  const category = normalizeCategory(event.category);
  return CLIPBOARD_TYPES.has(type) || category === 'clipboard';
}

export function isFileEvent(event) {
  const type = normalizeType(event.type);
  const category = normalizeCategory(event.category);
  return FILE_TYPES.has(type) || category === 'file';
}

export function isTextInputEvent(event) {
  const type = normalizeType(event.type);

  if (TEXT_INPUT_TYPES.has(type)) {
    return true;
  }

  if (type === 'input' || type === 'INPUT') {
    return event.value != null && event.value !== '';
  }

  return false;
}

export function isPasswordFieldEvent(event) {
  const attrs = event.attrs && typeof event.attrs === 'object' ? event.attrs : {};
  const fieldType = String(
    attrs.field_type ?? attrs.fieldType ?? attrs.input_type ?? attrs.inputType ?? '',
  ).toLowerCase();

  if (fieldType === 'password') {
    return true;
  }

  if (attrs.is_password === true || attrs.isPassword === true) {
    return true;
  }

  if (attrs.password === true) {
    return true;
  }

  return false;
}

export function isSensitiveRetentionCategory(event) {
  return isClipboardEvent(event) || isFileEvent(event);
}

function basenameFromPath(pathValue) {
  const normalized = String(pathValue).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function extensionFromFileName(fileName) {
  const match = String(fileName).match(/\.([^.]+)$/);
  return match ? match[1] : null;
}

export function maskFilePathFields(attrs = {}) {
  const next = { ...attrs };
  let sourcePath = null;

  for (const key of PATH_ATTR_KEYS) {
    if (typeof next[key] === 'string' && next[key].length > 0) {
      sourcePath = next[key];
      delete next[key];
    }
  }

  const fileName =
    typeof next.fileName === 'string' && next.fileName.length > 0
      ? next.fileName
      : sourcePath
        ? basenameFromPath(sourcePath)
        : typeof next.file_name === 'string'
          ? next.file_name
          : null;

  if (fileName) {
    next.fileName = fileName;
    delete next.file_name;
    next.fileExt = next.fileExt ?? next.file_ext ?? extensionFromFileName(fileName);
    delete next.file_ext;
    next.pathMasked = `***/${fileName}`;
  } else if (sourcePath) {
    next.pathMasked = '***';
  }

  return next;
}

function stripSensitiveAttrKeys(attrs = {}) {
  const next = { ...attrs };

  for (const key of SENSITIVE_ATTR_KEYS) {
    if (key in next) {
      delete next[key];
    }
  }

  return next;
}

export function applyCapturePolicy(event) {
  if (isPasswordFieldEvent(event)) {
    return {
      event: null,
      redacted: false,
      skipped: true,
      reason: 'password_field',
    };
  }

  let redacted = false;
  const next = {
    ...event,
    attrs: event.attrs && typeof event.attrs === 'object' ? { ...event.attrs } : {},
  };

  if (isClipboardEvent(next)) {
    if (next.value != null && next.value !== '') {
      redacted = true;
    }
    next.value = null;
    const strippedAttrs = stripSensitiveAttrKeys(next.attrs);
    if (Object.keys(strippedAttrs).length !== Object.keys(next.attrs).length) {
      redacted = true;
    }
    const allowed = {};
    for (const key of [
      'contentType',
      'content_type',
      'sourceApp',
      'source_app',
      'targetApp',
      'target_app',
      'foreground_app',
      'window_title',
      'platform',
    ]) {
      if (strippedAttrs[key] != null) {
        allowed[key] = strippedAttrs[key];
      }
    }
    if (Object.keys(strippedAttrs).length !== Object.keys(allowed).length) {
      redacted = true;
    }
    next.attrs = allowed;
    return {
      event: next,
      redacted,
      skipped: false,
      reason: 'clipboard_metadata_only',
    };
  }

  if (isFileEvent(next)) {
    const before = JSON.stringify(next.attrs);
    next.attrs = maskFilePathFields(stripSensitiveAttrKeys(next.attrs));
    if (next.value != null && next.value !== '') {
      const asPath = String(next.value);
      if (asPath.includes('/') || asPath.includes('\\')) {
        const fileName = basenameFromPath(asPath);
        next.attrs.fileName = next.attrs.fileName ?? fileName;
        next.attrs.fileExt = next.attrs.fileExt ?? extensionFromFileName(fileName);
        next.attrs.pathMasked = next.attrs.pathMasked ?? `***/${fileName}`;
        next.value = null;
        redacted = true;
      }
    }
    if (JSON.stringify(next.attrs) !== before) {
      redacted = true;
    }
    return { event: next, redacted, skipped: false, reason: redacted ? 'file_path_masked' : null };
  }

  if (isTextInputEvent(next)) {
    const forceMask = Boolean(next.attrs.force_mask || next.attrs.pii);
    const original = next.value;
    const masked = maskValue(original, { forceMask });
    if (masked !== original) {
      redacted = true;
    }
    next.value = masked;
    if (typeof next.attrs.text === 'string') {
      const maskedText = maskValue(next.attrs.text, { forceMask });
      if (maskedText !== next.attrs.text) {
        redacted = true;
      }
      next.attrs.textMasked = maskedText;
      delete next.attrs.text;
    }
    if (typeof next.attrs.textMasked === 'string') {
      next.attrs.textMasked = maskValue(next.attrs.textMasked, { forceMask });
    }
    return { event: next, redacted, skipped: false, reason: redacted ? 'text_masked' : null };
  }

  return { event: next, redacted: false, skipped: false, reason: null };
}

export function applyDefensiveRedaction(event) {
  let stripped = false;
  const next = {
    ...event,
    attrs: event.attrs && typeof event.attrs === 'object' ? { ...event.attrs } : {},
  };

  if (isClipboardEvent(next)) {
    if (next.value != null && next.value !== '') {
      next.value = null;
      stripped = true;
    }
    for (const key of SENSITIVE_ATTR_KEYS) {
      if (key in next.attrs) {
        delete next.attrs[key];
        stripped = true;
      }
    }
  }

  if (isFileEvent(next)) {
    for (const key of PATH_ATTR_KEYS) {
      if (key in next.attrs) {
        delete next.attrs[key];
        stripped = true;
      }
    }
    if (typeof next.value === 'string' && (next.value.includes('/') || next.value.includes('\\'))) {
      next.value = null;
      stripped = true;
    }
  }

  return { event: next, stripped };
}
