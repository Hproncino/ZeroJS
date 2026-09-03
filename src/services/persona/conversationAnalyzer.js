const clamp = (value) => Math.max(0, Math.min(1, value));

const countMatches = (text, patterns) => patterns.reduce(
    (total, pattern) => total + (pattern.test(text) ? 1 : 0),
    0
);

export const analyzeConversation = ({ text = '', history = [], hasImage = false, hasAudio = false } = {}) => {
    const normalized = String(text).toLowerCase();
    const recentUserMessages = history.filter((message) => message.role === 'user').length;
    const praise = countMatches(normalized, [/obrigad/, /incr[ií]vel/, /excelente/, /boa bot/, /voc[eê] [eé] (boa|genial)/]);
    const provocation = countMatches(normalized, [/burra/, /idiota/, /calad/, /in[uú]til/, /voc[eê] n[aã]o sabe/]);
    const trustSignal = countMatches(normalized, [/confio/, /acredito em voc[eê]/, /me ajuda/, /preciso de voc[eê]/]);
    const interesting = countMatches(normalized, [/por que/, /como funciona/, /tecnologia/, /ci[eê]ncia/, /hist[oó]ria/, /ideia/, /teoria/, /curios/]);
    const disagreement = countMatches(normalized, [/discordo/, /voc[eê] est[aá] errad/, /n[aã]o concordo/]);
    const question = /\?/.test(normalized);
    const longMessage = normalized.length > 600;

    return {
        text: String(text).trim(),
        praise,
        provocation,
        trustSignal,
        interesting,
        disagreement,
        question,
        longMessage,
        hasImage,
        hasAudio,
        conversationLength: recentUserMessages,
        novelty: clamp(0.25 + (interesting * 0.18) + (hasImage ? 0.1 : 0)),
        sentiment: clamp(0.5 + (praise * 0.16) - (provocation * 0.18)),
    };
};
