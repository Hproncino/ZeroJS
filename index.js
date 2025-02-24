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
    apiKey: process.env.OPENAI_API_KEY,
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.CHANNEL_ID) return;
    if (message.content.startsWith('!')) return;

    const maxCharacters = 2000;
    if (message.content.length > maxCharacters) {
        message.reply(`Minha resposta é muito longa, para uma melhor experiência vou parar por aqui para não travar. Chame o @Hp_ronccino para ver o log e dar sua resposta!`);
        return;
    }

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
            model: 'gpt-4o',
            messages: conversationLog,
            max_tokens: 1000,
            temperature: 0.7,
            top_p: 0.6,
        });

        const response = chatCompletion.choices[0].message.content;
        if (response.length > maxCharacters) {
            message.reply(`Minha resposta é muito longa, para uma melhor experiência vou parar por aqui para não travar. Chame o @Hp_ronccino para ver o log e dar sua resposta!`);
        } else {
            message.reply(response);
        }

    } catch (error) {
        console.log(`ERR: ${error}`);
    }
});

client.login(process.env.TOKEN);
