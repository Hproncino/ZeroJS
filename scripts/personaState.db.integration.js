import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import {
    DEFAULT_EMOTIONAL_STATE,
    DEFAULT_RELATIONSHIP_STATE,
    persistPersonaTurn,
} from '../src/services/persona/personaStateService.js';

dotenv.config({ override: true });
const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error('MONGODB_URI não configurada.');

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 7000 });
const testId = `__persona_episodes_db_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let collection;

try {
    await client.connect();
    collection = client.db('zerodb').collection('users');
    await collection.insertOne({
        id: testId,
        username: 'persona-db-integration-test',
        personaEpisodes: [{ event: 'legacy test event' }],
    });

    await persistPersonaTurn({
        userId: testId,
        username: 'persona-db-integration-test',
        interactionCount: 0,
        emotionalState: DEFAULT_EMOTIONAL_STATE,
        relationshipState: DEFAULT_RELATIONSHIP_STATE,
        opinions: [],
        previousState: {
            emotionalState: DEFAULT_EMOTIONAL_STATE,
            relationshipState: DEFAULT_RELATIONSHIP_STATE,
        },
        analysis: {
            text: 'synthetic database integration test',
            praise: 0,
            provocation: 0,
            trustSignal: 0,
            interesting: 0,
            hasImage: false,
            hasAudio: false,
        },
        plan: { responseMode: 'brief', secondaryBehaviors: [] },
    }, '', async () => collection);

    const saved = await collection.findOne({ id: testId });
    assert.ok(saved, 'persona user record should remain present');
    assert.equal(Object.hasOwn(saved, 'personaEpisodes'), false, 'legacy personaEpisodes should be unset');
    assert.equal(saved.personaInteractionCount, 1);
    assert.deepEqual(saved.personaEmotionalState, DEFAULT_EMOTIONAL_STATE);
    console.log('MongoDB integration: persona fields saved, legacy personaEpisodes removed.');
} finally {
    if (collection) {
        const cleanup = await collection.deleteOne({ id: testId });
        assert.equal(cleanup.deletedCount, 1, 'temporary integration-test record should be removed');
        const legacyCount = await collection.countDocuments({ personaEpisodes: { $exists: true } });
        console.log(`MongoDB cleanup: temporary record removed; legacy personaEpisodes documents remaining=${legacyCount}.`);
    }
    await client.close();
}
