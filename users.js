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
