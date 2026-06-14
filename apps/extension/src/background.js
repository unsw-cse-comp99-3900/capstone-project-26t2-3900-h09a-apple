chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CLICK' || message.type === 'NAVIGATION' || message.type === 'INPUT') {
    const newEvent = {
      type: message.type,
      payload: message.payload,
      tabId: sender.tab?.id,
      receivedAt: Date.now(),
    };

    // Add event to session storage, prevent Service Worker sleeping causing data loss
    chrome.storage?.session.get({ eventBuffer: [] }).then((result) => {
      const updatedBuffer = [...result.eventBuffer, newEvent];
      chrome.storage.session.set({ eventBuffer: updatedBuffer });
      console.log('Event buffered in session:', newEvent);
    });
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
