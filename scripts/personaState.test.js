import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_EMOTIONAL_STATE,
    DEFAULT_RELATIONSHIP_STATE,
    loadPersonaState,
    persistPersonaTurn,
} from '../src/services/persona/personaStateService.js';

test('a leitura de persona não consulta personaEpisodes', async () => {
    let queryOptions;
    const collection = {
        findOne: async (_filter, options) => {
            queryOptions = options;
            return { personaEpisodes: [{ event: 'legacy personal event' }] };
        },
    };

    const state = await loadPersonaState('test-user', 'Test User', async () => collection);
    assert.equal(Object.hasOwn(queryOptions.projection, 'personaEpisodes'), false);
    assert.equal(Object.hasOwn(state, 'episodes'), false);
});

test('a gravação preserva os campos da persona, remove o campo legado e só registra metadados', async () => {
    let update;
    const collection = {
        updateOne: async (...args) => { update = args; return { modifiedCount: 1 }; },
    };
    const turn = {
        userId: 'test-user',
        username: 'Test User',
        interactionCount: 3,
        emotionalState: DEFAULT_EMOTIONAL_STATE,
        relationshipState: DEFAULT_RELATIONSHIP_STATE,
        opinions: [],
        previousState: {
            emotionalState: DEFAULT_EMOTIONAL_STATE,
            relationshipState: DEFAULT_RELATIONSHIP_STATE,
        },
        analysis: {
            text: 'sensitive conversation text',
            praise: 0,
            provocation: 0,
            trustSignal: 0,
            interesting: 1,
            hasImage: false,
            hasAudio: false,
        },
        plan: { responseMode: 'brief', secondaryBehaviors: [] },
    };

    const logged = [];
    const previousLog = console.log;
    console.log = (...values) => logged.push(values);
    try {
        await persistPersonaTurn(turn, 'answer', async () => collection);
    } finally {
        console.log = previousLog;
    }

    const [filter, changes, options] = update;
    assert.deepEqual(filter, { id: 'test-user' });
    assert.equal(changes.$set.personaEmotionalState, turn.emotionalState);
    assert.equal(changes.$set.personaRelationshipState, turn.relationshipState);
    assert.deepEqual(changes.$unset, { personaEpisodes: '' });
    assert.equal(Object.hasOwn(changes, '$push'), false);
    assert.equal(options.upsert, true);
    const transition = logged.find(([label]) => label === '[PERSONA_TRANSITION]')?.[1];
    assert.equal(transition.episode.stored, false);
    assert.equal(Object.hasOwn(transition.episode, 'event'), false);
    assert.equal(JSON.stringify(transition).includes(turn.analysis.text), false);
});
