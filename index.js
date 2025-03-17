import 'dotenv/config';
import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { OpenAI } from 'openai';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let status = [
    {
        name: 'o chat',
        type: ActivityType.Watching,
    },
    {
        name: 'os membros',
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

    const sendChunks = async (text) => {
        if (typeof text !== 'string') {
            console.error('Texto provido não é string');
            return;
        }
        const chunks = text.match(/(.|[\r\n]){1,2000}/g);
        for (const chunk of chunks) {
            await message.reply(chunk);
        }
    };

    let conversationLog = [
        { role: 'system', content: 'Sou um bot :)' },
    ];

    try {
        await message.channel.sendTyping();
        let prevMessages = await message.channel.messages.fetch({ limit: 10 });
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
            content: message.content,
            name: message.author.username
                .replace(/\s+/g, '_')
                .replace(/[^\w\s]/gi, ''),
        });

        const chatCompletion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: conversationLog,
            max_completion_tokens: 1000,
        });

        const response = chatCompletion.choices[0].message.content;
        console.log(`Resposta: ${response}`);

        await sendChunks(response);

    } catch (error) {
        console.log(`ERR: ${error}`);
    }
});

client.login(process.env.TOKEN);
