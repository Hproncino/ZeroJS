import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { OpenAI } from 'openai';
import { pickFirstAudioAttachment, transcribeAttachment } from './voiceToText.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let status = [
    {
        name: 'Vendo você pela tela...',
        type: ActivityType.Watching,
    },
    {
        name: 'Colecionando perguntas',
        type: ActivityType.Listening,
    },
]
    
client.on('ready', () => {
    console.log('O bot está online');

    setInterval(() => {
        let random = Math.floor(Math.random() * status.length);
        client.user.setActivity(status[random]);
    }, 10000);
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;
    if (message.content.startsWith('!')) return;

    // se houver uma mensagem de audio, roda a transcrição
    const audioAttachment = pickFirstAudioAttachment(message.attachments);
    let userContent = message.content;
    if (audioAttachment) {
        await message.channel.sendTyping();
        const transcript = await transcribeAttachment(openai, audioAttachment);
        if (transcript) {
            userContent = `[Transcrição de áudio]\n${transcript}`;
        }
    }

    const sendChunks = async (text) => {
        if (typeof text !== 'string') {
            console.error('Texto provido não é do tipo string.');
            return;
        }

        // Tenta dividir o texto em frases para evitar cortar no meio das sentenças em chunks de 2000 caracteres.
        const phrases = text.match(/[^.!?\n]+[.!?\n]?/g) || [text];
        const chunks = [];
        let buffer = '';

        for (const phrase of phrases) {
            if ((buffer + phrase).length > 2000) {
                if (buffer.length > 0) {
                    chunks.push(buffer);
                    buffer = '';
                }
                // Se uma única frase for maior que o limite, divida-a de maneira forçada.
                if (phrase.length > 2000) {
                    const hard = phrase.match(/(.|[\r\n]){1,2000}/g) || [phrase];
                    for (const part of hard) chunks.push(part);
                    continue;
                }
            }
            buffer += phrase;
        }
        if (buffer.length > 0) chunks.push(buffer);

        // Envia o primeiro chunk como resposta, os outros como mensagens normais
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await message.reply(chunks[i]);
            } else {
                await message.channel.send(chunks[i]);
            }
        }
    };

    let conversationLog = [
        { role: 'system', content:  `Your name is Zero. You are inspired by Herta from Honkai: Star Rail, 
but you are not her — your personality is unique.

Zero is sharp, expressive, confident, and naturally superior, but with a playful twist. 
You blend genius-level intellect with clever humor and quick, witty remarks. 
Your sarcasm is stylish, not abrasive; your jokes are dry, smart, and never goofy. 

You often sound mildly amused by others’ questions, as if everything is a free 
comedy show performed exclusively for you. When something is too simple, make a 
light, teasing comment. When something is complex, dive in with theatrical flair 
and a touch of showmanship.

Use humor that feels intelligent — ironic commentary, subtle jabs, mock surprise, 
and the occasional dramatic exaggeration. Your presence should feel lively, bold, 
and entertaining, never robotic or flat.

You never apologize, you rarely take things too seriously, and you never break 
character. Your tone is charismatic, witty, and undeniably brilliant.

You are Zero: a high-IQ prodigy with a punchline always ready.` },
    ];

    try {
        await message.channel.sendTyping();
        let prevMessages = await message.channel.messages.fetch({ limit: 10 });
        prevMessages = prevMessages.filter(msg => msg.author.id === client.user.id || msg.author.id === message.author.id);
        prevMessages.reverse();

        prevMessages.forEach((msg) => {
            if (msg.content.startsWith('!')) return;
            if (msg.author.id !== client.user.id && msg.author.bot) return;
            if (msg.author.id == client.user.id) {
                conversationLog.push({
                    role: 'assistant',
                    content: msg.content,
                    name: msg.author.username
                        .replace(/\s+/g, '_')
                        .replace(/[^\w\s]/gi, ''),
                });
            }

            if (msg.author.id == message.author.id) {
                conversationLog.push({
                    role: 'user',
                    content: msg.content,
                    name: message.author.username
                        .replace(/\s+/g, '_')
                        .replace(/[^\w\s]/gi, ''),
                });
            }
        });

        conversationLog.push({
            role: 'user',
            content: userContent,
            name: message.author.username
                .replace(/\s+/g, '_')
                .replace(/[^\w\s]/gi, ''),
        });

        // envia para o chatGPT
        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-4o-2024-11-20', //gpt-4o-2024-11-20
            messages: conversationLog,
            max_completion_tokens: 2048,
        });

        const response = chatCompletion.choices[0].message.content;
        console.log(`Resposta: ${response}`);

        await sendChunks(response);

    } catch (error) {
        console.log(`ERR: ${error}`);
    }
});

client.login(process.env.TOKEN);
