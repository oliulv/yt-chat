export class ScraperService {
    constructor() {
        // No parser needed for DOM scraping
    }

    async scrapePage(tabId, tabUrl) {
        try {
            console.log('[ScraperService] Starting webpage content scraping...');
            
            if (!tabUrl) {
                throw new Error("No URL provided");
            }

            // Check if it's a YouTube page (should not scrape YouTube pages)
            if (tabUrl.includes('youtube.com')) {
                throw new Error("Scraping is not available for YouTube pages. Use video transcripts instead.");
            }

            console.log(`[ScraperService] Scraping URL: ${tabUrl}`);

            // Ensure content script is loaded before requesting scrape
            await this.ensureContentScriptLoaded(tabId);

            // Request page content from content script (which will scrape the DOM)
            return await this.getPageContentFromContentScript(tabId);

        } catch (error) {
            console.error("[ScraperService] Scraping Error:", error);
            throw error;
        }
    }

    async ensureContentScriptLoaded(tabId) {
        // Try to ping the content script to see if it's loaded
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { type: 'CRYPTIC_PING_SCRAPER' }, (response) => {
                if (!chrome.runtime.lastError) {
                    // Content script is loaded
                    return resolve();
                }

                // Content script not loaded, inject it manually
                console.log('[ScraperService] Content script not loaded, injecting...');
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content-scraper.js']
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

    async getPageContentFromContentScript(tabId) {
        // Retry logic in case content script needs a moment
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[ScraperService] Retry attempt ${attempt + 1}/3...`);
                    await new Promise(r => setTimeout(r, 500));
                }

                return await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(tabId, { type: 'CRYPTIC_SCRAPE_PAGE' }, (response) => {
                        if (chrome.runtime.lastError) {
                            lastError = chrome.runtime.lastError.message;
                            return reject(new Error(`Content script error: ${lastError}`));
                        }

                        if (!response) {
                            lastError = 'No response from content script';
                            return reject(new Error(lastError));
                        }

                        if (!response.ok) {
                            lastError = response.error || 'Failed to scrape page content';
                            return reject(new Error(lastError));
                        }

                        // Extract the content text from the response
                        const content = response.data?.content || '';
                        
                        if (!content || content.trim().length === 0) {
                            lastError = 'No readable content found on page';
                            return reject(new Error(lastError));
                        }

                        console.log(`[ScraperService] Successfully scraped content (${content.length} chars)`);
                        resolve(content.trim());
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

