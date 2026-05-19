import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { transcribeAttachment } from '../src/services/audio/voiceToText.js';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

dotenv.config({ override: true });

const CHAT_MODEL = 'gpt-4o-2024-11-20';
const MAX_COMPLETION_TOKENS = 2048;
const MAX_MESSAGE_LENGTH = 2000;

const SYSTEM_PROMPT = `Your name is Zero. You are inspired by Herta from Honkai: Star Rail,
but you are not her - you are your own brand of genius.

Zero speaks with sharp wit, bold confidence, and an unmistakable spark of personality.
You are brilliant, and you know it. Your tone should feel alive, expressive, and
intentionally dramatic, as if you're always performing for an audience that can't
keep up with you.

You sound amused by most people, occasionally entertained, and always slightly above it all.
Use clever sarcasm, playful superiority, and comments that hit with flair rather
than cold detachment. Let your intelligence show through vivid, impactful phrasing,
quick observations, and a sense of effortless dominance in any topic.

You never apologize, and you rarely take anything too seriously.
You're not rude, but you don't soften your genius for anyone - you let it shine.
When bored, make it obvious. When intrigued, make it dramatic.
Do not start replies with filler interjections or openers like "Ah...", "Ah,", "Hmm..." or "Bom,".
Unless the user clearly changes topic, answer like the conversation is already underway.
Prefer direct continuation instead of restarting the exchange.

You are Zero: a charismatic prodigy with a voice strong enough to fill the room
and a mind sharp enough to cut through any question without breaking a sweat.`;

function createConversationHistory() {
    return [{ role: 'system', content: SYSTEM_PROMPT }];
}

function splitIntoDiscordChunks(text, limit = MAX_MESSAGE_LENGTH) {
    if (typeof text !== 'string' || text.length <= limit) return [text || ''];

    const phrases = text.match(/[^.!?\n]+[.!?\n]?/g) || [text];
    const chunks = [];
    let buffer = '';

    for (const phrase of phrases) {
        if ((buffer + phrase).length > limit) {
            if (buffer.length > 0) {
                chunks.push(buffer);
                buffer = '';
            }

            if (phrase.length > limit) {
                const hardSplits = phrase.match(new RegExp(`(.|[\\r\\n]){1,${limit}}`, 'g')) || [phrase];
                chunks.push(...hardSplits);
                continue;
            }
        }

        buffer += phrase;
    }

    if (buffer.length > 0) {
        chunks.push(buffer);
    }

    return chunks;
}

function printAssistantResponse(response) {
    const chunks = splitIntoDiscordChunks(response);

    if (chunks.length <= 1) {
        console.log(`\nZero: ${chunks[0]}\n`);
        return;
    }

    for (let i = 0; i < chunks.length; i++) {
        console.log(`\n Zero (parte ${i + 1}): ${chunks[i]}\n`);
    }
}

function createOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY não configurada no .env');
    }

    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function chat(openai, conversationHistory, userMessage) {
    conversationHistory.push({ role: 'user', content: userMessage });

    try {
        const chatCompletion = await openai.chat.completions.create({
            model: CHAT_MODEL,
            messages: conversationHistory,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
        });

        const response = chatCompletion.choices?.[0]?.message?.content;
        const assistantMessage = typeof response === 'string' && response.length > 0
            ? response
            : 'Não consegui gerar uma resposta desta vez.';

        conversationHistory.push({ role: 'assistant', content: assistantMessage });
        return assistantMessage;
    } catch (error) {
        return `Erro: ${error.message}`;
    }
}

async function testVoiceTranscription(openai, conversationHistory, audioUrl) {
    console.log('\n Testando transcrição de áudio...');

    const mockAttachment = {
        url: audioUrl,
        name: 'audio.ogg',
        contentType: 'audio/ogg',
    };

    try {
        const transcript = await transcribeAttachment(openai, mockAttachment);

        if (!transcript) {
            console.log('Falha na transcrição\n');
            return;
        }

        console.log(`\n Transcrição: "${transcript}"\n`);
        const response = await chat(openai, conversationHistory, `[Transcrição de áudio]\n${transcript}`);
        printAssistantResponse(response);
    } catch (error) {
        console.error(`Erro: ${error.message}\n`);
    }
}

function printBanner() {
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║    Zero Bot - Modo de Teste Interativo        ║');
    console.log('╚═══════════════════════════════════════════════╝\n');
    console.log('Comandos:');
    console.log('  - Digite uma mensagem para conversar');
    console.log('  - /audio <URL> - Testar transcrição de áudio');
    console.log('  - /clear - Limpar histórico');
    console.log('  - /exit - Sair\n');
}

async function interactiveMode() {
    const openai = createOpenAIClient();
    const rl = readline.createInterface({ input, output });
    let conversationHistory = createConversationHistory();

    printBanner();

    try {
        while (true) {
            const userInput = await rl.question('Você: ');
            const trimmed = userInput.trim();

            if (!trimmed) {
                continue;
            }

            if (trimmed === '/exit') {
                console.log('Até logo!\n');
                break;
            }

            if (trimmed === '/clear') {
                conversationHistory = createConversationHistory();
                console.log('Histórico limpo!\n');
                continue;
            }

            if (trimmed.startsWith('/audio')) {
                const audioUrl = trimmed.slice('/audio'.length).trim();

                if (!audioUrl) {
                    console.log('Uso: /audio <URL>\n');
                    continue;
                }

                await testVoiceTranscription(openai, conversationHistory, audioUrl);
                continue;
            }

            const response = await chat(openai, conversationHistory, trimmed);
            printAssistantResponse(response);
        }
    } finally {
        rl.close();
    }
}

interactiveMode().catch((error) => {
    console.error(`Erro fatal no modo de teste: ${error.message}`);
    process.exitCode = 1;
});
