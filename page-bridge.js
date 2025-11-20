(function pageBridge() {
    function sendPlayerResponse() {
        if (window.ytInitialPlayerResponse) {
            window.postMessage({
                type: 'YT_PLAYER_RESPONSE',
                data: window.ytInitialPlayerResponse
            }, '*');
        }
    }

    async function handleFetchRequest(event) {
        if (event.source !== window) return;
        const payload = event.data;
        if (!payload || payload.type !== 'CRYPTIC_FETCH_REQUEST') return;

        const { requestId, url } = payload;
        if (!requestId || !url) return;

        try {
            const response = await fetch(url);
            const text = await response.text();
            window.postMessage({
                type: 'CRYPTIC_FETCH_RESPONSE',
                requestId,
                success: true,
                data: text
            }, '*');
        } catch (error) {
            window.postMessage({
                type: 'CRYPTIC_FETCH_RESPONSE',
                requestId,
                success: false,
                error: error?.message || String(error)
            }, '*');
        }
    }
    
    // Try immediately
    sendPlayerResponse();
    
    // Also try when the page navigates/updates (SPF events)
    document.addEventListener('yt-navigate-finish', sendPlayerResponse);
    window.addEventListener('message', handleFetchRequest);
})();

