export class OpenAIService {
    constructor(apiKey, model = 'gpt-4o-mini') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
    }

    async generateResponse(messages, context = null, contextType = null) {
        if (!this.apiKey) {
            throw new Error("API_KEY_MISSING");
        }

        let apiMessages = [];

        console.log('[OpenAI] generateResponse called', {
            messagesCount: messages?.length || 0,
            hasContext: !!context,
            contextLength: context?.length || 0,
            contextType: contextType,
            messagesRoles: messages?.map(m => m.role) || []
        });

        // If context is provided, add it as a system message
        // Only include context if explicitly provided (not null)
        if (context && context.length > 0) {
            // DEBUG: Log context being added
            console.log(`[OpenAI] Adding context to system prompt. Length: ${context.length}, Type: ${contextType}`);
            
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
Answer the user's questions DIRECTLY based on this context. 
${avoidPhrases}
Keep answers concise but give enough context to be helpful (think 2-4 sentences). 
When the user asks "what" or "why", include a tight definition plus a quick clarifying detail or example.
Style: Cyberpunk / Terminal / Cryptic.
${contextStartLabel}:
${context.substring(0, 25000)} 
${contextEndLabel}.
(Note: ${contextLabel} may be truncated)`
            };
            
            apiMessages.push(systemMessage);
            console.log('[OpenAI] System message with context added', {
                role: systemMessage.role,
                contextType: contextType,
                contentLength: systemMessage.content.length,
                contentPreview: systemMessage.content.substring(0, 100) + '...'
            });
        } else {
            // Only log warning if we expected context but didn't get it
            // (Don't log if context is intentionally null)
            if (context === '') {
                console.warn('[OpenAI] Empty context provided.');
            } else {
                console.log('[OpenAI] No context provided (context already sent or not available)');
            }
        }

        // Add chat history
        console.log('[OpenAI] Chat history before adding', {
            historyLength: messages?.length || 0,
            historyRoles: messages?.map(m => `${m.role}: ${m.content.substring(0, 50)}...`) || []
        });
        
        apiMessages = apiMessages.concat(messages);

        console.log('[OpenAI] Final messages array', {
            totalMessages: apiMessages.length,
            messageRoles: apiMessages.map(m => m.role),
            hasSystemMessage: apiMessages.some(m => m.role === 'system'),
            systemMessageIndex: apiMessages.findIndex(m => m.role === 'system')
        });

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: apiMessages,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'API_REQUEST_FAILED');
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            console.error("OpenAI API Error:", error);
            throw error;
        }
    }
}
