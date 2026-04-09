import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Partials, AttachmentBuilder, MessageFlags, Events } from 'discord.js';
import { OpenAI } from 'openai';
import { pickFirstAudioAttachment, transcribeAttachment } from './services/audio/voiceToText.js';
import fs from 'fs';
import path from 'path';
import { isRegistered, shouldPersistUserMemory } from './services/users.js';
import {
    getUserMemorySystemMessage,
    persistUserMemoryFromConversation,
} from './services/userMemoryService.js';
import {
    BOT_SYSTEM_PROMPT,
    restartStatusRotation,
    stopStatusRotation,
} from './core/botPersona.js';
import { registerGlobalCommands } from './services/discord/discordCommands.js';
import { pickRandom } from './shared/utils/pickRandomMsg.js';
import * as ativar from './features/activation/ativar.js';
import { createConnectionManager } from './core/connectionManager.js';

dotenv.config({ override: true });

const discordToken = process.env.TOKEN?.trim();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

const connectionManager = createConnectionManager(client, {
    token: discordToken,
    maxReconnectAttempts: 8,
    baseReconnectDelayMs: 2000,
    maxReconnectDelayMs: 30000,
    healthcheckIntervalMs: 30000,
});

connectionManager.registerClientHandlers();

client.on(Events.ClientReady, () => {
    restartStatusRotation(client);
});

client.once(Events.ClientReady, async () => {
    console.log('O bot está online');
    try {
        await registerGlobalCommands(
            discordToken,
            client.application.id,
            [ativar.data.toJSON()]
        );
        console.log('Slash command /ativar registrado com sucesso.');
    } catch (error) {
        console.error('Erro ao registrar slash command:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== ativar.data.name) return;
    try {
        await ativar.execute(interaction);
    } catch (error) {
        console.error('Erro ao processar /ativar:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'Não consegui acessar o banco agora. Tenta novamente em instantes.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,});

// Função para obter imagens locais (ignora subpastas)
const getLocalImages = () => {
    const imgFolder = './img';
    const ignoredFolders = ['exemplos']; // Pastas a ignorar
    
    try {
        if (!fs.existsSync(imgFolder)) {
            console.log('Pasta ./img/ não encontrada.');
            return [];
        }
        
        const imageFiles = [];
        
        // Função recursiva para buscar imagens
        const scanDirectory = (dir, baseDir = imgFolder) => {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                
                if (item.isDirectory()) {
                    // Ignora pastas específicas
                    const relativePath = path.relative(baseDir, fullPath);
                    const folderName = relativePath.split(path.sep)[0];
                    
                    if (!ignoredFolders.includes(folderName.toLowerCase())) {
                        scanDirectory(fullPath, baseDir);
                    }
                } else if (item.isFile()) {
                    // Verifica se é uma imagem
                    const ext = path.extname(item.name).toLowerCase();
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                        imageFiles.push(fullPath);
                    }
                }
            }
        };
        
        scanDirectory(imgFolder);
        return imageFiles;
    } catch (error) {
        console.error('Erro ao ler imagens:', error);
        return [];
    }
};

// Função para selecionar imagem aleatória
const getRandomImage = () => {
    const images = getLocalImages();
    if (images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
};

// Função para decidir se deve enviar imagem (40% de chance)
const shouldSendRandomImage = () => {
    return Math.random() < 0.4; // 40% de chance
};

// Evita ping repetido: cada usuario recebe mencao apenas na primeira resposta.
const usersMentionedOnce = new Set();

const shouldMentionUser = (userId) => {
    if (usersMentionedOnce.has(userId)) return false;
    usersMentionedOnce.add(userId);
    return true;
};

client.on('messageCreate', async (message) => {
    if (message.system) return;
    if (message.author.bot) return;
    const isDM = !message.guild;
    if (!isDM && message.channel.id !== process.env.CHANNEL_ID) return;
    if (message.content.startsWith('!')) return;

    // Portão de registro: bloqueia DMs de usuários não confirmados
    if (isDM) {
        let registered = false;
        try {
            registered = await isRegistered(message.author.id);
        } catch (error) {
            console.error('Erro ao consultar registros no MongoDB:', error);
            await message.reply('Meu banco de dados está indisponível agora. Tente novamente em alguns minutos.');
            return;
        }

        if (!registered) {
            await message.reply(
                'Ei, espera — você ainda não me ativou.\nUsa o comando **/ativar** em algum servidor que eu esteja para liberar acesso à minha DM.\n*...Não é tão difícil assim, né?*'
            );
            return;
        }
    }

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

    let hasSentFirstResponse = false;

    const sendResponseChunk = async (content, files = []) => {
        if (!hasSentFirstResponse) {
            const mentionUser = shouldMentionUser(message.author.id);

            if (files.length > 0) {
                await message.reply({
                    content,
                    files,
                    allowedMentions: { repliedUser: mentionUser },
                });
            } else {
                await message.reply({
                    content,
                    allowedMentions: { repliedUser: mentionUser },
                });
            }
            hasSentFirstResponse = true;
            return;
        }

        if (files.length > 0) {
            await message.channel.send({ content, files });
        } else {
            await message.channel.send(content);
        }
    };

    const sendChunks = async (text) => {
        if (typeof text !== 'string') {
            console.error('Texto provido não é do tipo string.');
            return;
        }

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

        // Usa a mesma regra global: primeira resposta vira reply, restante vira send.
        for (let i = 0; i < chunks.length; i++) {
            await sendResponseChunk(chunks[i]);
        }
    };

    let conversationLog = [{ role: 'system', content: BOT_SYSTEM_PROMPT }];

    try {
        // Envia typing apenas uma vez no início
        await message.channel.sendTyping();

        // Carrega memoria e contexto de mensagens em paralelo para reduzir latencia.
        const prevMessagesPromise = message.channel.messages.fetch({ limit: 10 });
        const memoryPromptPromise = getUserMemorySystemMessage(message.author.id).catch((memoryError) => {
            console.error('Falha ao carregar memoria do usuario:', memoryError);
            return '';
        });

        const [prevMessagesRaw, memoryPrompt] = await Promise.all([
            prevMessagesPromise,
            memoryPromptPromise,
        ]);

        if (memoryPrompt) {
            conversationLog.push({ role: 'system', content: memoryPrompt });
        }

        // Usa uma janela de ate 10 mensagens recentes do usuario para montar ate 3 candidatos para sorteio da memoria.
        const memorySourceCandidates = [];
        const candidateSet = new Set();

        const addMemoryCandidate = (text) => {
            if (typeof text !== 'string') return;
            const cleaned = text.trim();
            if (!cleaned) return;
            const key = cleaned.toLowerCase();
            if (candidateSet.has(key)) return;
            candidateSet.add(key);
            memorySourceCandidates.push(cleaned);
        };

        addMemoryCandidate(userContent);

        const recentUserMessages = [...prevMessagesRaw.values()]
            .filter((msg) => msg.author.id === message.author.id)
            .filter((msg) => !msg.system)
            .filter((msg) => !msg.content.startsWith('!'))
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
            .slice(0, 10);

        for (const msg of recentUserMessages) {
            addMemoryCandidate(msg.content);
            if (memorySourceCandidates.length >= 3) break;
        }

        // contexto de 10 mensagens anteriores
        let prevMessages = prevMessagesRaw.filter(msg => msg.author.id === client.user.id || msg.author.id === message.author.id);
        prevMessages.reverse();

        prevMessages.forEach((msg) => {
            if (msg.system) return;
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

        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-2024-11-20',
            messages: conversationLog,
            max_completion_tokens: 2048,
            stream: true,
            // Otimizações para velocidade mantendo qualidade
            temperature: 0.8, // Ligeiramente mais baixo para respostas mais focadas
            top_p: 0.95,
        });

        let response = '';
        let currentChunk = '';
        
        // Processa o stream e envia em tempo real
        for await (const part of stream) {
            const content = part.choices[0]?.delta?.content || '';
            if (content) {
                response += content;
                currentChunk += content;
                
                // Envia chunk quando atingir ~1500 chars ou encontrar fim de frase
                const shouldSend = currentChunk.length >= 1500 && /[.!?\n]$/.test(currentChunk.trim());
                
                if (shouldSend) {
                    await sendResponseChunk(currentChunk);
                    currentChunk = '';
                }
            }
        }
        
        // Envia qualquer conteúdo restante
        if (currentChunk.length > 0) {
            // Decide se vai enviar uma imagem junto com a resposta final
            const sendWithImage = shouldSendRandomImage();
            const randomImage = sendWithImage ? getRandomImage() : null;

            if (randomImage) {
                const attachment = new AttachmentBuilder(randomImage);
                await sendResponseChunk(currentChunk, [attachment]);
            } else {
                await sendResponseChunk(currentChunk);
            }
        }
        
        console.log(`Resposta completa: ${response}`);

        // Atualiza memoria apenas a cada 3 mensagens por usuario.
        try {
            const shouldPersistMemory = await shouldPersistUserMemory(
                message.author.id,
                message.author.username,
                3
            );

            console.log(`[Memory] Contador para ${message.author.username}: shouldPersist=${shouldPersistMemory}`);

            if (shouldPersistMemory) {
                const randomMessageForMemory = pickRandom(memorySourceCandidates) || userContent;

                console.log(`[Memory] Persistindo memória para ${message.author.username}...`);
                console.log(`[Memory] Mensagem sorteada para extração: ${randomMessageForMemory}`);

                await persistUserMemoryFromConversation(
                    openai,
                    message.author.id,
                    message.author.username,
                    randomMessageForMemory,
                    response
                );
            }
        } catch (memoryPersistError) {
            console.error('Falha ao atualizar memoria do usuario:', memoryPersistError);
        }

    } catch (error) {
        console.log(`ERR: ${error}`);
        const fallback = 'Deu erro ao processar sua mensagem agora. Tente novamente em alguns segundos.';
        try {
            if (!hasSentFirstResponse) {
                await message.reply(fallback);
            } else {
                await message.channel.send(fallback);
            }
        } catch (replyError) {
            console.error('Falha ao enviar mensagem de erro para o usuario:', replyError);
        }
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (connectionManager.isManualShutdown()) return;
    process.exit(1);
});

let shutdownPromise = null;

const gracefulShutdown = (signal) => {
    if (shutdownPromise) {
        return shutdownPromise;
    }

    shutdownPromise = (async () => {
        stopStatusRotation();
        await connectionManager.shutdown(`manual via ${signal}`);
        process.exit(0);
    })();

    return shutdownPromise;
};

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT').catch((err) => {
        console.error('Error during graceful shutdown (SIGINT):', err);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM').catch((err) => {
        console.error('Error during graceful shutdown (SIGTERM):', err);
        process.exit(1);
    });
});

connectionManager.start();
