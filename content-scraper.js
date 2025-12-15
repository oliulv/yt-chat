(() => {
// Universal content script for scraping webpage content
// Works on any webpage to extract readable article/blog content

const sentinel = '__PAM_YT_CHAT_CONTENT_SCRAPER_LOADED__';
if (globalThis[sentinel]) {
    return;
}
globalThis[sentinel] = true;

console.log('[ContentScraper] Loaded for', window.location.href);

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
        let didSend = false;
        try {
            chrome.runtime.sendMessage(
                { type: 'PAM_CAPTURE_KEY', key: event.key, shiftKey: event.shiftKey },
                () => {
                    const error = chrome.runtime.lastError;
                    if (!error) return;

                    const message = error?.message || String(error);
                    if (
                        message.includes('Extension context invalidated') ||
                        message.includes('Receiving end does not exist')
                    ) {
                        // Extension reloaded/unavailable; stop swallowing keys.
                        pamCaptureEnabled = false;
                    }
                }
            );
            didSend = true;
        } catch {
            // Extension reloaded/unavailable; stop swallowing keys.
            pamCaptureEnabled = false;
        }

        if (!didSend) return;
        event.preventDefault();
        event.stopPropagation();
    },
    { capture: true }
);

/**
 * Remove unwanted elements from the DOM
 */
function removeUnwantedElements(element) {
    // Elements to remove
    const selectorsToRemove = [
        'script',
        'style',
        'nav',
        'header',
        'footer',
        'aside',
        '.ad',
        '.advertisement',
        '.ads',
        '[class*="ad-"]',
        '[id*="ad-"]',
        '.sidebar',
        '.social-share',
        '.comments',
        '.comment-section',
        '.newsletter',
        '.subscribe',
        '.cookie-banner',
        '.popup',
        '.modal',
        '.overlay'
    ];

    // Clone to avoid modifying original
    const clone = element.cloneNode(true);
    
    selectorsToRemove.forEach(selector => {
        const elements = clone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
    });

    return clone;
}

/**
 * Extract main content from the page using heuristics
 */
function extractMainContent() {
    // Strategy 1: Look for semantic HTML5 elements
    const article = document.querySelector('article');
    if (article) {
        const cleaned = removeUnwantedElements(article);
        const text = cleaned.innerText || cleaned.textContent || '';
        if (text.trim().length > 200) {
            return text.trim();
        }
    }

    // Strategy 2: Look for main element
    const main = document.querySelector('main');
    if (main) {
        const cleaned = removeUnwantedElements(main);
        const text = cleaned.innerText || cleaned.textContent || '';
        if (text.trim().length > 200) {
            return text.trim();
        }
    }

    // Strategy 3: Look for common article/content class patterns
    const contentSelectors = [
        '[role="article"]',
        '.article',
        '.article-content',
        '.post-content',
        '.entry-content',
        '.content',
        '.main-content',
        '.post-body',
        '.article-body',
        '#article',
        '#content',
        '#main-content',
        '.story-body',
        '.article-text'
    ];

    for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            const cleaned = removeUnwantedElements(element);
            const text = cleaned.innerText || cleaned.textContent || '';
            if (text.trim().length > 200) {
                return text.trim();
            }
        }
    }

    // Strategy 4: Find the largest text container (likely the main content)
    const allElements = document.querySelectorAll('div, section, p');
    let largestElement = null;
    let largestTextLength = 0;

    allElements.forEach(el => {
        // Skip if it's likely navigation or header/footer
        const tagName = el.tagName.toLowerCase();
        const className = (el.className || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        
        if (
            tagName === 'nav' ||
            className.includes('nav') ||
            className.includes('menu') ||
            className.includes('header') ||
            className.includes('footer') ||
            id.includes('nav') ||
            id.includes('menu') ||
            id.includes('header') ||
            id.includes('footer')
        ) {
            return;
        }

        const text = el.innerText || el.textContent || '';
        const textLength = text.trim().length;
        
        if (textLength > largestTextLength && textLength > 500) {
            largestTextLength = textLength;
            largestElement = el;
        }
    });

    if (largestElement) {
        const cleaned = removeUnwantedElements(largestElement);
        const text = cleaned.innerText || cleaned.textContent || '';
        if (text.trim().length > 200) {
            return text.trim();
        }
    }

    // Strategy 5: Fallback - get body content but clean it
    const body = document.body;
    if (body) {
        const cleaned = removeUnwantedElements(body);
        const text = cleaned.innerText || cleaned.textContent || '';
        // Clean up excessive whitespace
        return text.replace(/\s+/g, ' ').trim();
    }

    return '';
}

/**
 * Clean and format the extracted text
 */
function cleanText(text) {
    if (!text) return '';
    
    // Remove excessive whitespace
    let cleaned = text.replace(/\s+/g, ' ');
    
    // Remove multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // Trim
    cleaned = cleaned.trim();
    
    return cleaned;
}

/**
 * Scrape the current page
 */
async function scrapePage() {
    try {
        const content = extractMainContent();
        const cleaned = cleanText(content);
        
        if (!cleaned || cleaned.length < 100) {
            throw new Error('No sufficient readable content found on this page');
        }

        return {
            content: cleaned,
            url: window.location.href,
            title: document.title
        };
    } catch (error) {
        throw new Error(`Failed to scrape page: ${error.message}`);
    }
}

// Listen for scrape requests from the side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PAM_SET_CAPTURE') {
        setPamCaptureEnabled(msg.enabled);
        sendResponse({ ok: true });
        return false;
    }

    // Handle ping to check if content script is loaded
    if (msg.type === 'CRYPTIC_PING_SCRAPER') {
        sendResponse({ ok: true });
        return false; // Synchronous response
    }

    if (msg.type === 'CRYPTIC_SCRAPE_PAGE') {
        (async () => {
            try {
                const data = await scrapePage();
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

})();
