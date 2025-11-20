import { TranscriptService } from './lib/transcript.js';
import { OpenAIService } from './lib/openai.js';

class SidePanelApp {
    constructor() {
        this.transcriptService = new TranscriptService();
        this.openaiService = null;
        this.transcript = null;
        this.chatHistory = [];
        
        // UI Elements
        this.statusText = document.getElementById('status-text');
        this.chatContainer = document.getElementById('chat-history');
        this.userInput = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-btn');
        this.settingsBtn = document.getElementById('settings-btn');

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadSettings();
        this.checkCurrentTab();

        // Listen for tab updates to reload context
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.active) {
                this.checkCurrentTab();
            }
        });

        // Listen for storage changes to update API key instantly
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync' && (changes.apiKey || changes.model)) {
                this.loadSettings();
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

    async checkCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab && tab.url && tab.url.includes('youtube.com/watch')) {
            this.updateStatus('DETECTED VIDEO. FETCHING DATA...');
            try {
                this.transcript = await this.transcriptService.getTranscript(tab.id);
                this.updateStatus('TRANSCRIPT LOADED. READY.');
                this.appendMessage('system', `CONTEXT ACQUIRED: ${tab.title.toUpperCase()}`);
            } catch (error) {
                console.error(error);
                this.updateStatus('TRANSCRIPT ERROR.');
                this.appendMessage('system', `ERROR: COULD NOT LOAD TRANSCRIPT. ${error.message}`);
            }
        } else {
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

        try {
            // Pass this.transcript explicitly
            const response = await this.openaiService.generateResponse(this.chatHistory, this.transcript);
            
            this.appendMessage('bot', response);
            this.chatHistory.push({ role: 'assistant', content: response });
            this.updateStatus('READY.');
        } catch (error) {
            this.appendMessage('system', `EXECUTION FAILED: ${error.message}`);
            this.updateStatus('ERROR.');
        }
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
        content.textContent = text; // Basic text for now, could add markdown parsing later

        msgDiv.appendChild(prefix);
        msgDiv.appendChild(content);
        
        this.chatContainer.appendChild(msgDiv);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
}

// Initialize
new SidePanelApp();
