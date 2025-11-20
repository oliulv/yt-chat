export class TranscriptService {
    constructor() {
        this.parser = new DOMParser();
    }

    async getTranscript(tabId) {
        try {
            const playerResponse = await this.getPlayerResponse(tabId);
            
            if (!playerResponse) {
                throw new Error("Could not find player response");
            }

            const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

            if (!captionTracks || captionTracks.length === 0) {
                throw new Error("No captions found for this video");
            }

            // Prioritize English, then auto-generated English, then first available
            const track = captionTracks.find(t => t.languageCode === 'en' && !t.kind) || 
                          captionTracks.find(t => t.languageCode === 'en') || 
                          captionTracks[0];

            if (!track) {
                throw new Error("No suitable caption track found");
            }

            return await this.fetchAndParseTrack(track.baseUrl);

        } catch (error) {
            console.error("Transcript Error:", error);
            throw error;
        }
    }

    async getPlayerResponse(tabId) {
        const result = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: 'MAIN', // CRITICAL: Access window object of the page, not isolated extension world
            func: () => {
                try {
                    // Access the global variable present on YouTube video pages
                    return window.ytInitialPlayerResponse;
                } catch (e) {
                    return null;
                }
            }
        });

        if (result && result[0] && result[0].result) {
            return result[0].result;
        }
        return null;
    }

    async fetchAndParseTrack(url) {
        const response = await fetch(url);
        const text = await response.text();
        
        // YouTube captions are usually in XML format
        const xmlDoc = this.parser.parseFromString(text, "text/xml");
        const textNodes = xmlDoc.getElementsByTagName("text");
        
        let fullText = [];
        
        for (let i = 0; i < textNodes.length; i++) {
            const node = textNodes[i];
            // Decode HTML entities and clean up text
            const content = node.textContent
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/\n/g, ' ');
                
            fullText.push(content);
        }

        return fullText.join(' ');
    }
}
