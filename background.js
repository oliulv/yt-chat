// Background service worker
// Currently just sets the panel behavior to open on click if needed, 
// though "sidePanel" permission usually handles the UI part.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

