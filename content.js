// Content script to access the page's main world
// We need to inject a script tag into the DOM to access the window object
// because content scripts live in an isolated world.

function injectScript() {
    const script = document.createElement('script');
    script.textContent = `
        (function() {
            function sendPlayerResponse() {
                if (window.ytInitialPlayerResponse) {
                    window.postMessage({
                        type: 'YT_PLAYER_RESPONSE',
                        data: window.ytInitialPlayerResponse
                    }, '*');
                }
            }
            
            // Try immediately
            sendPlayerResponse();
            
            // Also try when the page navigates/updates (SPF events)
            document.addEventListener('yt-navigate-finish', sendPlayerResponse);
        })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
}

injectScript();

// Listen for the message from the injected script
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type && event.data.type === 'YT_PLAYER_RESPONSE') {
        // Relay to the extension background/sidepanel
        chrome.runtime.sendMessage({
            type: 'TRANSCRIPT_DATA',
            data: event.data.data
        });
    }
});

