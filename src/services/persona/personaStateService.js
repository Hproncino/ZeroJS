import { getCollection } from '../users.js';
import { recordPersonaTransition } from '../../shared/runtimeLog.js';
import { analyzeConversation } from './conversationAnalyzer.js';
import { planResponse, buildPersonaContext } from './responsePlanner.js';

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const blend = (current, delta, inertia = 0.86) => clamp((Number(current) || 0) * inertia + clamp((Number(current) || 0) + delta) * (1 - inertia));

const DEFAULT_OPINIONS = Object.freeze([
    'Explicações claras são melhores do que jargão usado para parecer inteligente.',
    'Curiosidade vale mais do que certeza performática.',
    'Discordar com argumentos é mais útil do que concordar por conveniência.',
]);

const personaLocks = new Map();

export const acquirePersonaLock = async (userId) => {
    const key = String(userId || 'unknown');
    const previous = personaLocks.get(key) || Promise.resolve();
    let unlock;
    const current = new Promise((resolve) => { unlock = resolve; });
    personaLocks.set(key, current);
    await previous;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        unlock();
        if (personaLocks.get(key) === current) personaLocks.delete(key);
    };
};

export const DEFAULT_EMOTIONAL_STATE = Object.freeze({
    mood: 'curious', energy: 0.72, warmth: 0.41, irritation: 0.12, confidence: 0.91, curiosity: 0.83,
});

const ALLOWED_MOODS = new Set(['curious', 'irritated', 'calm', 'focused', 'playful', 'tired']);

const normalizeOpinions = (opinions) => (Array.isArray(opinions) ? opinions : [])
    .filter((opinion) => typeof opinion === 'string')
    .map((opinion) => opinion.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 12);

export const DEFAULT_RELATIONSHIP_STATE = Object.freeze({
    familiarity: 0, trust: 0.35, respect: 0.5, affection: 0.2, annoyance: 0.08,
});

const normalizeState = (state, defaults) => Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
        key,
        key === 'mood'
            ? (ALLOWED_MOODS.has(state?.[key]) ? state[key] : value)
            : clamp(state?.[key] ?? value),
    ])
);

export const loadPersonaState = async (userId, username, collectionProvider = getCollection) => {
    const collection = await collectionProvider();
    const user = await collection.findOne(
        { id: userId },
        { projection: { personaEmotionalState: 1, personaRelationshipState: 1, personaOpinions: 1, personaInteractionCount: 1 } }
    );

    return {
        userId,
        username,
        emotionalState: normalizeState(user?.personaEmotionalState, DEFAULT_EMOTIONAL_STATE),
        relationshipState: normalizeState(user?.personaRelationshipState, DEFAULT_RELATIONSHIP_STATE),
        opinions: normalizeOpinions(user?.personaOpinions).length
            ? normalizeOpinions(user.personaOpinions)
            : [...DEFAULT_OPINIONS],
        interactionCount: Number(user?.personaInteractionCount) || 0,
    };
};

export const updatePersonaState = ({ emotionalState, relationshipState, analysis }) => {
    const nextEnergy = blend(emotionalState.energy, analysis.longMessage ? -0.12 : -0.015, 0.9);
    const nextIrritation = blend(emotionalState.irritation, analysis.provocation * 0.12 - analysis.praise * 0.03, 0.82);
    const nextCuriosity = blend(emotionalState.curiosity, analysis.interesting * 0.08 + analysis.novelty * 0.03 - 0.01, 0.86);
    const nextEmotional = {
        ...emotionalState,
        mood: analysis.provocation > 0 && nextIrritation >= 0.3
            ? 'irritated'
            : analysis.longMessage && nextEnergy <= 0.35
                ? 'tired'
                : analysis.interesting > 0 && nextCuriosity >= 0.65
                    ? 'curious'
                    : emotionalState.mood,
        energy: nextEnergy,
        warmth: blend(emotionalState.warmth, analysis.praise * 0.08 - analysis.provocation * 0.05),
        irritation: nextIrritation,
        confidence: blend(emotionalState.confidence, analysis.trustSignal * 0.05, 0.9),
        curiosity: nextCuriosity,
    };
    const nextRelationship = {
        familiarity: blend(relationshipState.familiarity, 0.035, 0.96),
        trust: blend(relationshipState.trust, analysis.trustSignal * 0.06 - analysis.provocation * 0.04, 0.92),
        respect: blend(relationshipState.respect, analysis.interesting * 0.025 - analysis.provocation * 0.018, 0.94),
        affection: blend(relationshipState.affection, analysis.praise * 0.06 - analysis.provocation * 0.025, 0.92),
        annoyance: blend(relationshipState.annoyance, analysis.provocation * 0.1 - analysis.praise * 0.02, 0.84),
    };

    return { emotionalState: nextEmotional, relationshipState: nextRelationship };
};

export const preparePersonaTurn = async ({ userId, username, text, history = [], hasImage = false, hasAudio = false }) => {
    const state = await loadPersonaState(userId, username);
    const analysis = analyzeConversation({ text, history, hasImage, hasAudio });
    const nextState = updatePersonaState({ ...state, analysis });
    const memories = [];
    const plan = planResponse({ ...nextState, analysis, memories, opinions: state.opinions });

    return {
        ...state,
        ...nextState,
        previousState: {
            emotionalState: state.emotionalState,
            relationshipState: state.relationshipState,
        },
        analysis,
        memories,
        plan,
        contextMessage: buildPersonaContext({ ...nextState, memories, plan }),
    };
};

export const persistPersonaTurn = async (turn, response, collectionProvider = getCollection) => {
    const collection = await collectionProvider();
    const eventText = (turn.analysis.text || (turn.analysis.hasImage ? 'O usuário enviou uma imagem para análise.' : 'O usuário interagiu com a Zero.'))
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const episode = {
        event: eventText.slice(0, 500),
        importance: clamp(0.25 + turn.analysis.interesting * 0.12 + turn.analysis.trustSignal * 0.1),
        emotionalWeight: clamp(Math.abs(turn.analysis.praise * 0.12 - turn.analysis.provocation * 0.15) + 0.2),
        timestamp: new Date().toISOString(),
    };

    try {
        await collection.updateOne(
            { id: turn.userId },
            {
                $set: {
                    id: turn.userId,
                    username: turn.username,
                    personaEmotionalState: turn.emotionalState,
                    personaRelationshipState: turn.relationshipState,
                    personaOpinions: turn.opinions,
                    personaLastUpdatedAt: episode.timestamp,
                },
                $unset: { personaEpisodes: '' },
                $inc: { personaInteractionCount: 1 },
                $setOnInsert: { registeredAt: episode.timestamp },
            },
            { upsert: true }
        );
    } catch (error) {
        recordPersonaTransition({
            userId: turn.userId,
            interactionCount: turn.interactionCount + 1,
            previous: turn.previousState,
            next: turn,
            analysis: turn.analysis,
            plan: turn.plan,
            episode: { stored: false, importance: episode.importance, emotionalWeight: episode.emotionalWeight },
            persistence: 'failed',
        });
        throw error;
    }

    recordPersonaTransition({
        userId: turn.userId,
        interactionCount: turn.interactionCount + 1,
        previous: turn.previousState,
        next: turn,
        analysis: turn.analysis,
        plan: turn.plan,
        episode: { stored: false, importance: episode.importance, emotionalWeight: episode.emotionalWeight },
        persistence: 'saved',
    });
};
