export class OpenAIService {
    constructor(apiKey, model = 'gpt-4o-mini') {
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
    }

    async generateResponse(messages, context = null) {
        if (!this.apiKey) {
            throw new Error("API_KEY_MISSING");
        }

        let apiMessages = [];

        // If context (transcript) is provided, add it as a system message
        if (context && context.length > 0) {
            // DEBUG: Log context being added
            console.log(`[OpenAI] Adding context to system prompt. Length: ${context.length}`);
            
            apiMessages.push({
                role: 'system',
                content: `You are a helpful, cryptic, and precise assistant. 
You are analyzing the following video transcript. 
Answer the user's questions DIRECTLY based on this context. 
Do NOT use phrases like "It seems like", "Based on the transcript", "The speaker says". Just state the facts.
Keep your answers concise and technical.
Style: Cyberpunk / Terminal / Cryptic.
TRANSCRIPT START:
${context.substring(0, 25000)} 
TRANSCRIPT END.
(Note: Transcript may be truncated)`
            });
        } else {
            console.warn('[OpenAI] No context provided or context is empty.');
        }

        // Add chat history
        apiMessages = apiMessages.concat(messages);

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
