// Background service worker

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// MV3 service workers are ephemeral; keep minimal state in session storage so shortcut
// focus + key-capture behavior stays consistent across worker restarts.
const SESSION_KEYS = {
  panelOpen: 'pam_panel_open',
  captureTabId: 'pam_capture_tab_id',
  captureKeyQueue: 'pam_capture_key_queue'
};

const sessionStorage = chrome.storage?.session ?? null;

let panelOpen = false;
let captureTabId = null;
let captureKeyQueue = [];
let _stateHydratePromise = null;
let _lastOpenRequestAt = 0;

const MAX_CAPTURE_KEY_QUEUE = 250;

async function ensureStateHydrated() {
  if (_stateHydratePromise) return _stateHydratePromise;
  _stateHydratePromise = (async () => {
    if (!sessionStorage) return;
    const state = await sessionStorage.get([
      SESSION_KEYS.panelOpen,
      SESSION_KEYS.captureTabId,
      SESSION_KEYS.captureKeyQueue
    ]);
    panelOpen = state[SESSION_KEYS.panelOpen] === true;
    const storedCaptureTabId = state[SESSION_KEYS.captureTabId];
    captureTabId = typeof storedCaptureTabId === 'number' ? storedCaptureTabId : null;

    const storedCaptureKeyQueue = state[SESSION_KEYS.captureKeyQueue];
    captureKeyQueue = Array.isArray(storedCaptureKeyQueue) ? storedCaptureKeyQueue : [];
  })().catch(() => {});
  return _stateHydratePromise;
}

async function persistPanelOpen(open) {
  if (!sessionStorage) return;
  try {
    await sessionStorage.set({ [SESSION_KEYS.panelOpen]: open === true });
  } catch {
  }
}

async function persistCaptureTabId(tabId) {
  if (!sessionStorage) return;
  try {
    await sessionStorage.set({ [SESSION_KEYS.captureTabId]: typeof tabId === 'number' ? tabId : null });
  } catch {
  }
}

async function persistCaptureKeyQueue(queue) {
  if (!sessionStorage) return;
  try {
    await sessionStorage.set({ [SESSION_KEYS.captureKeyQueue]: Array.isArray(queue) ? queue : [] });
  } catch {
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendMessageToSidePanel(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error });
        return;
      }
      resolve({ ok: true, response });
    });
  });
}

async function pingSidePanel() {
  const result = await sendMessageToSidePanel({ type: 'PAM_PING_SIDE_PANEL' });
  return result.ok && result.response?.ok === true;
}

async function requestSidePanelInputFocus() {
  await sendMessageToSidePanel({ type: 'FOCUS_USER_INPUT' });
}

async function ensureCaptureContentScript(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab?.url || '';
    if (!url) return false;

    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return false;
    }

    let isYouTube = false;
    try {
      const parsed = new URL(url);
      const hostname = (parsed.hostname || '').toLowerCase();
      isYouTube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
    } catch {
      isYouTube = url.includes('youtube.com');
    }
    const file = isYouTube ? 'content.js' : 'content-scraper.js';

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file]
    });
    return true;
  } catch {
    return false;
  }
}

async function setCaptureEnabled(tabId, enabled) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PAM_SET_CAPTURE', enabled: enabled === true });
    return true;
  } catch {
    // Ignore tabs that can't receive messages (e.g. chrome:// pages).
    return false;
  }
}

async function setCaptureEnabledRobust(tabId, enabled) {
  const targetEnabled = enabled === true;
  if (!tabId) return false;

  // Disabling is best-effort; if there's no content script there is nothing to disable.
  if (!targetEnabled) {
    return setCaptureEnabled(tabId, false);
  }

  const maxWaitMs = 2500;
  const pollIntervalMs = 100;
  const start = Date.now();
  let attemptedInject = false;

  while (Date.now() - start < maxWaitMs) {
    const didEnable = await setCaptureEnabled(tabId, true);
    if (didEnable) return true;

    if (!attemptedInject) {
      attemptedInject = true;
      await ensureCaptureContentScript(tabId);
    }

    await sleep(pollIntervalMs);
  }

  return false;
}

async function enableCaptureForTab(tabId) {
  await ensureStateHydrated();
  if (!tabId) return false;

  const didEnable = await setCaptureEnabledRobust(tabId, true);
  if (!didEnable) return false;

  if (captureTabId && captureTabId !== tabId) {
    await setCaptureEnabled(captureTabId, false);
  }
  captureTabId = tabId;
  await persistCaptureTabId(captureTabId);
  return true;
}

async function disableCapture() {
  await ensureStateHydrated();
  if (!captureTabId) return;
  const tabId = captureTabId;
  captureTabId = null;
  await persistCaptureTabId(null);
  await setCaptureEnabled(tabId, false);
}

let _isFlushingCaptureKeyQueue = false;

async function flushCaptureKeyQueue() {
  await ensureStateHydrated();
  if (_isFlushingCaptureKeyQueue) return;
  if (!captureKeyQueue.length) return;

  _isFlushingCaptureKeyQueue = true;
  try {
    while (captureKeyQueue.length) {
      const next = captureKeyQueue[0];
      const result = await sendMessageToSidePanel({
        type: 'PAM_CAPTURE_KEY',
        key: next?.key,
        shiftKey: next?.shiftKey,
        source: 'background'
      });

      if (!(result.ok && result.response?.ok === true)) {
        break;
      }

      captureKeyQueue.shift();
    }
  } finally {
    _isFlushingCaptureKeyQueue = false;
  }

  await persistCaptureKeyQueue(captureKeyQueue);
}

async function clearCaptureKeyQueue() {
  captureKeyQueue = [];
  await persistCaptureKeyQueue(captureKeyQueue);
}

async function enqueueCapturedKey(key, shiftKey) {
  if (!key) return;

  captureKeyQueue.push({ key, shiftKey: shiftKey === true });
  if (captureKeyQueue.length > MAX_CAPTURE_KEY_QUEUE) {
    captureKeyQueue.shift();
  }
  await persistCaptureKeyQueue(captureKeyQueue);
}

async function bootstrapPanelForTab(tabId) {
  const maxWaitMs = 5000;
  const pollIntervalMs = 100;
  const start = Date.now();

  // Best effort focus (may fail if the panel isn't ready yet).
  await requestSidePanelInputFocus();

  await ensureStateHydrated();
  const readyNow = await pingSidePanel();
  if (readyNow) {
    if (!panelOpen) {
      panelOpen = true;
      await persistPanelOpen(true);
    }
    if (tabId) {
      await enableCaptureForTab(tabId);
    }
    await requestSidePanelInputFocus();
    await flushCaptureKeyQueue();
    return;
  }

  if (panelOpen) {
    panelOpen = false;
    await persistPanelOpen(false);
  }

  while (Date.now() - start < maxWaitMs) {
    await ensureStateHydrated();
    if (panelOpen) break;

    const isReady = await pingSidePanel();
    if (isReady) {
      panelOpen = true;
      await persistPanelOpen(true);
      break;
    }
    await sleep(pollIntervalMs);
  }

  await ensureStateHydrated();
  if (panelOpen) {
    if (tabId) {
      await enableCaptureForTab(tabId);
    }
    await requestSidePanelInputFocus();
    await flushCaptureKeyQueue();
  } else {
    await disableCapture();
    await clearCaptureKeyQueue();
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await ensureStateHydrated();
  const isOpen = await pingSidePanel();
  if (!isOpen) {
    if (panelOpen) {
      panelOpen = false;
      await persistPanelOpen(false);
    }
    await disableCapture();
    await clearCaptureKeyQueue();
    return;
  }
  if (!panelOpen) {
    panelOpen = true;
    await persistPanelOpen(true);
  }
  await enableCaptureForTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.active) return;

  await ensureStateHydrated();
  if (!panelOpen) return;

  const isOpen = await pingSidePanel();
  if (!isOpen) {
    panelOpen = false;
    await persistPanelOpen(false);
    await disableCapture();
    await clearCaptureKeyQueue();
    return;
  }

  await enableCaptureForTab(tabId);
});

async function openSidePanelForTab(tabId) {
  try {
    if (!chrome.sidePanel?.open) return false;
    if (!tabId) return false;
    await chrome.sidePanel.open({ tabId });
    return true;
  } catch {
    return false;
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open_side_panel' && command !== '_execute_action') return;

  _lastOpenRequestAt = Date.now();
  await ensureStateHydrated();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id ?? null;

  if (tabId) {
    await enableCaptureForTab(tabId);
    await openSidePanelForTab(tabId);
  }

  await bootstrapPanelForTab(tabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  _lastOpenRequestAt = Date.now();
  await ensureStateHydrated();

  // Enable capture immediately so typing works even before the panel script finishes loading.
  if (tab?.id) {
    await enableCaptureForTab(tab.id);
  }

  // Wait for the side panel to come online and then focus the input.
  if (tab?.id) {
    await openSidePanelForTab(tab.id);
  }
  await bootstrapPanelForTab(tab?.id ?? null);
});

// Listen for messages from the sidepanel/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'PAM_CAPTURE_KEY') {
    if (!sender?.tab) {
      // Ignore forwarded messages to avoid loops.
      return false;
    }

    (async () => {
      try {
        await ensureStateHydrated();

        const key = request.key;
        const shiftKey = request.shiftKey === true;
        const tabId = sender.tab.id;

        // If we already have buffered keys, preserve order by enqueueing.
        if (captureKeyQueue.length) {
          await enqueueCapturedKey(key, shiftKey);
          await flushCaptureKeyQueue();
          sendResponse({ ok: true });
          return;
        }

        const result = await sendMessageToSidePanel({ type: 'PAM_CAPTURE_KEY', key, shiftKey, source: 'background' });
        if (result.ok && result.response?.ok === true) {
          sendResponse({ ok: true });
          return;
        }

        const openingSoon = Date.now() - _lastOpenRequestAt < 5000;
        if (!openingSoon) {
          const isOpen = await pingSidePanel();
          if (!isOpen) {
            // Capture is enabled but the panel isn't available; stop swallowing keys.
            panelOpen = false;
            await persistPanelOpen(false);
            await clearCaptureKeyQueue();
            await setCaptureEnabled(tabId, false);
            sendResponse({ ok: false, error: 'Side panel not available; capture disabled.' });
            return;
          }

          if (!panelOpen) {
            panelOpen = true;
            await persistPanelOpen(true);
          }
        }

        await enqueueCapturedKey(key, shiftKey);
        await flushCaptureKeyQueue();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (request?.type === 'PAM_SIDE_PANEL_STATE') {
    (async () => {
      try {
        await ensureStateHydrated();

        panelOpen = request.open === true;
        await persistPanelOpen(panelOpen);

        if (panelOpen) {
          await enableCaptureForTab(request.tabId);
          await flushCaptureKeyQueue();
        } else {
          await disableCapture();
          await clearCaptureKeyQueue();
          if (request.tabId) {
            await setCaptureEnabled(request.tabId, false);
          }
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (request.type === 'FETCH_URL') {
    const fetchOptions = request.options || {};
    
    fetch(request.url, fetchOptions)
      .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .then(text => {
        sendResponse({ success: true, data: text });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.toString() });
      });
    return true; // Required to use sendResponse asynchronously
  }
});

void ensureStateHydrated();
