const URL_PATTERN =
  /\bhttps?:\/\/[^\s)]+|\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s)]*)?/i;

const DEFAULT_TAB_TIMEOUT_MS = 30_000;
const SYNC_ATTEMPTS = 12;
const SYNC_RETRY_MS = 250;

export function normalizeLaunchUrl(value) {
  if (!value) {
    return null;
  }

  const trimmed = String(value)
    .trim()
    .replace(/[.,;:!?]+$/, '');
  if (!trimmed) {
    return null;
  }

  const parseable = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(parseable).toString();
  } catch {
    return null;
  }
}

export function inferStepPageUrl(step) {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const fromExpectedUrl = normalizeLaunchUrl(step.expected_url);
  if (fromExpectedUrl) {
    return fromExpectedUrl;
  }

  const fromPageUrl = normalizeLaunchUrl(step.page_url);
  if (fromPageUrl) {
    return fromPageUrl;
  }

  const instruction = typeof step.instruction === 'string' ? step.instruction : '';
  const match = instruction.match(URL_PATTERN);
  return normalizeLaunchUrl(match?.[0]);
}

export function inferLaunchUrl(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  for (const step of steps) {
    const url = inferStepPageUrl(step);
    if (url) {
      return url;
    }
  }
  return null;
}

export function urlsRequireNavigation(currentHref, targetUrl) {
  const current = normalizeLaunchUrl(currentHref);
  const target = normalizeLaunchUrl(targetUrl);
  if (!target) {
    return false;
  }
  if (!current) {
    return true;
  }

  try {
    const currentUrl = new URL(current);
    const targetParsed = new URL(target);
    return (
      currentUrl.origin !== targetParsed.origin ||
      currentUrl.pathname !== targetParsed.pathname ||
      currentUrl.search !== targetParsed.search
    );
  } catch {
    return true;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runtimeLastErrorMessage() {
  const lastError = globalThis.chrome?.runtime?.lastError;
  return lastError?.message || null;
}

export async function waitForTabComplete(tabsApi, tabId, timeoutMs = DEFAULT_TAB_TIMEOUT_MS) {
  if (!tabsApi?.get || !tabsApi?.onUpdated) {
    return null;
  }

  const existing = await tabsApi.get(tabId);
  if (existing?.status === 'complete') {
    return existing;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the walkthrough page to load.'));
    }, timeoutMs);

    function cleanup() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      tabsApi.onUpdated.removeListener(onUpdated);
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        cleanup();
        resolve(tab);
      }
    }

    tabsApi.onUpdated.addListener(onUpdated);
  });
}

function sendTabMessage(tabsApi, tabId, message) {
  return new Promise((resolve, reject) => {
    if (!tabsApi?.sendMessage) {
      reject(new Error('tabs.sendMessage is unavailable'));
      return;
    }

    tabsApi.sendMessage(tabId, message, (response) => {
      const errorMessage = runtimeLastErrorMessage();
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      resolve(response);
    });
  });
}

export async function syncWalkthroughToTab(tabsApi, tabId, attempts = SYNC_ATTEMPTS) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await sendTabMessage(tabsApi, tabId, { type: 'WALKTHROUGH_SYNC' });
      if (response?.ok) {
        return true;
      }
    } catch {
      // Content script may not be injected yet; retry.
    }
    await delay(SYNC_RETRY_MS);
  }
  return false;
}

export async function ensureWalkthroughPage(tabsApi, storageApi, storageKeys, url, tabId) {
  const normalized = normalizeLaunchUrl(url);
  if (!normalized) {
    throw new Error('Invalid walkthrough page URL.');
  }

  let tab = null;
  if (tabId != null) {
    try {
      tab = await tabsApi.get(tabId);
    } catch {
      tab = null;
    }
  }

  if (!tab?.id) {
    tab = await tabsApi.create({ url: normalized, active: true });
  } else if (urlsRequireNavigation(tab.url, normalized)) {
    tab = await tabsApi.update(tab.id, { url: normalized, active: true });
  } else {
    tab = await tabsApi.update(tab.id, { active: true });
  }

  await waitForTabComplete(tabsApi, tab.id);

  if (storageApi?.session?.get && storageApi?.session?.set && storageKeys?.stateKey) {
    const result = await storageApi.session.get([storageKeys.stateKey]);
    const state = result?.[storageKeys.stateKey];
    if (state?.status === 'playing' && state.tabId !== tab.id) {
      await storageApi.session.set({
        [storageKeys.stateKey]: {
          ...state,
          tabId: tab.id,
        },
      });
    }
  }

  await syncWalkthroughToTab(tabsApi, tab.id);
  return tab;
}
