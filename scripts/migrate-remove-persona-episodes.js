import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config({ override: true });
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error('MONGODB_URI não configurada.');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 7000 });
try {
    await client.connect();
    const users = client.db('zerodb').collection('users');
    const before = await users.countDocuments({ personaEpisodes: { $exists: true } });
    const result = await users.updateMany(
        { personaEpisodes: { $exists: true } },
        { $unset: { personaEpisodes: '' } }
    );
    const remaining = await users.countDocuments({ personaEpisodes: { $exists: true } });

    console.log(JSON.stringify({
        matched: result.matchedCount,
        modified: result.modifiedCount,
        legacyDocumentsBefore: before,
        legacyDocumentsRemaining: remaining,
    }));
    if (remaining !== 0) process.exitCode = 1;
} finally {
    await client.close();
}
