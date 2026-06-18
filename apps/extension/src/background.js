import { assembleSession } from './session-assembly.js';

let writeQueue = Promise.resolve(); // Create a promise chain to serialize writes

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SESSION_PAYLOAD') {
    const storageKey = `session_${message.sessionId}`;

    chrome.storage.local
      .get([storageKey])
      .then((result) => {
        sendResponse({
          ok: true,
          session: result[storageKey] || null,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to read session payload',
        });
      });

    return true;
  }

  if (message.type === 'CLICK' || message.type === 'NAVIGATION' || message.type === 'INPUT') {
    const newEvent = {
      type: message.type,
      payload: message.payload,
      tabId: sender.tab?.id,
      receivedAt: Date.now(),
    };

    // Serialize storage writes to prevent race conditions during rapid incoming events
    writeQueue = writeQueue
      .then(() => {
        return chrome.storage?.session.get({ eventBuffer: [] }).then((result) => {
          const updatedBuffer = [...result.eventBuffer, newEvent];
          return chrome.storage.session.set({ eventBuffer: updatedBuffer }).then(() => {
            console.log('Event buffered in session:', newEvent);
          });
        });
      })
      .catch((error) => console.error('Failed to write event to storage:', error));
  }
});

// Listen for recording completion to assemble and save the structured session
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recordingState) {
    const oldState = changes.recordingState.oldValue;
    const newState = changes.recordingState.newValue;

    if (oldState?.status === 'recording' && newState?.status === 'completed') {
      // Chain to writeQueue to guarantee we don't assemble while events are still buffering
      writeQueue = writeQueue
        .then(() => {
          return chrome.storage.session.get({ eventBuffer: [] }).then((result) => {
            const sessionPayload = assembleSession(result.eventBuffer, {
              client_session_id: oldState.client_session_id,
              workflowName: oldState.workflowName,
              startedAt: oldState.startedAt,
              stoppedAt: Date.now(),
            });

            const storageKey = `session_${sessionPayload.client_session_id}`;
            return chrome.storage.local.set({ [storageKey]: sessionPayload }).then(() => {
              console.log('Structured session assembled and saved locally:', storageKey);
            });
          });
        })
        .catch((err) => console.error('Failed to assemble session:', err));
    }
  }
});

// When the extension is installed, updated, or the browser is restarted, clear the memory data and reset the recording status
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage?.local.set({ recordingState: { status: 'ready', workflowName: '' } });
  chrome.storage?.session.set({ eventBuffer: [] });
  // Set permissions so that although the Content Scripts do not directly read and write now, they can be trusted to access the Session in the future/or other contexts
  chrome.storage?.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage?.local.set({ recordingState: { status: 'ready', workflowName: '' } });
  chrome.storage?.session.set({ eventBuffer: [] });
});
