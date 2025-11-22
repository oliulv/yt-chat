import { TranscriptService } from './lib/transcript.js';
import { OpenAIService } from './lib/openai.js';

class SidePanelApp {
    constructor() {
        this.transcriptService = new TranscriptService();
        this.openaiService = null;
        this.transcript = null;
        this.chatHistory = [];
        
        // Video and state tracking
        this.currentVideoId = null;
        this.transcriptSent = false;
        this.persistentMode = false;
        
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
        await this.loadSettings();
        await this.loadPersistentMode();
        await this.loadChatHistory();
        this.checkCurrentTab();

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
        });
        
        this.settingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });

        this.persistToggleBtn.addEventListener('click', () => {
            this.togglePersistentMode();
        });
    }

    async loadSettings() {
        const settings = await chrome.storage.sync.get(['apiKey', 'model']);
        if (settings.apiKey) {
            this.openaiService = new OpenAIService(settings.apiKey, settings.model);
            this.updateStatus('SYSTEM READY.');
            
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
            await chrome.storage.local.remove(['chatHistory', 'currentVideoId', 'transcriptSent']);
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
                
                // Video changed
                if (!this.persistentMode) {
                    // Default mode: Reset chat for new video
                    console.log('[SidePanel] Resetting chat for new video (default mode)');
                    this.resetChatForNewVideo();
                } else {
                    // Persistent mode: Keep chat history, just update video ID
                    // Load chat history from storage if sidepanel was closed
                    // (But don't overwrite if we already have it in memory)
                    if (this.chatHistory.length === 0) {
                        console.log('[SidePanel] Loading chat history from storage (persistent mode)');
                        await this.loadChatHistory();
                    } else {
                        console.log('[SidePanel] Keeping existing chat history (persistent mode)');
                    }
                }
                
                const previousVideoId = this.currentVideoId;
                this.currentVideoId = videoId;
                this.transcriptSent = false; // New video, need to send transcript
                
                console.log('[SidePanel] Video ID updated', {
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
                this.updateStatus('IDLE. NO VIDEO DETECTED.');
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
                
                this.updateStatus('TRANSCRIPT LOADED. READY.');
                
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
            this.updateStatus('IDLE. NO VIDEO DETECTED.');
        }
    }

    updateStatus(text) {
        this.statusText.textContent = text;
    }

    async handleSendMessage() {
        const text = this.userInput.value.trim();
        if (!text) return;

        if (!this.openaiService) {
            await this.loadSettings();
            if (!this.openaiService) {
                this.appendMessage('system', 'ERROR: API KEY NOT CONFIGURED.');
                return;
            }
        }

        // Clear input and reset height
        this.userInput.value = '';
        this.userInput.style.height = 'auto';
        
        // Add user message
        this.appendMessage('user', text);
        this.chatHistory.push({ role: 'user', content: text });

        this.updateStatus('PROCESSING...');

        // Determine if we should include transcript (only once per video)
        const includeTranscript = !this.transcriptSent && this.transcript;
        
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
            const response = await this.openaiService.generateResponse(
                this.chatHistory, 
                includeTranscript ? this.transcript : null
            );
            
            this.appendMessage('bot', response);
            
            // IMPORTANT: If we included transcript, we need to add the system message to chat history
            // so it persists across all future messages
            if (includeTranscript) {
                // Add the system message with transcript to chat history FIRST
                const systemMessage = {
                    role: 'system',
                    content: `You are a helpful, cryptic, and precise assistant. 
You are analyzing the following video transcript. 
Answer the user's questions DIRECTLY based on this context. 
Do NOT use phrases like "It seems like", "Based on the transcript", "The speaker says". Just state the facts.
Keep your answers concise and technical.
Style: Cyberpunk / Terminal / Cryptic.
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
            this.chatHistory.push({ role: 'assistant', content: response });
            
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
    parseMarkdown(text) {
        // Escape HTML to prevent XSS
        const escapeHtml = (str) => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        };

        // Use placeholders to protect code blocks from other markdown processing
        const codeBlockPlaceholders = [];
        let placeholderIndex = 0;

        let html = escapeHtml(text);

        // Step 1: Replace code blocks with placeholders (must be first)
        html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
            const placeholder = `__CODEBLOCK_${placeholderIndex}__`;
            codeBlockPlaceholders[placeholderIndex] = `<pre class="code-block"><code>${escapeHtml(code.trim())}</code></pre>`;
            placeholderIndex++;
            return placeholder;
        });

        // Step 2: Replace inline code with placeholders
        const inlineCodePlaceholders = [];
        let inlineIndex = 0;
        html = html.replace(/`([^`\n]+)`/g, (match, code) => {
            const placeholder = `__INLINECODE_${inlineIndex}__`;
            inlineCodePlaceholders[inlineIndex] = `<code class="inline-code">${escapeHtml(code)}</code>`;
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
            html = html.replace(`__INLINECODE_${index}__`, replacement);
        });

        // Step 8: Restore code block placeholders
        codeBlockPlaceholders.forEach((replacement, index) => {
            html = html.replace(`__CODEBLOCK_${index}__`, replacement);
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
                transcriptSent: this.transcriptSent
            });
        }
    }

    async loadChatHistory() {
        if (this.persistentMode) {
            const stored = await chrome.storage.local.get(['chatHistory', 'currentVideoId', 'transcriptSent']);
            if (stored.chatHistory && Array.isArray(stored.chatHistory) && stored.chatHistory.length > 0) {
                this.chatHistory = stored.chatHistory;
                // Restore chat UI - clear initial system message
                this.chatContainer.innerHTML = '';
                this.chatHistory.forEach(msg => {
                    if (msg.role === 'user') {
                        this.appendMessage('user', msg.content);
                    } else if (msg.role === 'assistant') {
                        this.appendMessage('bot', msg.content);
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
            }
        }
    }

    clearChatHistory() {
        this.chatHistory = [];
        this.chatContainer.innerHTML = '';
        this.transcriptSent = false;
    }

    resetChatForNewVideo() {
        this.clearChatHistory();
        this.appendMessage('system', 'SYSTEM READY. WAITING FOR VIDEO CONTEXT...');
    }
}

// Initialize
new SidePanelApp();
