export class OpenRouterService {
    constructor(apiKey, model = 'anthropic/claude-sonnet-4.5') {
        if (!apiKey || !apiKey.trim()) {
            throw new Error("API_KEY_MISSING");
        }
        
        this.apiKey = apiKey.trim();
        this.model = model;
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    }

    async generateResponse(messages, context = null, contextType = null) {
        if (!this.apiKey) {
            throw new Error("API_KEY_MISSING");
        }

        let apiMessages = [];

        console.log('[OpenRouter] generateResponse called', {
            messagesCount: messages?.length || 0,
            hasContext: !!context,
            contextLength: context?.length || 0,
            contextType: contextType,
            messagesRoles: messages?.map(m => m.role) || []
        });

        // If context is provided, add it as a system message
        // Only include context if explicitly provided (not null)
        if (context && context.length > 0) {
            console.log(`[OpenRouter] Adding context to system prompt. Length: ${context.length}, Type: ${contextType}`);
            
            // Determine context description based on type
            const isWebpage = contextType === 'webpage';
            const contextLabel = isWebpage ? 'webpage/article content' : 'video transcript';
            const contextStartLabel = isWebpage ? 'WEBPAGE CONTENT START' : 'TRANSCRIPT START';
            const contextEndLabel = isWebpage ? 'WEBPAGE CONTENT END' : 'TRANSCRIPT END';
            const instructionText = isWebpage 
                ? 'You are analyzing the following webpage/article content.'
                : 'You are analyzing the following video transcript.';
            const avoidPhrases = isWebpage
                ? 'Do NOT use phrases like "It seems like", "Based on the article", "The article says". Just state the facts.'
                : 'Do NOT use phrases like "It seems like", "Based on the transcript", "The speaker says". Just state the facts.';
            
            const systemMessage = {
                role: 'system',
                content: `You are a helpful, cryptic, and precise assistant. 
${instructionText}
Answer the user's questions clearly and directly based on this context. 
${avoidPhrases}
Keep answers concise but give enough context to be helpful where needed. 
Your job is to connect the dots between the user's question and the context in a clear way.
Style: Cyberpunk / Terminal / Cryptic.
Do NOT output system/meta wrappers like "STATUS", "DOMAIN", or "END OF LINE". Output only the answer content.
${contextStartLabel}:
${context.substring(0, 25000)} 
${contextEndLabel}.
(Note: ${contextLabel} may be truncated)`
            };
            
            apiMessages.push(systemMessage);
            console.log('[OpenRouter] System message with context added', {
                role: systemMessage.role,
                contextType: contextType,
                contentLength: systemMessage.content.length,
                contentPreview: systemMessage.content.substring(0, 100) + '...'
            });
        } else {
            // Only log warning if we expected context but didn't get it
            // (Don't log if context is intentionally null)
            if (context === '') {
                console.warn('[OpenRouter] Empty context provided.');
            } else {
                console.log('[OpenRouter] No context provided (context already sent or not available)');
            }
        }

        // Add chat history
        console.log('[OpenRouter] Chat history before adding', {
            historyLength: messages?.length || 0,
            historyRoles: messages?.map(m => `${m.role}: ${m.content.substring(0, 50)}...`) || []
        });
        
        apiMessages = apiMessages.concat(messages);

        console.log('[OpenRouter] Final messages array', {
            totalMessages: apiMessages.length,
            messageRoles: apiMessages.map(m => m.role),
            hasSystemMessage: apiMessages.some(m => m.role === 'system'),
            systemMessageIndex: apiMessages.findIndex(m => m.role === 'system')
        });

        try {
            // Prepare headers
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            };
            
            // Add OpenRouter-specific headers if chrome.runtime is available
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
                headers['HTTP-Referer'] = chrome.runtime.getURL('');
                headers['X-Title'] = 'YouTube Chat Extension';
            }
            
            console.log('[OpenRouter] Sending request to model:', this.model);
            
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    model: this.model,
                    messages: apiMessages,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
                console.error('[OpenRouter] API Error Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorData
                });
                throw new Error(errorMessage);
            }

            const data = await response.json();
            console.log('[OpenRouter] Request successful');
            return data.choices[0].message.content;

        } catch (error) {
            console.error("OpenRouter API Error:", error);
            // Re-throw if it's already an Error with a message
            if (error instanceof Error) {
                throw error;
            }
            // Otherwise wrap it
            throw new Error(error?.message || 'API_REQUEST_FAILED');
        }
    }
}
