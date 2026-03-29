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
    const col = await getCollection();
    await col.updateOne(
        { id },
        { $set: { id, username }, $setOnInsert: { registeredAt: new Date().toISOString() } },
        { upsert: true }
    );
};

export const isRegistered = async (id) => {
    const col = await getCollection();
    return Boolean(await col.findOne({ id }));
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
