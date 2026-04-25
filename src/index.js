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
import {
    initRuntimeLog,
    setCurrentActivity,
    clearCurrentActivity,
    recordFatal,
    setShutdownMeta,
} from './shared/runtimeLog.js';

initRuntimeLog();

dotenv.config({ override: true });

const discordToken = process.env.TOKEN?.trim();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User],
});

const connectionManager = createConnectionManager(client, {
    token: discordToken,
    maxReconnectAttempts: 8,
    baseReconnectDelayMs: 2000,
    maxReconnectDelayMs: 30000,
    healthcheckIntervalMs: 30000,
});

connectionManager.registerClientHandlers();

client.on(Events.Raw, (packet) => {
    if (packet?.t !== 'MESSAGE_CREATE') return;
    const guildId = packet?.d?.guild_id ?? 'DM';
    const channelId = packet?.d?.channel_id ?? 'unknown';
    const authorId = packet?.d?.author?.id ?? 'unknown';
    console.log(`[RAW] MESSAGE_CREATE guild=${guildId} channel=${channelId} author=${authorId}`);

    if (packet?.d?.guild_id) return;

    (async () => {
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) return;

            const attachments = new Map(
                (packet.d.attachments || []).map((attachment) => [attachment.id, attachment])
            );

            const syntheticMessage = {
                id: packet.d.id,
                system: false,
                guild: null,
                content: packet.d.content || '',
                attachments,
                author: {
                    id: packet.d.author?.id,
                    username: packet.d.author?.username || 'unknown',
                    bot: Boolean(packet.d.author?.bot),
                },
                channel,
                reply: async (payload) => {
                    if (typeof payload === 'string') {
                        return channel.send(payload);
                    }

                    const nextPayload = { ...payload };
                    if (!nextPayload.reply) {
                        nextPayload.reply = {
                            messageReference: packet.d.id,
                            failIfNotExists: false,
                        };
                    }

                    return channel.send(nextPayload);
                },
            };

            console.log(`[RAW->DM] Repassando DM sintética para messageCreate: ${syntheticMessage.id}`);
            client.emit('messageCreate', syntheticMessage);
        } catch (error) {
            console.error('[RAW->DM] Falha ao reconstruir DM sintética:', error);
        }
    })();
});

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
        console.log('Slash command /ativar-dm registrado com sucesso.');
    } catch (error) {
        console.error('Erro ao registrar slash command:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== ativar.data.name) return;
    try {
        await ativar.execute(interaction);
    } catch (error) {
        console.error('Erro ao processar /ativar-dm:', error);
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
const usersWarnedDbDegradedMode = new Set();
const processedMessageIds = new Map();

const PROCESSED_MESSAGE_TTL_MS = 2 * 60 * 1000;

const isDuplicateMessage = (messageId) => {
    if (!messageId) return false;

    const now = Date.now();

    for (const [id, timestamp] of processedMessageIds.entries()) {
        if (now - timestamp > PROCESSED_MESSAGE_TTL_MS) {
            processedMessageIds.delete(id);
        }
    }

    if (processedMessageIds.has(messageId)) {
        return true;
    }

    processedMessageIds.set(messageId, now);
    return false;
};

const shouldMentionUser = (userId) => {
    if (usersMentionedOnce.has(userId)) return false;
    usersMentionedOnce.add(userId);
    return true;
};

const openaiRequestWithTimeout = async (requestPromise, timeoutMs = 45000) => {
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`OpenAI request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
};

client.on('messageCreate', async (message) => {
    try {
        const authorName = message.author?.username ?? 'unknown';
        const guildName = message.guild?.name ?? 'DM';
        const channelId = message.channel?.id ?? 'unknown';
        const content = String(message.content ?? '');

        const baseActivity = `messageCreate msgId=${message.id} user=${authorName} (${message.author?.id ?? 'unknown'}) guild=${guildName} channel=${channelId}`;
        setCurrentActivity(baseActivity);

        console.log(`\n[MSG RECEBIDA] De: ${authorName} | Guild: ${guildName} | Channel ID: ${channelId} | Conteúdo: "${content.substring(0, 80)}"`);
        
        if (message.system) {
            console.log('[FILTRO] Ignorando mensagem de sistema');
            return;
        }
        if (message.author?.bot) {
            console.log('[FILTRO] Ignorando mensagem de bot');
            return;
        }
        
        const isDM = !message.guild;
        setCurrentActivity(`${baseActivity} isDM=${isDM}`);
        console.log(`[CONFIG] isDM: ${isDM} | Channel esperado: ${process.env.CHANNEL_ID} | Channel recebido: ${channelId}`);
        
        if (!isDM && channelId !== process.env.CHANNEL_ID) {
            console.log(`[FILTRO] Canal incorreto (esperado: ${process.env.CHANNEL_ID}, recebido: ${channelId})`);
            return;
        }
        if (content.startsWith('!')) {
            console.log('[FILTRO] Ignorando comando com "!"');
            return;
        }

        if (isDuplicateMessage(message.id)) {
            console.log(`[FILTRO] Mensagem duplicada detectada e ignorada: ${message.id}`);
            return;
        }

        console.log('[VALIDACAO] Passou em todas as validações, iniciando processamento...');

        // Portão de registro: bloqueia DMs de usuários não confirmados
        if (isDM) {
            console.log(`[DM] Mensagem recebida de ${message.author.username} (${message.author.id})`);
            let registered = false;
            let shouldBypassRegistrationCheck = false;
            try {
                registered = await isRegistered(message.author.id);
            } catch (error) {
                console.error('[DM] Erro ao consultar MongoDB:', error.message);
                shouldBypassRegistrationCheck = true;

                if (!usersWarnedDbDegradedMode.has(message.author.id)) {
                    usersWarnedDbDegradedMode.add(message.author.id);
                    await message.reply(
                        'Meu banco está instável agora. Vou seguir em modo degradado e responder por aqui mesmo.'
                    );
                }
            }

            if (!shouldBypassRegistrationCheck && !registered) {
                console.log('[DM] Usuário não registrado. Bloqueando acesso.');
                await message.reply(
                    'Ei, espera — você ainda não me ativou.\nUsa o comando **/ativar-dm** em algum servidor que eu esteja para liberar acesso à minha DM.\n*...Não é tão difícil assim, né?*'
                );
                return;
            }

            if (shouldBypassRegistrationCheck) {
                console.log('[DM] Modo degradado ativo: validação de cadastro ignorada por indisponibilidade do MongoDB.');
            } else {
                console.log('[DM] Usuário registrado. Permitindo acesso.');
            }
        }

        if (!isDM) {
            console.log(`[CANAL PRIVADO] ${authorName} (${message.author.id}) em ${channelId}`);
        }

        // se houver uma mensagem de audio, roda a transcrição
        const audioAttachment = pickFirstAudioAttachment(message.attachments);
        let userContent = content;
        if (audioAttachment) {
            setCurrentActivity(`${baseActivity} step=transcribeAttachment attachment=${audioAttachment.name ?? audioAttachment.url ?? 'unknown'}`);
            await message.channel.sendTyping();
            const transcript = await transcribeAttachment(openai, audioAttachment);
            if (transcript) {
                userContent = `[Transcrição de áudio]\n${transcript}`;
            }
            setCurrentActivity(`${baseActivity} step=transcribeAttachment done`);
        }

        let hasSentFirstResponse = false;

        const sendResponseChunk = async (chunkContent, files = []) => {
            if (!hasSentFirstResponse) {
                const mentionUser = shouldMentionUser(message.author.id);

                if (files.length > 0) {
                    await message.reply({
                        content: chunkContent,
                        files,
                        allowedMentions: { repliedUser: mentionUser },
                    });
                } else {
                    await message.reply({
                        content: chunkContent,
                        allowedMentions: { repliedUser: mentionUser },
                    });
                }
                hasSentFirstResponse = true;
                return;
            }

            if (files.length > 0) {
                await message.channel.send({ content: chunkContent, files });
            } else {
                await message.channel.send(chunkContent);
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
            setCurrentActivity(`${baseActivity} step=buildContext`);
            // Envia typing apenas uma vez no início
            await message.channel.sendTyping();

            let prevMessagesRaw = new Map();
            let memoryPrompt = '';

            const prevMessagesPromise = message.channel.messages
                .fetch({ limit: 10 })
                .catch((historyError) => {
                    console.error('Falha ao carregar histórico do canal:', historyError);
                    return new Map();
                });
            const memoryPromptPromise = getUserMemorySystemMessage(message.author.id).catch((memoryError) => {
                console.error('Falha ao carregar memoria do usuario:', memoryError);
                return '';
            });

            [prevMessagesRaw, memoryPrompt] = await Promise.all([
                prevMessagesPromise,
                memoryPromptPromise,
            ]);
            console.log(`[CTX] Histórico carregado: ${prevMessagesRaw.size} mensagens (${isDM ? 'DM' : 'Guild'}) | memória carregada: ${Boolean(memoryPrompt)}`);

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
        const prevMessages = [...prevMessagesRaw.values()]
            .filter((msg) => msg.author.id === client.user.id || msg.author.id === message.author.id)
            .reverse();

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

            setCurrentActivity(`${baseActivity} step=openaiRequest contextMsgs=${conversationLog.length}`);
            console.log(`[OPENAI] Entrada liberada user=${message.author.id} origem=${isDM ? 'DM' : 'Guild'} channel=${message.channel.id}`);
            console.log(`[OPENAI] Iniciando chamada com ${conversationLog.length} mensagens no contexto`);

            const stream = await openaiRequestWithTimeout(
                openai.chat.completions.create({
                    model: 'gpt-4o-2024-11-20',
                    messages: conversationLog,
                    max_completion_tokens: 2048,
                    stream: true,
                    temperature: 0.8,
                    top_p: 0.95,
                }),
                45000
            );

            console.log('[OPENAI] Stream recebido com sucesso, iniciando leitura');

            let response = '';
            let currentChunk = '';

            setCurrentActivity(`${baseActivity} step=openaiStream`);
            console.log('[STREAM] Iniciando processamento de stream');

            for await (const part of stream) {
                const contentPart = part.choices[0]?.delta?.content || '';
                if (contentPart) {
                    response += contentPart;
                    currentChunk += contentPart;

                    const shouldSend = currentChunk.length >= 1500 && /[.!?\n]$/.test(currentChunk.trim());

                    if (shouldSend) {
                        console.log(`[STREAM] Enviando chunk com ${currentChunk.length} caracteres`);
                        await sendResponseChunk(currentChunk);
                        currentChunk = '';
                    }
                }
            }

            console.log(`[STREAM] Stream finalizado. Resposta total: ${response.length} caracteres`);

            if (currentChunk.length > 0) {
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
            setCurrentActivity(`${baseActivity} step=shouldPersistUserMemory`);
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

                setCurrentActivity(`${baseActivity} step=persistUserMemoryFromConversation`);
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
    } catch (error) {
        console.error('[messageCreate] Falha não tratada no início do fluxo:', error);
    } finally {
        clearCurrentActivity();
    }
});

process.on('unhandledRejection', (reason) => {
    recordFatal('unhandledRejection', reason);
    console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    recordFatal('uncaughtException', error);
    setShutdownMeta({ reason: 'uncaughtException' });
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
        setShutdownMeta({ reason: 'manual', signal });
        setCurrentActivity(`shutdown signal=${signal}`);
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
