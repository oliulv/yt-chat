export class TranscriptService {
    constructor() {
        this.parser = new DOMParser();
    }

    async getTranscript(tabId) {
        try {
            console.log('[TranscriptService] Getting player response...');
            
            const playerResponse = await this.getPlayerResponse(tabId);
            
            if (!playerResponse) {
                console.error('[TranscriptService] No player response found.');
                throw new Error("Could not find player response");
            }

            const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

            if (!captionTracks || captionTracks.length === 0) {
                console.error('[TranscriptService] No caption tracks found in response.');
                throw new Error("No captions found for this video");
            }

            console.log(`[TranscriptService] Found ${captionTracks.length} tracks.`);

            // Prioritize English, then auto-generated English, then first available
            const track = captionTracks.find(t => t.languageCode === 'en' && !t.kind) || 
                          captionTracks.find(t => t.languageCode === 'en') || 
                          captionTracks[0];

            if (!track) {
                console.error('[TranscriptService] No suitable track found.');
                throw new Error("No suitable caption track found");
            }

            console.log(`[TranscriptService] Fetching track from: ${track.baseUrl}`);
            return await this.fetchAndParseTrack(track.baseUrl);

        } catch (error) {
            console.error("[TranscriptService] Transcript Error:", error);
            throw error;
        }
    }

    async getPlayerResponse(tabId) {
        // Try accessing window.ytInitialPlayerResponse via executeScript in MAIN world
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                func: () => {
                    try {
                        return window.ytInitialPlayerResponse;
                    } catch (e) {
                        return null;
                    }
                }
            });

            if (result && result[0] && result[0].result) {
                console.log('[TranscriptService] Found ytInitialPlayerResponse via executeScript.');
                return result[0].result;
            }
        } catch (e) {
            console.warn('[TranscriptService] executeScript failed', e);
        }
        return null;
    }

    async fetchAndParseTrack(url) {
        try {
            // IMPORTANT: Add credentials: 'omit' to avoid cookie issues if that's the cause
            // BUT usually simple fetch works. 
            // The issue "Track response was empty" usually means the fetch succeeded (200 OK) but body was empty.
            // This can happen if the API requires a signature/key that was in the original URL but got messed up,
            // OR if the browser blocked the request due to CORB/CORS, though usually that throws an error.
            
            // Let's try fetching without credentials first as a clean request.
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Fetch failed with status ${response.status}`);
            }
            
            const text = await response.text();
            
            if (!text || text.trim().length === 0) {
                console.error('[TranscriptService] Track response was empty.');
                throw new Error("Empty transcript response");
            }

            // YouTube captions are usually in XML format
            const xmlDoc = this.parser.parseFromString(text, "text/xml");
            const textNodes = xmlDoc.getElementsByTagName("text");
            
            console.log(`[TranscriptService] Parsed ${textNodes.length} text nodes.`);

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

            const result = fullText.join(' ');
            console.log(`[TranscriptService] Final transcript length: ${result.length}`);
            return result;

        } catch (e) {
            console.error('[TranscriptService] Failed to fetch/parse track:', e);
            throw e;
        }
    }
}
