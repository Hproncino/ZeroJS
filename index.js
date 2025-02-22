import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { OpenAI } from 'openai';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.on('ready', () => {
    console.log('O bot está online');
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, //Passar a chave de API do OpenAI, discloud não carrega .env
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;
    if (message.content.startsWith('!')) return;

    let conversationLog = [
        { role: 'system', content: 'Sou um bot :)' },
    ];

    try {
        await message.channel.sendTyping();
        let prevMessages = await message.channel.messages.fetch({ limit: 15 });
        prevMessages.reverse();

        prevMessages.forEach((msg) => {
            if (msg.content.startsWith('!')) return;
            if (msg.author.id !== client.user.id && message.author.bot) return;
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
            content: message.content,
            name: message.author.username
                .replace(/\s+/g, '_')
                .replace(/[^\w\s]/gi, ''),
        });

        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: conversationLog,
            max_tokens: 2000,
        });

        message.reply(chatCompletion.choices[0].message.content);

    } catch (error) {
        console.log(`ERR: ${error}`);
    }
});

client.login(process.env.TOKEN);
