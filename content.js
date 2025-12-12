// Content script for DOM-based transcript scraping
// This avoids all CORS/CORB issues by letting YouTube fetch its own transcript
// and then we just read it from the DOM

// Simple logger to help debug injection issues
console.log('[ContentScript] Loaded for', window.location.href);

let pamCaptureEnabled = false;

function isEditableElement(element) {
    if (!element) return false;
    const tagName = (element.tagName || '').toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
    if (element.isContentEditable) return true;
    const role = (element.getAttribute && element.getAttribute('role')) || '';
    return role.toLowerCase() === 'textbox';
}

function setPamCaptureEnabled(enabled) {
    pamCaptureEnabled = enabled === true;
    if (pamCaptureEnabled) {
        try {
            const active = document.activeElement;
            if (active && active !== document.body && typeof active.blur === 'function') {
                active.blur();
            }
        } catch {
        }
    }
}

function shouldCaptureKeyEvent(event) {
    if (!pamCaptureEnabled) return false;
    if (event.defaultPrevented) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.isComposing) return false;
    if (isEditableElement(document.activeElement)) return false;

    const key = event.key;
    if (!key) return false;
    if (key === 'Enter' || key === 'Backspace' || key === 'Delete') return true;
    return key.length === 1;
}

document.addEventListener(
    'keydown',
    (event) => {
        if (!shouldCaptureKeyEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();

        chrome.runtime.sendMessage(
            { type: 'PAM_CAPTURE_KEY', key: event.key, shiftKey: event.shiftKey },
            () => void chrome.runtime.lastError
        );
    },
    { capture: true }
);

function getVideoId() {
    const url = new URL(window.location.href);
    return url.searchParams.get('v');
}

function findTranscriptButton() {
    const direct = document.querySelector('button[aria-label*="Transcript" i], button[aria-label*="Show transcript" i]');
    if (direct instanceof HTMLElement) {
        return direct;
    }

    const moreButton = document.querySelector('#more-button button, ytd-menu-renderer button, #button[aria-label*="More actions" i], #button-shape button[aria-label*="More actions" i]');
    if (moreButton instanceof HTMLElement) {
        moreButton.click();
    }
    return Array.from(document.querySelectorAll('yt-formatted-string, tp-yt-paper-item, ytd-menu-service-item-renderer'))
        .find(el => {
            const text = (el.textContent || '').toLowerCase();
            return text.includes('show transcript') || text.includes('transcript');
        });
}

async function openTranscriptPanel() {
    let transcriptButton = findTranscriptButton();

    if (!transcriptButton) {
        // Give the menu a moment to render and try again
        await new Promise(r => setTimeout(r, 400));
        transcriptButton = findTranscriptButton();
    }
    
    if (transcriptButton instanceof HTMLElement) {
        transcriptButton.click();
        return true;
    }
    
    throw new Error('Transcript button not found. This video may not have a transcript available.');
}

async function waitForTranscriptPanel(timeoutMs = 8000) {
    const selectors = [
        'ytd-transcript-search-panel-renderer',
        'ytd-transcript-renderer',
        '[id="transcript"]',
        'ytd-transcript-body-renderer'
    ];
    
    // Check if already present
    for (const selector of selectors) {
        const existing = document.querySelector(selector);
        if (existing) return existing;
    }
    
    // Wait for it to appear
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Transcript panel did not appear within timeout.'));
        }, timeoutMs);
        
        const observer = new MutationObserver(() => {
            for (const selector of selectors) {
                const panel = document.querySelector(selector);
                if (panel) {
                    clearTimeout(timeout);
                    observer.disconnect();
                    resolve(panel);
                    return;
                }
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

function scrapeTranscript(panel) {
    // YouTube uses various selectors for transcript segments
    const segmentSelectors = [
        'ytd-transcript-segment-renderer',
        'ytd-transcript-segment-list-renderer [id="segment"]',
        '.segment',
        '[id="segment-text"]'
    ];
    
    let segments = [];
    
    for (const selector of segmentSelectors) {
        const found = Array.from(panel.querySelectorAll(selector));
        if (found.length > 0) {
            segments = found;
            break;
        }
    }
    
    // If we found segment containers, extract text from each
    if (segments.length > 0) {
        const result = [];
        for (const segment of segments) {
            // Look for the text element within each segment
            const textEl = segment.querySelector('[id="segment-text"], .segment-text, yt-formatted-string');
            if (textEl && textEl.textContent) {
                result.push(textEl.textContent.trim());
            }
        }
        return result.join(' ');
    }
    
    // Fallback: just get all text content from the panel
    const allText = panel.innerText || panel.textContent || '';
    if (allText.trim().length > 0) {
        return allText.trim();
    }
    
    throw new Error('Transcript panel found but no text content could be extracted.');
}

async function getTranscriptFromDom() {
    const videoId = getVideoId();
    if (!videoId) {
        throw new Error('No video ID found in URL. Are you on a YouTube watch page?');
    }
    
    // Hide the transcript panel immediately after opening (optional, for cleaner UX)
    const hideTranscript = () => {
        const panel = document.querySelector('ytd-transcript-search-panel-renderer, ytd-transcript-renderer');
        if (panel) {
            panel.style.display = 'none';
        }
    };
    
    try {
        await openTranscriptPanel();
        const panel = await waitForTranscriptPanel();
        
        // Give it a moment to fully render
        await new Promise(r => setTimeout(r, 500));
        
        const transcript = scrapeTranscript(panel);
        
        // Optionally hide the panel after scraping
        hideTranscript();
        
        return { videoId, transcript };
    } catch (error) {
        // Make sure to hide panel even on error
        hideTranscript();
        throw error;
    }
}

// Listen for transcript requests from the side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PAM_SET_CAPTURE') {
        setPamCaptureEnabled(msg.enabled);
        sendResponse({ ok: true });
        return false;
    }

    // Handle ping to check if content script is loaded
    if (msg.type === 'CRYPTIC_PING') {
        sendResponse({ ok: true });
        return false; // Synchronous response
    }

    if (msg.type === 'CRYPTIC_GET_TRANSCRIPT') {
        (async () => {
            try {
                const data = await getTranscriptFromDom();
                sendResponse({ ok: true, data });
            } catch (error) {
                sendResponse({ 
                    ok: false, 
                    error: error?.message || String(error) 
                });
            }
        })();
        return true; // Indicates we'll send response asynchronously
    }
});
