// Background service worker

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

let panelOpen = false;
let captureTabId = null;

async function setCaptureEnabled(tabId, enabled) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PAM_SET_CAPTURE', enabled: enabled === true });
  } catch {
    // Ignore tabs that can't receive messages (e.g. chrome:// pages).
  }
}

async function enableCaptureForTab(tabId) {
  if (!tabId) return;
  if (captureTabId && captureTabId !== tabId) {
    await setCaptureEnabled(captureTabId, false);
  }
  captureTabId = tabId;
  await setCaptureEnabled(tabId, true);
}

async function disableCapture() {
  if (!captureTabId) return;
  const tabId = captureTabId;
  captureTabId = null;
  await setCaptureEnabled(tabId, false);
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!panelOpen) return;
  await enableCaptureForTab(activeInfo.tabId);
});

chrome.action.onClicked.addListener((tab) => {
  // Enable capture immediately so typing works even before the panel script finishes loading.
  if (tab?.id) {
    enableCaptureForTab(tab.id);
    setTimeout(() => {
      if (!panelOpen) {
        disableCapture();
      }
    }, 1500);
  }

  // When toggling the side panel, request input focus (best effort).
  const delaysMs = [0, 50, 150, 300, 500, 800, 1200];
  delaysMs.forEach((delayMs) => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'FOCUS_USER_INPUT' }, () => {
        void chrome.runtime.lastError;
      });
    }, delayMs);
  });
});

// Listen for messages from the sidepanel/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === 'PAM_SIDE_PANEL_STATE') {
    panelOpen = request.open === true;
    if (panelOpen) {
      enableCaptureForTab(request.tabId);
    } else {
      disableCapture();
    }
    sendResponse({ ok: true });
    return false;
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
