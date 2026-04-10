import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config({ override: true });

let client;
let collection;

const getCollection = async () => {
    if (!client) {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI não configurada no .env');
        }
        client = new MongoClient(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
        });
    }

    if (!collection) {
        await client.connect();
        collection = client.db('zerodb').collection('users');
    }
    return collection;
};

export const saveUser = async (id, username) => {
    try {
        console.log(`[DB] Tentando salvar usuário: ${username} (${id})`);
        const col = await getCollection();
        const result = await col.updateOne(
            { id },
            { $set: { id, username }, $setOnInsert: { registeredAt: new Date().toISOString() } },
            { upsert: true }
        );
        console.log(`[DB] Usuário salvo: upserted=${result.upsertedCount > 0 ? 'novo' : 'atualizado'}`);
    } catch (error) {
        console.error('[DB] Erro ao salvar usuário:', error.message);
        throw error;
    }
};

export const isRegistered = async (id) => {
    try {
        console.log(`[DB] Verificando registro para ID: ${id}`);
        const col = await getCollection();
        const user = await col.findOne({ id });
        const exists = Boolean(user);
        console.log(`[DB] Resultado: ${exists ? 'registrado' : 'não registrado'}`);
        return exists;
    } catch (error) {
        console.error('[DB] Erro ao verificar registro:', error.message);
        throw error;
    }
};

const normalizeUniqueStrings = (items, maxItems) => {
    if (!Array.isArray(items) || maxItems <= 0) return [];

    const normalized = [];
    const seen = new Set();

    for (const value of items) {
        if (typeof value !== 'string') continue;

        const cleaned = value.trim().replace(/\s+/g, ' ');
        if (!cleaned) continue;

        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        normalized.push(cleaned);

        if (normalized.length >= maxItems) break;
    }

    return normalized;
};

const mergeMemoryField = (existing, incoming, maxItems) => {
    return normalizeUniqueStrings([...(existing || []), ...(incoming || [])], maxItems);
};

export const getUserMemory = async (id) => {
    const col = await getCollection();
    const user = await col.findOne(
        { id },
        {
            projection: {
                memoryTraits: 1,
                memoryLikes: 1,
                memoryDislikes: 1,
                memoryConversationNotes: 1,
                memoryLastUpdatedAt: 1,
            },
        }
    );

    return {
        traits: normalizeUniqueStrings(user?.memoryTraits || [], 12),
        likes: normalizeUniqueStrings(user?.memoryLikes || [], 12),
        dislikes: normalizeUniqueStrings(user?.memoryDislikes || [], 12),
        conversationNotes: normalizeUniqueStrings(user?.memoryConversationNotes || [], 20),
        lastUpdatedAt: user?.memoryLastUpdatedAt || null,
    };
};

export const buildUserMemoryPrompt = (memory) => {
    if (!memory) return '';

    const sections = [];

    if (memory.traits?.length) {
        sections.push(`- Personality traits: ${memory.traits.join('; ')}`);
    }
    if (memory.likes?.length) {
        sections.push(`- Likes/interests: ${memory.likes.join('; ')}`);
    }
    if (memory.dislikes?.length) {
        sections.push(`- Dislikes: ${memory.dislikes.join('; ')}`);
    }
    if (memory.conversationNotes?.length) {
        sections.push(`- Important previous context: ${memory.conversationNotes.join('; ')}`);
    }

    if (!sections.length) {
        return 'No previous memory was stored for this user yet.';
    }

    return [
        'User memory (can be used as soft context):',
        ...sections,
        'Use these references only when helpful and never invent details if uncertain.',
    ].join('\n');
};

export const saveUserMemoryInsights = async (id, username, insights) => {
    const col = await getCollection();

    const current = await getUserMemory(id);

    const nextTraits = mergeMemoryField(current.traits, insights?.traits, 12);
    const nextLikes = mergeMemoryField(current.likes, insights?.likes, 12);
    const nextDislikes = mergeMemoryField(current.dislikes, insights?.dislikes, 12);
    const nextNotes = mergeMemoryField(current.conversationNotes, insights?.conversationNotes, 20);

    await col.updateOne(
        { id },
        {
            $set: {
                id,
                username,
                memoryTraits: nextTraits,
                memoryLikes: nextLikes,
                memoryDislikes: nextDislikes,
                memoryConversationNotes: nextNotes,
                memoryLastUpdatedAt: new Date().toISOString(),
            },
            $setOnInsert: { registeredAt: new Date().toISOString() },
        },
        { upsert: true }
    );
};

export const shouldPersistUserMemory = async (id, username, frequency = 3) => {
    const col = await getCollection();

    const result = await col.findOneAndUpdate(
        { id },
        {
            $inc: { memoryMessageCounter: 1 },
            $set: { id, username },
            $setOnInsert: { registeredAt: new Date().toISOString() },
        },
        {
            upsert: true,
            returnDocument: 'after',
            projection: { memoryMessageCounter: 1 },
        }
    );

    // MongoDB driver compatibility: some versions return the document directly,
    // others wrap it in { value }.
    const updatedDoc = result?.value ?? result;
    const counter = Number(updatedDoc?.memoryMessageCounter || 0);
    const safeFrequency = Math.max(1, Number(frequency) || 3);

    console.log(`[Memory] Counter user=${id} value=${counter} freq=${safeFrequency}`);

    return counter > 0 && counter % safeFrequency === 0;
};
