import { getUserMemory, buildUserMemoryPrompt, saveUserMemoryInsights } from './users.js';

const MEMORY_EXTRACTION_SCHEMA = {
    type: 'json_schema',
    json_schema: {
        name: 'user_memory_insights',
        strict: true,
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                traits: {
                    type: 'array',
                    items: { type: 'string' },
                },
                likes: {
                    type: 'array',
                    items: { type: 'string' },
                },
                dislikes: {
                    type: 'array',
                    items: { type: 'string' },
                },
                conversationNotes: {
                    type: 'array',
                    items: { type: 'string' },
                },
            },
            required: ['traits', 'likes', 'dislikes', 'conversationNotes'],
        },
    },
};

const toStringArray = (value) => (Array.isArray(value) ? value : []);

export const getUserMemorySystemMessage = async (userId) => {
    const memory = await getUserMemory(userId);
    return buildUserMemoryPrompt(memory);
};

export const extractUserMemoryInsights = async (openaiClient, userInput, assistantOutput) => {
    const completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-2024-11-20',
        temperature: 0,
        messages: [
            {
                role: 'system',
                content: [
                    'Extract stable user memory from the dialogue.',
                    'Return only high-confidence facts. Ignore temporary details or guesses.',
                    'Keep output concise and in Portuguese when possible.',
                ].join(' '),
            },
            {
                role: 'user',
                content: `Mensagem do usuario:\n${userInput || ''}\n\nResposta da assistente:\n${assistantOutput || ''}`,
            },
        ],
        response_format: MEMORY_EXTRACTION_SCHEMA,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return null;

    try {
        const parsed = JSON.parse(content);
        return {
            traits: toStringArray(parsed.traits),
            likes: toStringArray(parsed.likes),
            dislikes: toStringArray(parsed.dislikes),
            conversationNotes: toStringArray(parsed.conversationNotes),
        };
    } catch {
        return null;
    }
};

export const persistUserMemoryFromConversation = async (
    openaiClient,
    userId,
    username,
    userInput,
    assistantOutput
) => {
    try {
        console.log(`[Memory] Iniciando extração de insights para usuário ${userId}...`);
        
        const insights = await extractUserMemoryInsights(openaiClient, userInput, assistantOutput);
        
        if (!insights) {
            console.warn(`[Memory] Nenhum insight extraído para usuário ${userId}`);
            return;
        }

        console.log(`[Memory] Insights extraídos:`, insights);
        
        await saveUserMemoryInsights(userId, username, insights);
        
        console.log(`[Memory] Memória salva com sucesso para usuário ${userId}`);
    } catch (error) {
        console.error(`[Memory] Erro ao persistir memória do usuário ${userId}:`, error);
        throw error;
    }
};
