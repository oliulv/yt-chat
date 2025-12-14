import { TranscriptService } from './lib/transcript.js';
import { OpenRouterService } from './lib/openrouter.js';
import { ScraperService } from './lib/scraper.js';

class SidePanelApp {
    constructor() {
        this.transcriptService = new TranscriptService();
        this.scraperService = new ScraperService();
        this.openRouterService = null;
        this.transcript = null;
        this.scrapedContent = null;
        this.lastScrapedUrl = null;
        this.chatHistory = [];
        
        // Video and state tracking
        this.currentVideoId = null;
        this.currentTab = null;
        this.transcriptSent = false;
        this.scrapedContentSent = false;
        this.persistentMode = false;
        this._highlightCleanup = [];
        this._focusRetryIntervalId = null;
        this._announcedPanelOpen = null;
        this._virtualCaretEl = null;
        
        // UI Elements
        this.statusText = document.getElementById('status-text');
        this.chatContainer = document.getElementById('chat-history');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.settingsBtn = document.getElementById('settings-btn');
        this.persistToggleBtn = document.getElementById('persist-toggle-btn');

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.announcePanelState(true);
        window.addEventListener('pagehide', () => this.announcePanelState(false));
        window.addEventListener('beforeunload', () => this.announcePanelState(false));

        this.requestInputFocus({ aggressive: true });
        this.updateVirtualInputUI();
        document.addEventListener('visibilitychange', () => {
            this.announcePanelState(!document.hidden);
            if (!document.hidden) {
                this.requestInputFocus({ aggressive: true });
            }
            this.updateVirtualInputUI();
        });
        window.addEventListener('focus', () => this.updateVirtualInputUI());
        window.addEventListener('blur', () => this.updateVirtualInputUI());

        await this.loadSettings();
        await this.loadPersistentMode();
        await this.loadChatHistory();
        this.checkCurrentTab();
        this.highlightContextCommand(); // Initial highlight check

        // Listen for tab updates to reload context
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            console.log('[SidePanel] Tab updated', {
                tabId,
                changeInfo,
                url: tab?.url,
                status: changeInfo.status,
                active: tab?.active
            });
            
            // Check on URL change or page complete
            if (changeInfo.url || (changeInfo.status === 'complete' && tab.active)) {
                console.log('[SidePanel] Triggering checkCurrentTab from tab update');
                this.checkCurrentTab();
            }
        });
        
        // Also listen for tab activation to catch video changes when switching tabs
        chrome.tabs.onActivated.addListener((activeInfo) => {
            console.log('[SidePanel] Tab activated', activeInfo);
            setTimeout(() => this.checkCurrentTab(), 100); // Small delay to ensure URL is updated
        });

        // Listen for storage changes to update API key and persistent mode
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync') {
                if (changes.apiKey || changes.model) {
                    this.loadSettings();
                }
                if (changes.persistentMode) {
                    this.loadPersistentMode();
                }
            }
        });

    }

    ensureVirtualCaret() {
        if (!this.userInput) return null;
        if (this._virtualCaretEl) return this._virtualCaretEl;

        const caret = document.createElement('div');
        caret.id = 'virtual-caret';
        caret.setAttribute('aria-hidden', 'true');

        const parent = this.userInput.parentElement || document.body;
        parent.appendChild(caret);

        this._virtualCaretEl = caret;
        return caret;
    }

    getCaretCoordinates(textarea, position) {
        const style = window.getComputedStyle(textarea);

        const mirror = document.createElement('div');
        mirror.style.position = 'absolute';
        mirror.style.visibility = 'hidden';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = 'break-word';
        mirror.style.overflow = 'hidden';
        mirror.style.top = '0';
        mirror.style.left = '-9999px';
        mirror.style.boxSizing = style.boxSizing;
        mirror.style.width = textarea.offsetWidth + 'px';
        mirror.style.border = style.border;
        mirror.style.padding = style.padding;
        mirror.style.font = style.font;
        mirror.style.fontFamily = style.fontFamily;
        mirror.style.fontSize = style.fontSize;
        mirror.style.fontWeight = style.fontWeight;
        mirror.style.fontStyle = style.fontStyle;
        mirror.style.letterSpacing = style.letterSpacing;
        mirror.style.lineHeight = style.lineHeight;
        mirror.style.textTransform = style.textTransform;
        mirror.style.textAlign = style.textAlign;

        mirror.textContent = textarea.value.substring(0, position);

        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        mirror.appendChild(marker);

        document.body.appendChild(mirror);
        const left = marker.offsetLeft;
        const top = marker.offsetTop;
        const height = marker.offsetHeight;
        mirror.remove();

        const resolvedHeight = height || parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 14;
        return { left, top, height: resolvedHeight };
    }

    positionVirtualCaret() {
        if (!this.userInput) return;
        const caret = this.ensureVirtualCaret();
        if (!caret) return;

        const style = window.getComputedStyle(this.userInput);
        const borderLeft = parseFloat(style.borderLeftWidth) || 0;
        const borderTop = parseFloat(style.borderTopWidth) || 0;

        const position = this.userInput.value.length;
        const coords = this.getCaretCoordinates(this.userInput, position);

        const left = this.userInput.offsetLeft + borderLeft + coords.left - this.userInput.scrollLeft;
        const top = this.userInput.offsetTop + borderTop + coords.top - this.userInput.scrollTop;

        caret.style.left = left + 'px';
        caret.style.top = top + 'px';
        caret.style.height = coords.height + 'px';
    }

    updateVirtualInputUI() {
        if (!this.userInput) return;

        const showVirtual = !document.hidden && !document.hasFocus();
        this.userInput.classList.toggle('virtual-focus', showVirtual);

        const caret = this.ensureVirtualCaret();
        if (!caret) return;

        if (!showVirtual) {
            caret.style.display = 'none';
            return;
        }

        caret.style.display = 'block';
        requestAnimationFrame(() => this.positionVirtualCaret());
    }

    clearFocusRetry() {
        if (this._focusRetryIntervalId) {
            clearInterval(this._focusRetryIntervalId);
            this._focusRetryIntervalId = null;
        }
    }

    async announcePanelState(open) {
        try {
            const normalizedOpen = open === true;
            if (this._announcedPanelOpen === normalizedOpen) {
                return;
            }
            this._announcedPanelOpen = normalizedOpen;

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            await chrome.runtime.sendMessage({
                type: 'PAM_SIDE_PANEL_STATE',
                open: normalizedOpen,
                tabId: tab?.id ?? null
            });
        } catch {
        }
    }

    requestInputFocus(options = {}) {
        const aggressive = options.aggressive === true;

        this.clearFocusRetry();

        const attemptFocus = () => this.focusInput();

        attemptFocus();
        requestAnimationFrame(attemptFocus);

        if (aggressive) {
            const start = Date.now();
            const maxDurationMs = 5000;

            this._focusRetryIntervalId = setInterval(() => {
                const didFocus = attemptFocus();
                const timedOut = Date.now() - start > maxDurationMs;
                if (didFocus || timedOut) {
                    this.clearFocusRetry();
                }
            }, 100);
        }
    }

    redirectTypingToInput(e) {
        if (!this.userInput || this.userInput.disabled) return;
        if (document.activeElement === this.userInput) return;
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        // Only intercept direct printable characters.
        if (!e.key || e.key.length !== 1) return;

        // Avoid hijacking Space when a button is focused (Space activates buttons).
        if (e.key === ' ') return;

        this.requestInputFocus({ aggressive: true });

        const value = this.userInput.value || '';
        const start = value.length;
        const end = value.length;

        this.userInput.value = value.slice(0, start) + e.key + value.slice(end);
        const cursorPos = start + e.key.length;
        try {
            this.userInput.setSelectionRange(cursorPos, cursorPos);
        } catch {
        }
        this.userInput.dispatchEvent(new Event('input', { bubbles: true }));
        e.preventDefault();
    }

    applyCapturedKey(key, shiftKey) {
        if (!this.userInput || this.userInput.disabled) return;
        this.focusInput();

        if (key === 'Enter') {
            if (shiftKey) {
                this.userInput.value = (this.userInput.value || '') + '\n';
                this.userInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                this.handleSendMessage();
            }
            return;
        }

        if (key === 'Backspace' || key === 'Delete') {
            const value = this.userInput.value || '';
            if (!value) return;
            this.userInput.value = value.slice(0, -1);
            this.userInput.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        if (typeof key === 'string' && key.length === 1) {
            this.userInput.value = (this.userInput.value || '') + key;
            this.userInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    setupEventListeners() {
        this.sendBtn.addEventListener('click', () => this.handleSendMessage());
        
        // Handle Enter key and Shift+Enter for new line
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        // Auto-resize textarea
        this.userInput.addEventListener('input', () => {
            this.userInput.style.height = 'auto';
            this.userInput.style.height = Math.min(this.userInput.scrollHeight, 72) + 'px'; // 72px is roughly 3 lines
            this.highlightContextCommand();
            this.updateVirtualInputUI();
        });
        
        // Highlight /context command on focus/blur
        this.userInput.addEventListener('focus', () => {
            this.highlightContextCommand();
            this.updateVirtualInputUI();
        });
        this.userInput.addEventListener('blur', () => {
            this.highlightContextCommand();
            this.updateVirtualInputUI();
        });

        this.userInput.addEventListener('scroll', () => this.updateVirtualInputUI());
        window.addEventListener('resize', () => this.updateVirtualInputUI());
        
        this.settingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });

        this.persistToggleBtn.addEventListener('click', () => {
            this.togglePersistentMode();
        });

        document.addEventListener('keydown', (e) => this.redirectTypingToInput(e), { capture: true });

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request?.type === 'PAM_PING_SIDE_PANEL') {
                sendResponse({ ok: true });
                return false;
            }

            if (request?.type === 'PAM_CAPTURE_KEY') {
                this.applyCapturedKey(request.key, request.shiftKey);
                sendResponse({ ok: true });
                return false;
            }

            if (request?.type === 'FOCUS_USER_INPUT') {
                this.requestInputFocus({ aggressive: true });
                this.updateVirtualInputUI();
                sendResponse({ ok: true });
            }
        });
    }

    focusInput() {
        // Focus the input field if it exists and is not disabled
        if (this.userInput && !this.userInput.disabled) {
            if (document.activeElement === this.userInput) {
                return true;
            }

            try {
                window.focus();
            } catch {
            }
            try {
                this.userInput.focus({ preventScroll: true });
            } catch {
                this.userInput.focus();
            }
            try {
                const cursorPos = this.userInput.value.length;
                this.userInput.setSelectionRange(cursorPos, cursorPos);
            } catch {
            }
            return document.activeElement === this.userInput;
        }
        return false;
    }

    async loadSettings() {
        const settings = await chrome.storage.sync.get(['apiKey', 'model']);
        if (settings.apiKey) {
            this.openRouterService = new OpenRouterService(settings.apiKey, settings.model);
            this.updateStatus('PAM READY.');
            
            // Remove any persistent error messages about missing API key
            const errorMsgs = document.querySelectorAll('.message.system');
            errorMsgs.forEach(msg => {
                if (msg.textContent.includes('API KEY MISSING')) {
                    msg.remove();
                }
            });
        } else {
            this.updateStatus('API KEY MISSING. CONFIG REQUIRED.');
            this.appendMessage('system', 'PLEASE CONFIGURE API KEY IN SETTINGS.');
        }
    }

    async loadPersistentMode() {
        const settings = await chrome.storage.sync.get(['persistentMode']);
        this.persistentMode = settings.persistentMode || false;
        this.updatePersistToggleUI();
    }

    async togglePersistentMode() {
        this.persistentMode = !this.persistentMode;
        await chrome.storage.sync.set({ persistentMode: this.persistentMode });
        this.updatePersistToggleUI();

        if (this.persistentMode) {
            // Load chat history from storage if available
            await this.loadChatHistory();
        } else {
            // Clear chat history from storage
            await chrome.storage.local.remove(['chatHistory', 'currentVideoId', 'transcriptSent', 'scrapedContentSent']);
        }
    }

    updatePersistToggleUI() {
        if (this.persistToggleBtn) {
            if (this.persistentMode) {
                this.persistToggleBtn.classList.add('active');
                this.persistToggleBtn.textContent = '[PERSIST: ON]';
            } else {
                this.persistToggleBtn.classList.remove('active');
                this.persistToggleBtn.textContent = '[PERSIST: OFF]';
            }
        }
    }

    extractVideoId(url) {
        if (!url) return null;
        const match = url.match(/[?&]v=([^&]+)/);
        return match ? match[1] : null;
    }

    async checkCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Store current tab for use in /context command
        if (tab) {
            this.currentTab = tab;
        }
        
        console.log('[SidePanel] checkCurrentTab called', {
            url: tab?.url,
            currentVideoId: this.currentVideoId,
            persistentMode: this.persistentMode,
            chatHistoryLength: this.chatHistory.length
        });
        
        if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
            const videoId = this.extractVideoId(tab.url);
            
            console.log('[SidePanel] Video ID extracted', {
                videoId,
                currentVideoId: this.currentVideoId,
                videoChanged: videoId && videoId !== this.currentVideoId
            });
            
            // Track if this is a new video before we update currentVideoId
            const isNewVideo = videoId && videoId !== this.currentVideoId;
            
            // Check if video changed
            if (isNewVideo) {
                console.log('[SidePanel] Video changed detected', {
                    from: this.currentVideoId,
                    to: videoId,
                    persistentMode: this.persistentMode
                });
                
                // Keep chat history across mediums; only refresh transcript tracking
                if (this.persistentMode && this.chatHistory.length === 0) {
                    console.log('[SidePanel] Loading chat history from storage (persistent mode)');
                    await this.loadChatHistory();
                }
                
                const previousVideoId = this.currentVideoId;
                this.currentVideoId = videoId;
                this.transcript = null; // Force fetch of new transcript
                this.transcriptSent = false; // New video, need to send transcript
                
                console.log('[SidePanel] Video ID updated without chat reset', {
                    previousVideoId,
                    newVideoId: this.currentVideoId,
                    transcriptSent: this.transcriptSent
                });
            } else if (videoId === this.currentVideoId) {
                // Same video
                console.log('[SidePanel] Same video detected, checking if transcript exists', {
                    videoId,
                    hasTranscript: !!this.transcript,
                    transcriptLength: this.transcript?.length || 0
                });
                
                // If we don't have a transcript, load it
                if (!this.transcript) {
                    console.log('[SidePanel] No transcript found for same video, loading...');
                    // Fall through to load transcript
                } else {
                    // Same video and we have transcript, do nothing
                    console.log('[SidePanel] Same video with transcript, skipping reload');
                    return;
                }
            } else if (!videoId) {
                console.warn('[SidePanel] Could not extract video ID from URL', tab.url);
                this.updateStatus('IDLE. NO PAGE CONTEXT DETECTED.');
                return;
            }

            // Load transcript (for new video or if missing)
            console.log('[SidePanel] Loading transcript...', {
                videoId: this.currentVideoId,
                tabId: tab.id,
                url: tab.url
            });
            
            this.updateStatus('DETECTED VIDEO. FETCHING DATA...');
            try {
                this.transcript = await this.transcriptService.getTranscript(tab.id, tab.url);
                
                // DEBUG: Log transcript length
                console.log('[SidePanel] Transcript loaded successfully', {
                    length: this.transcript ? this.transcript.length : 0,
                    videoId: this.currentVideoId,
                    transcriptSent: this.transcriptSent
                });
                
            this.updateStatus('READY. CONTEXT ACQUIRED.');
                
                // Show system message for new video context
                // Show if this was a new video or if chat is empty (first load)
                const shouldShowMessage = isNewVideo || (this.chatHistory.length === 0 && !this.transcriptSent);
                
                if (shouldShowMessage) {
                    console.log('[SidePanel] Adding system message for new context', {
                        isNewVideo,
                        chatHistoryLength: this.chatHistory.length,
                        transcriptSent: this.transcriptSent,
                        videoId,
                        currentVideoId: this.currentVideoId
                    });
                    this.appendMessage('system', `CONTEXT ACQUIRED: ${tab.title.toUpperCase()}`);
                }
                
                // Ensure currentVideoId is set (in case it wasn't set earlier, e.g., first load)
                if (!this.currentVideoId && videoId) {
                    this.currentVideoId = videoId;
                    console.log('[SidePanel] Set currentVideoId for first time', videoId);
                }
            } catch (error) {
                console.error('[SidePanel] Error loading transcript', error);
                this.updateStatus('TRANSCRIPT ERROR.');
                this.appendMessage('system', `ERROR: COULD NOT LOAD TRANSCRIPT. ${error.message}`);
            }
        } else {
            console.log('[SidePanel] Not a YouTube watch page', {
                url: tab?.url,
                isYouTube: tab?.url?.includes('youtube.com')
            });
            await this.attemptAutoContext(tab);
        }
    }

    updateStatus(text) {
        this.statusText.textContent = text;
    }

    cleanupHighlightOverlay() {
        const overlay = document.getElementById('context-highlight-overlay');
        if (overlay) overlay.remove();
        
        if (this._highlightCleanup && this._highlightCleanup.length) {
            this._highlightCleanup.forEach(fn => fn());
            this._highlightCleanup = [];
        }
    }

    async attemptAutoContext(tab) {
        if (!tab || !tab.url) {
            this.updateStatus('IDLE. OPEN A PAGE TO CAPTURE CONTEXT.');
            return;
        }

        const url = tab.url.toLowerCase();

        // Ignore unsupported pages and YouTube (handled separately)
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
            this.updateStatus('IDLE. OPEN A PAGE TO CAPTURE CONTEXT.');
            return;
        }
        if (url.includes('youtube.com/watch') || url.includes('youtube.com/')) {
            return;
        }

        const content = await this.scrapeTabAndStore(tab);
        if (content) {
            this.updateStatus('READY. CONTEXT ACQUIRED.');
        }
    }

    async findScrapeTab() {
        let tab = null;
        try {
            console.log('[SidePanel] Starting tab query for scraping...');
            const allTabs = await chrome.tabs.query({ currentWindow: true });
            console.log('[SidePanel] All tabs in current window (raw):', allTabs.map(t => ({
                id: t.id,
                url: t.url || '(no URL)',
                active: t.active,
                title: t.title?.substring(0, 50) || '(no title)'
            })));

            const validTabs = allTabs.filter(t => {
                if (!t.url) {
                    console.log('[SidePanel] Skipping tab with no URL:', t.id);
                    return false;
                }
                const url = t.url.toLowerCase();
                const isInvalid = url.startsWith('chrome://') ||
                                  url.startsWith('chrome-extension://') ||
                                  url.startsWith('about:') ||
                                  url.includes('youtube.com/watch');
                if (isInvalid) {
                    console.log('[SidePanel] Skipping invalid URL tab:', { id: t.id, url: t.url });
                    return false;
                }
                return true;
            });

            console.log('[SidePanel] Valid tabs after filtering:', validTabs.map(t => ({
                id: t.id,
                url: t.url,
                title: t.title
            })));

            tab = validTabs.find(t => t.active) || validTabs[0];

            console.log('[SidePanel] Selected tab:', tab ? {
                id: tab.id,
                url: tab.url,
                title: tab.title,
                wasActive: tab.active
            } : 'null');

            if (!tab) {
                console.log('[SidePanel] No valid tab in current window, trying all windows...');
                try {
                    const allWindowTabs = await chrome.tabs.query({});
                    console.log('[SidePanel] All tabs across all windows:', allWindowTabs.length);

                    const validWindowTabs = allWindowTabs.filter(t => {
                        if (!t.url) return false;
                        const url = t.url.toLowerCase();
                        return !url.startsWith('chrome://') &&
                               !url.startsWith('chrome-extension://') &&
                               !url.startsWith('about:') &&
                               !url.includes('youtube.com/watch');
                    });

                    console.log('[SidePanel] Valid tabs across all windows:', validWindowTabs.length);
                    tab = validWindowTabs.find(t => t.active) || validWindowTabs[0];

                    if (tab) {
                        console.log('[SidePanel] Found tab from all windows:', {
                            id: tab.id,
                            url: tab.url,
                            title: tab.title
                        });
                    }
                } catch (err) {
                    console.error('[SidePanel] Error querying all windows:', err);
                }
            }
        } catch (error) {
            console.error('[SidePanel] Error querying tabs:', error);
        }

        if ((!tab || !tab.url) && this.currentTab && this.currentTab.url) {
            const fallbackUrl = this.currentTab.url.toLowerCase();
            const isInvalid = fallbackUrl.startsWith('chrome://') ||
                              fallbackUrl.startsWith('chrome-extension://') ||
                              fallbackUrl.startsWith('about:') ||
                              fallbackUrl.includes('youtube.com/watch');
            if (!isInvalid) {
                tab = this.currentTab;
                console.log('[SidePanel] Using stored currentTab as fallback:', {
                    id: tab.id,
                    url: tab.url,
                    title: tab.title
                });
            }
        }

        return tab && tab.url ? tab : null;
    }

    async scrapeTabAndStore(tab, { force = false } = {}) {
        const url = tab.url.toLowerCase();

        // Avoid re-scraping same page unless forced
        if (!force && this.scrapedContent && this.lastScrapedUrl === tab.url) {
            this.updateStatus('READY. CONTEXT ACQUIRED.');
            return this.scrapedContent;
        }

        if (url.includes('youtube.com/watch') || url.includes('youtube.com/')) {
            return null;
        }

        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
            return null;
        }

        this.updateStatus('SCRAPING PAGE...');
        try {
            const content = await this.scraperService.scrapePage(tab.id, tab.url);
            this.scrapedContent = content;
            this.lastScrapedUrl = tab.url;
            this.scrapedContentSent = false;
            this.appendMessage('system', `CONTEXT ACQUIRED: ${tab.title ? tab.title.toUpperCase() : 'PAGE'}`);
            this.updateStatus('READY. CONTEXT ACQUIRED.');
            return content;
        } catch (error) {
            console.error('[SidePanel] Scraping error:', error);
            this.appendMessage('system', `SCRAPING FAILED: ${error.message}`);
            this.updateStatus('ERROR.');
            return null;
        }
    }

    highlightContextCommand() {
        const text = this.userInput.value;
        const contextRegex = /\/context\b/i;
        
        this.cleanupHighlightOverlay();
        this.userInput.classList.remove('has-context-command');
        
        if (contextRegex.test(text)) {
            this.userInput.classList.add('has-context-command');
            
            const styles = window.getComputedStyle(this.userInput);
            const escapeHtml = (str) => str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // Build overlay that mirrors textarea layout so highlight stays inside bounds
            const overlay = document.createElement('div');
            overlay.id = 'context-highlight-overlay';
            overlay.className = 'context-overlay';
            overlay.style.position = 'absolute';
            overlay.style.pointerEvents = 'none';
            overlay.style.whiteSpace = 'pre-wrap';
            overlay.style.wordWrap = 'break-word';
            overlay.style.font = styles.font;
            overlay.style.fontFamily = styles.fontFamily;
            overlay.style.fontSize = styles.fontSize;
            overlay.style.fontWeight = styles.fontWeight;
            overlay.style.fontStyle = styles.fontStyle;
            overlay.style.letterSpacing = styles.letterSpacing;
            overlay.style.lineHeight = styles.lineHeight;
            overlay.style.padding = styles.padding;
            overlay.style.borderRadius = styles.borderRadius;
            overlay.style.left = this.userInput.offsetLeft + 'px';
            overlay.style.top = this.userInput.offsetTop + 'px';
            overlay.style.width = this.userInput.offsetWidth + 'px';
            overlay.style.height = this.userInput.offsetHeight + 'px';
            overlay.style.overflow = 'hidden';
            overlay.style.zIndex = '1';
            overlay.style.boxSizing = 'border-box';

            const highlighted = escapeHtml(text).replace(/(\/context\b)/gi, '<mark class="context-highlight">$1</mark>');
            overlay.innerHTML = highlighted || '&nbsp;';

            const parent = this.userInput.parentElement || document.body;
            if (parent.style.position === '') {
                parent.style.position = 'relative';
            }
            parent.appendChild(overlay);

            const syncOverlay = () => {
                overlay.style.width = this.userInput.offsetWidth + 'px';
                overlay.style.height = this.userInput.offsetHeight + 'px';
                overlay.scrollTop = this.userInput.scrollTop;
            };
            syncOverlay();

            this._highlightCleanup.push(() => {
                overlay.remove();
                this.userInput.removeEventListener('scroll', syncOverlay);
                window.removeEventListener('resize', syncOverlay);
                this.userInput.removeEventListener('input', syncOverlay);
            });

            this.userInput.addEventListener('scroll', syncOverlay);
            window.addEventListener('resize', syncOverlay);
            this.userInput.addEventListener('input', syncOverlay);
        }
    }

    async handleSendMessage() {
        let text = this.userInput.value.trim();
        if (!text) return;

        if (!this.openRouterService) {
            await this.loadSettings();
            if (!this.openRouterService) {
                this.appendMessage('system', 'ERROR: API KEY NOT CONFIGURED.');
                return;
            }
        }

        // Check for /context command anywhere in the message
        const contextMatch = text.match(/\/context\b/i);
        let userQuestion = text;
        let scrapedContentToUse = null;
        let shouldScrapeOnly = false;

        if (contextMatch) {
            // Extract the part after /context
            const contextIndex = contextMatch.index || 0;
            const matchedCommand = contextMatch[0];
            const afterContext = text.substring(contextIndex + matchedCommand.length).trim();
            
            // If /context is at the start and nothing after, just scrape
            if (contextIndex === 0 && !afterContext) {
                shouldScrapeOnly = true;
                userQuestion = null;
            } else {
                // Remove /context from the message, keep the rest
                userQuestion = text.replace(/\/context\b\s*/gi, '').trim();
                if (!userQuestion) {
                    shouldScrapeOnly = true;
                    userQuestion = null;
                }
            }

            // Always get fresh tab info when scraping
            let tab = null;
            try {
                console.log('[SidePanel] Starting tab query for /context command...');
                
                // Strategy 1: Get ALL tabs in current window and filter out sidepanel/chrome tabs
                const allTabs = await chrome.tabs.query({ currentWindow: true });
                console.log('[SidePanel] All tabs in current window (raw):', allTabs.map(t => ({
                    id: t.id,
                    url: t.url || '(no URL)',
                    active: t.active,
                    title: t.title?.substring(0, 50) || '(no title)'
                })));
                
                // Filter to only tabs with valid URLs (exclude sidepanel tabs which have no URL)
                const validTabs = allTabs.filter(t => {
                    if (!t.url) {
                        console.log('[SidePanel] Skipping tab with no URL:', t.id);
                        return false;
                    }
                    const url = t.url.toLowerCase();
                    const isInvalid = url.startsWith('chrome://') || 
                                     url.startsWith('chrome-extension://') ||
                                     url.startsWith('about:') ||
                                     url.includes('youtube.com/watch');
                    if (isInvalid) {
                        console.log('[SidePanel] Skipping invalid URL tab:', { id: t.id, url: t.url });
                        return false;
                    }
                    return true;
                });
                
                console.log('[SidePanel] Valid tabs after filtering:', validTabs.map(t => ({
                    id: t.id,
                    url: t.url,
                    title: t.title
                })));
                
                // Prefer the active tab if it's valid, otherwise use the first valid tab
                tab = validTabs.find(t => t.active) || validTabs[0];
                
                console.log('[SidePanel] Selected tab:', tab ? {
                    id: tab.id,
                    url: tab.url,
                    title: tab.title,
                    wasActive: tab.active
                } : 'null');
                
                // Strategy 2: If still no tab, try querying all windows
                if (!tab) {
                    console.log('[SidePanel] No valid tab in current window, trying all windows...');
                    try {
                        const allWindowTabs = await chrome.tabs.query({});
                        console.log('[SidePanel] All tabs across all windows:', allWindowTabs.length);
                        
                        const validWindowTabs = allWindowTabs.filter(t => {
                            if (!t.url) return false;
                            const url = t.url.toLowerCase();
                            return !url.startsWith('chrome://') && 
                                   !url.startsWith('chrome-extension://') &&
                                   !url.startsWith('about:') &&
                                   !url.includes('youtube.com/watch');
                        });
                        
                        console.log('[SidePanel] Valid tabs across all windows:', validWindowTabs.length);
                        
                        // Prefer active tab, otherwise first valid
                        tab = validWindowTabs.find(t => t.active) || validWindowTabs[0];
                        
                        if (tab) {
                            console.log('[SidePanel] Found tab from all windows:', {
                                id: tab.id,
                                url: tab.url,
                                title: tab.title
                            });
                        }
                    } catch (err) {
                        console.error('[SidePanel] Error querying all windows:', err);
                    }
                }
            } catch (error) {
                console.error('[SidePanel] Error querying tabs:', error);
            }
            
            // Fallback to last known active tab if queries returned nothing (permissions or timing issues)
            if ((!tab || !tab.url) && this.currentTab && this.currentTab.url) {
                const fallbackUrl = this.currentTab.url.toLowerCase();
                const isInvalid = fallbackUrl.startsWith('chrome://') ||
                                  fallbackUrl.startsWith('chrome-extension://') ||
                                  fallbackUrl.startsWith('about:');
                if (!isInvalid) {
                    tab = this.currentTab;
                    console.log('[SidePanel] Using stored currentTab as fallback:', {
                        id: tab.id,
                        url: tab.url,
                        title: tab.title
                    });
                }
            }

            if (!tab || !tab.url) {
                console.error('[SidePanel] No valid tab found after all attempts', {
                    tab: tab,
                    hasUrl: tab?.url,
                    url: tab?.url
                });
                this.appendMessage('system', 'ERROR: NO ACTIVE TAB FOUND. ENSURE A WEBPAGE IS OPEN.');
                return;
            }
            
            console.log('[SidePanel] Using tab for scraping:', {
                id: tab.id,
                url: tab.url,
                title: tab.title
            });

            // Check if it's a YouTube page (should not scrape)
            const url = tab.url.toLowerCase();
            if (url.includes('youtube.com/watch') || url.includes('youtube.com/')) {
                this.appendMessage('system', 'ERROR: /context NOT AVAILABLE FOR YOUTUBE PAGES. USE VIDEO TRANSCRIPTS INSTEAD.');
                return;
            }

            // Check if it's a chrome:// or chrome-extension:// page
            if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
                this.appendMessage('system', 'ERROR: CANNOT SCRAPE CHROME INTERNAL PAGES.');
                return;
            }

            // Scrape the page
            this.updateStatus('SCRAPING PAGE...');
            try {
                scrapedContentToUse = await this.scraperService.scrapePage(tab.id, tab.url);
                this.scrapedContent = scrapedContentToUse;
                // Reset scrapedContentSent so new content gets added to context
                this.scrapedContentSent = false;
                this.appendMessage('system', `CONTEXT ACQUIRED: ${tab.title ? tab.title.toUpperCase() : 'PAGE'}`);
                
                // If just scraping (no question), we're done
	                if (shouldScrapeOnly) {
	                    this.updateStatus('CONTEXT READY. ASK QUESTIONS.');
	                    // Clear input since we're not sending a message
	                    this.userInput.value = '';
	                    this.userInput.style.height = 'auto';
	                    this.userInput.classList.remove('has-context-command');
	                    this.cleanupHighlightOverlay();
	                    this.updateVirtualInputUI();
	                    return;
	                }
	            } catch (error) {
                console.error('[SidePanel] Scraping error:', error);
                this.appendMessage('system', `SCRAPING FAILED: ${error.message}`);
                this.updateStatus('ERROR.');
	                // Clear input on error
	                this.userInput.value = '';
	                this.userInput.style.height = 'auto';
	                this.userInput.classList.remove('has-context-command');
	                this.cleanupHighlightOverlay();
	                this.updateVirtualInputUI();
	                return;
	            }
	        }

        // Auto-scrape current non-YouTube page if we don't already have it
        if (!contextMatch) {
            const tabForScrape = await this.findScrapeTab();
            if (tabForScrape && tabForScrape.url !== this.lastScrapedUrl) {
                const autoContent = await this.scrapeTabAndStore(tabForScrape);
                if (autoContent) {
                    scrapedContentToUse = autoContent;
                }
            }
        }

        // Clear input and reset height
	        this.userInput.value = '';
	        this.userInput.style.height = 'auto';
	        this.userInput.classList.remove('has-context-command');
	        this.cleanupHighlightOverlay();
	        this.updateVirtualInputUI();
	        
	        // If we scraped but have no question, we already returned above
	        if (!userQuestion) {
	            return;
	        }
        
        // Add user message (use the question, not the command)
        this.appendMessage('user', userQuestion);
        this.chatHistory.push({ role: 'user', content: userQuestion });

        this.updateStatus('PROCESSING...');

        // Determine if we should include transcript (only once per video)
        const includeTranscript = !this.transcriptSent && this.transcript;
        
        // Determine if we should include scraped content (use newly scraped or existing)
        const contentToUse = scrapedContentToUse || this.scrapedContent;
        const includeScrapedContent = contentToUse && !this.scrapedContentSent;
        
        // DEBUG: Check what is being passed
        console.log('[SidePanel] Sending message', {
            includeTranscript,
            transcriptSent: this.transcriptSent,
            hasTranscript: !!this.transcript,
            transcriptLength: this.transcript ? this.transcript.length : 0,
            currentVideoId: this.currentVideoId,
            chatHistoryLength: this.chatHistory.length,
            chatHistoryRoles: this.chatHistory.map(m => m.role),
            chatHistoryPreview: this.chatHistory.map(m => ({
                role: m.role,
                contentPreview: m.content.substring(0, 50) + '...'
            }))
        });

        try {
            // Determine context type and content
            let contextContent = null;
            let contextType = null;
            
            if (includeScrapedContent) {
                contextContent = contentToUse;
                contextType = 'webpage';
            } else if (includeTranscript) {
                contextContent = this.transcript;
                contextType = 'transcript';
            }

            const response = await this.openRouterService.generateResponse(
                this.chatHistory, 
                contextContent,
                contextType
            );
            
            const cleanedResponse = this.sanitizeBotResponse(response) || response;
            this.appendMessage('bot', cleanedResponse);
            
            // IMPORTANT: If we included context, we need to add the system message to chat history
            // so it persists across all future messages
            if (includeScrapedContent) {
                // Add the system message with scraped webpage content to chat history FIRST
                const systemMessage = {
                    role: 'system',
                    content: `You are a helpful, cryptic, and precise assistant. 
You are analyzing the following webpage/article content. 
Answer the user's questions DIRECTLY based on this context. 
Do NOT use phrases like "It seems like", "Based on the article", "The article says". Just state the facts.
Keep answers concise but give enough context to be helpful (think 2-4 sentences). 
When the user asks "what" or "why", include a tight definition plus a quick clarifying detail or example.
Style: Cyberpunk / Terminal / Cryptic.
Do NOT output system/meta wrappers like "STATUS", "DOMAIN", or "END OF LINE". Output only the answer content.
WEBPAGE CONTENT START:
${contentToUse.substring(0, 25000)} 
WEBPAGE CONTENT END.
(Note: webpage/article content may be truncated)`
                };
                // Insert system message at the beginning of chat history
                this.chatHistory.unshift(systemMessage);
                console.log('[SidePanel] Added system message with scraped content to chat history', {
                    systemMessageLength: systemMessage.content.length,
                    chatHistoryLength: this.chatHistory.length
                });
                this.scrapedContentSent = true;
            } else if (includeTranscript) {
                // Add the system message with transcript to chat history FIRST
                const systemMessage = {
                    role: 'system',
                    content: `You are a helpful, cryptic, and precise assistant. 
You are analyzing the following video transcript. 
Answer the user's questions DIRECTLY based on this context. 
Do NOT use phrases like "It seems like", "Based on the transcript", "The speaker says". Just state the facts.
Keep answers concise but give enough context to be helpful (think 2-4 sentences). 
When the user asks "what" or "why", include a tight definition plus a quick clarifying detail or example.
Style: Cyberpunk / Terminal / Cryptic.
Do NOT output system/meta wrappers like "STATUS", "DOMAIN", or "END OF LINE". Output only the answer content.
TRANSCRIPT START:
${this.transcript.substring(0, 25000)} 
TRANSCRIPT END.
(Note: Transcript may be truncated)`
                };
                // Insert system message at the beginning of chat history
                this.chatHistory.unshift(systemMessage);
                console.log('[SidePanel] Added system message with transcript to chat history', {
                    systemMessageLength: systemMessage.content.length,
                    chatHistoryLength: this.chatHistory.length
                });
                this.transcriptSent = true;
            }
            
            // Add assistant response to chat history
            this.chatHistory.push({ role: 'assistant', content: cleanedResponse });
            
            console.log('[SidePanel] Message sent successfully', {
                chatHistoryLength: this.chatHistory.length,
                chatHistoryRoles: this.chatHistory.map(m => m.role),
                transcriptSent: this.transcriptSent
            });
            
            // Save chat history if persistent mode is ON
            await this.saveChatHistory();
            
            this.updateStatus('READY.');
        } catch (error) {
            this.appendMessage('system', `EXECUTION FAILED: ${error.message}`);
            this.updateStatus('ERROR.');
        }
    }

    /**
     * Parse markdown to HTML while maintaining cryptic aesthetic
     * Handles: headers, bold, italic, code blocks, inline code, lists
     */
    sanitizeBotResponse(text) {
        if (typeof text !== 'string') return '';
        let sanitized = text.replace(/\r\n?/g, '\n').trim();

        // Remove stray system/meta wrappers from some model outputs.
        sanitized = sanitized.replace(/\s*>+\s*END\s+OF\s+LINE\.?\s*$/i, '').trim();
        sanitized = this.stripLeadingBotDirectives(sanitized).trim();

        return sanitized;
    }

    stripLeadingBotDirectives(text) {
        let result = text.trimStart();

        for (let i = 0; i < 6; i++) {
            const before = result;

            // Remove leading blank lines.
            result = result.replace(/^(?:\s*\n)+/, '').trimStart();

            result = this.stripLeadingBotDirective(result, 'STATUS');
            result = this.stripLeadingBotDirective(result, 'DOMAIN');

            if (result === before) break;
        }

        return result;
    }

    stripLeadingBotDirective(text, label) {
        const trimmed = text.trimStart();
        const prefixRegex = new RegExp(`^(>\\s*)?${label}\\s*:\\s*`, 'i');
        const match = trimmed.match(prefixRegex);
        if (!match) return text;

        const rest = trimmed.slice(match[0].length);
        const newlineIndex = rest.indexOf('\n');
        const lineValue = newlineIndex === -1 ? rest : rest.slice(0, newlineIndex);
        const afterLine = newlineIndex === -1 ? '' : rest.slice(newlineIndex + 1);

        const isProbablyMetaOnly = (value) => {
            const v = value.trim();
            if (!v) return true;
            if (/[.!?]/.test(v)) return false;
            if (v.length > 120) return false;
            return true;
        };

        if (label === 'STATUS') {
            const domainIndex = rest.search(/>\s*DOMAIN\s*:/i);
            if (domainIndex !== -1 && (newlineIndex === -1 || domainIndex < newlineIndex)) {
                return rest.slice(domainIndex).trimStart();
            }

            if (newlineIndex !== -1 && isProbablyMetaOnly(lineValue)) {
                return afterLine.trimStart();
            }

            const contentOffset = this.findLikelyContentOffset(rest);
            if (contentOffset !== -1) {
                return rest.slice(contentOffset).trimStart();
            }

            return text;
        }

        if (label === 'DOMAIN') {
            if (newlineIndex !== -1) {
                if (isProbablyMetaOnly(lineValue)) {
                    return afterLine.trimStart();
                }

                const contentOffsetInLine = this.findLikelyContentOffset(lineValue);
                if (contentOffsetInLine !== -1) {
                    return rest.slice(contentOffsetInLine).trimStart();
                }

                return text;
            }

            const contentOffset = this.findLikelyContentOffset(rest);
            if (contentOffset !== -1) {
                return rest.slice(contentOffset).trimStart();
            }

            return text;
        }

        return text;
    }

    findLikelyContentOffset(text) {
        const searchSpace = text.slice(0, 300);
        let bestIndex = -1;

        const patterns = [
            /\bThis\b/i,
            /\bThat\b/i,
            /\bThese\b/i,
            /\bThose\b/i,
            /\bThe\b/i,
            /\bA\b/i,
            /\bAn\b/i,
            /\bIn\b/i,
            /\bOn\b/i,
            /\bTo\b/i,
            /\bFor\b/i,
            /\bWhen\b/i,
            /\bWhy\b/i,
            /\bHow\b/i,
            /\bWhat\b/i,
            /\bWhere\b/i,
            /\bWho\b/i,
            /\bIt\b/i,
            /\bOverview\b/i,
            /\bSummary\b/i,
            /\bTL;DR\b/i,
            /\bEnd goal\b/i
        ];

        patterns.forEach((pattern) => {
            const match = searchSpace.match(pattern);
            if (!match || match.index === undefined) return;
            const index = match.index;
            if (index > 0 && (bestIndex === -1 || index < bestIndex)) {
                bestIndex = index;
            }
        });

        const markdownIndexCandidates = [
            searchSpace.search(/#{1,6}\s+\S/),
            searchSpace.search(/-\s+\S/),
            searchSpace.search(/\d+\.\s+\S/)
        ];

        markdownIndexCandidates.forEach((index) => {
            if (index > 0 && (bestIndex === -1 || index < bestIndex)) {
                bestIndex = index;
            }
        });

        return bestIndex;
    }

    parseMarkdown(text) {
        // Escape HTML to prevent XSS
        const escapeHtml = (str) => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        };

        // Use placeholders to protect code blocks from other markdown processing.
        // Placeholders avoid underscores so list/italic regexes don't break them.
        const codeBlockPlaceholders = [];
        let placeholderIndex = 0;

        let html = escapeHtml(text);

        // Step 1: Replace code blocks with placeholders (must be first)
        html = html.replace(/```(?:[a-zA-Z0-9]+\n)?([\s\S]*?)```/g, (match, code) => {
            const placeholder = `<<CODEBLOCK${placeholderIndex}>>`;
            const sanitizedCode = code.trim(); // Already escaped once above
            codeBlockPlaceholders[placeholderIndex] = `<pre class="code-block"><code>${sanitizedCode}</code></pre>`;
            placeholderIndex++;
            return placeholder;
        });

        // Step 2: Replace inline code with placeholders
        const inlineCodePlaceholders = [];
        let inlineIndex = 0;
        html = html.replace(/`([^`\n]+)`/g, (match, code) => {
            const placeholder = `<<INLINECODE${inlineIndex}>>`;
            const sanitizedCode = code; // Already escaped once above
            inlineCodePlaceholders[inlineIndex] = `<code class="inline-code">${sanitizedCode}</code>`;
            inlineIndex++;
            return placeholder;
        });

        // Step 3: Process headers (before lists to maintain hierarchy)
        html = this.processHeaders(html);

        // Step 4: Process lists (before bold/italic to avoid conflicts)
        html = this.processLists(html);

        // Step 5: Process bold (**text** or __text__)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // Step 6: Process italic (*text* or _text_) - single asterisk/underscore
        html = html.replace(/([^*])\*([^*\n]+?)\*([^*])/g, '$1<em>$2</em>$3');
        html = html.replace(/([^_])_([^_\n]+?)_([^_])/g, '$1<em>$2</em>$3');

        // Step 7: Restore inline code placeholders
        inlineCodePlaceholders.forEach((replacement, index) => {
            html = html.replace(`<<INLINECODE${index}>>`, replacement);
        });

        // Step 8: Restore code block placeholders
        codeBlockPlaceholders.forEach((replacement, index) => {
            html = html.replace(`<<CODEBLOCK${index}>>`, replacement);
        });

        return html;
    }

    /**
     * Process markdown headers (# through ######)
     */
    processHeaders(html) {
        const lines = html.split('\n');
        const result = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Match headers: 1-6 # symbols followed by space and text
            const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
            
            if (headerMatch) {
                const level = headerMatch[1].length; // Number of # symbols
                const text = headerMatch[2].trim();
                const tag = `h${Math.min(level, 6)}`; // Cap at h6
                result.push(`<${tag} class="markdown-header markdown-header-${level}">${text}</${tag}>`);
            } else {
                result.push(line);
            }
        }

        return result.join('\n');
    }

    /**
     * Process markdown lists (ordered and unordered)
     */
    processLists(html) {
        const lines = html.split('\n');
        const result = [];
        let inList = false;
        let listType = null; // 'ul' or 'ol'
        let listItems = [];

        const flushList = () => {
            if (listItems.length > 0) {
                const tag = listType === 'ol' ? 'ol' : 'ul';
                const listHtml = `<${tag} class="markdown-list">${listItems.join('')}</${tag}>`;
                result.push(listHtml);
                listItems = [];
            }
            inList = false;
            listType = null;
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for unordered list item: - , * , or + followed by space (but not in code blocks)
            const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
            // Check for ordered list item: number followed by . and space
            const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);

            // Skip if line is empty (but still flush list if we're in one)
            if (line.trim() === '') {
                if (inList) {
                    flushList();
                }
                result.push(line);
                continue;
            }

            if (unorderedMatch) {
                const content = unorderedMatch[3];
                const isNewList = !inList || listType !== 'ul';
                
                if (isNewList) {
                    flushList();
                    inList = true;
                    listType = 'ul';
                }
                
                listItems.push(`<li>${content}</li>`);
            } else if (orderedMatch) {
                const content = orderedMatch[3];
                const isNewList = !inList || listType !== 'ol';
                
                if (isNewList) {
                    flushList();
                    inList = true;
                    listType = 'ol';
                }
                
                listItems.push(`<li>${content}</li>`);
            } else {
                // Not a list item
                if (inList) {
                    flushList();
                }
                result.push(line);
            }
        }

        // Flush any remaining list
        flushList();

        return result.join('\n');
    }

    appendMessage(type, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${type}`;
        
        const prefix = document.createElement('span');
        prefix.className = 'prefix';
        
        if (type === 'user') prefix.textContent = '>';
        else if (type === 'bot') prefix.textContent = '#';
        else prefix.textContent = '!';

        const content = document.createElement('span');
        content.className = 'message-content';
        
        // Parse markdown for bot messages, plain text for others
        if (type === 'bot') {
            content.innerHTML = this.parseMarkdown(text);
        } else {
            content.textContent = text;
        }

        msgDiv.appendChild(prefix);
        msgDiv.appendChild(content);
        
        this.chatContainer.appendChild(msgDiv);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    // Chat History Management Functions
    async saveChatHistory() {
        if (this.persistentMode) {
            await chrome.storage.local.set({ 
                chatHistory: this.chatHistory,
                currentVideoId: this.currentVideoId,
                transcriptSent: this.transcriptSent,
                scrapedContentSent: this.scrapedContentSent
            });
        }
    }

    async loadChatHistory() {
        if (this.persistentMode) {
            const stored = await chrome.storage.local.get(['chatHistory', 'currentVideoId', 'transcriptSent', 'scrapedContentSent']);
            if (stored.chatHistory && Array.isArray(stored.chatHistory) && stored.chatHistory.length > 0) {
                this.chatHistory = stored.chatHistory;
                // Restore chat UI - clear initial system message
                this.chatContainer.innerHTML = '';
                this.chatHistory.forEach(msg => {
                    if (msg.role === 'user') {
                        this.appendMessage('user', msg.content);
                    } else if (msg.role === 'assistant') {
                        const cleaned = this.sanitizeBotResponse(msg.content) || msg.content;
                        if (cleaned !== msg.content) {
                            msg.content = cleaned;
                        }
                        this.appendMessage('bot', cleaned);
                    }
                });
                
                // Restore video ID if available
                if (stored.currentVideoId) {
                    this.currentVideoId = stored.currentVideoId;
                }
                
                // If we have chat history, check if it's for the current video
                // If video changed, transcript needs to be sent again
                if (stored.currentVideoId === this.currentVideoId) {
                    this.transcriptSent = stored.transcriptSent !== undefined ? stored.transcriptSent : true;
                } else {
                    this.transcriptSent = false;
                }
                
                // Restore scraped content sent state
                this.scrapedContentSent = stored.scrapedContentSent !== undefined ? stored.scrapedContentSent : false;
            }
        }
    }

    clearChatHistory() {
        this.chatHistory = [];
        this.chatContainer.innerHTML = '';
        this.transcriptSent = false;
        this.scrapedContentSent = false;
        this.scrapedContent = null;
    }

    resetChatForNewVideo() {
        this.clearChatHistory();
        this.appendMessage('system', 'PAM READY. WAITING FOR CONTEXT...');
    }
}

// Initialize
new SidePanelApp();
