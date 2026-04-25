import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config({ override: true });

let client = null;
let collection = null;

const getCollection = async () => {
    if (!client) {
        const uri = process.env.MONGODB_URI?.trim();
        if (!uri) {
            throw new Error('MONGODB_URI não configurada no .env');
        }

        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 3500,
        });
    }

    if (!collection) {
        await client.connect();
        const dbName = process.env.RUNTIMELOG_DB?.trim() || 'zerodb';
        const collectionName = process.env.RUNTIMELOG_COLLECTION?.trim() || 'runtime_logs';
        collection = client.db(dbName).collection(collectionName);
    }

    return collection;
};

export const saveRuntimeShutdownReport = async (doc) => {
    const col = await getCollection();
    return col.insertOne(doc);
};

