export class TranscriptService {
    constructor() {
        // No parser needed for DOM scraping
    }

    async getTranscript(tabId, tabUrl) {
        try {
            console.log('[TranscriptService] Starting DOM-based transcript fetch...');
            
            const videoId = this.getVideoId(tabUrl);
            
            if (!videoId) {
                throw new Error("Could not extract video ID from URL");
            }

            console.log(`[TranscriptService] Video ID: ${videoId}`);

            // Ensure content script is loaded before requesting transcript
            await this.ensureContentScriptLoaded(tabId);

            // Request transcript from content script (which will scrape the DOM)
            return await this.getTranscriptFromContentScript(tabId);

        } catch (error) {
            console.error("[TranscriptService] Transcript Error:", error);
            throw error;
        }
    }

    getVideoId(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('v');
        } catch (e) {
            return null;
        }
    }

    async ensureContentScriptLoaded(tabId) {
        // Try to ping the content script to see if it's loaded
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { type: 'CRYPTIC_PING' }, (response) => {
                if (!chrome.runtime.lastError) {
                    // Content script is loaded
                    return resolve();
                }

                // Content script not loaded, inject it manually
                console.log('[TranscriptService] Content script not loaded, injecting...');
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                }, () => {
                    if (chrome.runtime.lastError) {
                        return reject(new Error(`Failed to inject content script: ${chrome.runtime.lastError.message}`));
                    }
                    // Give it a moment to initialize
                    setTimeout(() => resolve(), 200);
                });
            });
        });
    }

    async getTranscriptFromContentScript(tabId) {
        // Retry logic in case content script needs a moment
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[TranscriptService] Retry attempt ${attempt + 1}/3...`);
                    await new Promise(r => setTimeout(r, 500));
                }

                return await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(tabId, { type: 'CRYPTIC_GET_TRANSCRIPT' }, (response) => {
                        if (chrome.runtime.lastError) {
                            lastError = chrome.runtime.lastError.message;
                            return reject(new Error(`Content script error: ${lastError}`));
                        }

                        if (!response) {
                            lastError = 'No response from content script';
                            return reject(new Error(lastError));
                        }

                        if (!response.ok) {
                            lastError = response.error || 'Failed to get transcript from DOM';
                            return reject(new Error(lastError));
                        }

                        // Extract the transcript text from the response
                        const transcript = response.data?.transcript || '';
                        
                        if (!transcript || transcript.trim().length === 0) {
                            lastError = 'Transcript is empty';
                            return reject(new Error(lastError));
                        }

                        console.log(`[TranscriptService] Successfully scraped transcript (${transcript.length} chars)`);
                        resolve(transcript.trim());
                    });
                });
            } catch (error) {
                if (attempt === 2) {
                    // Last attempt failed
                    throw error;
                }
                // Will retry
            }
        }
    }
}
