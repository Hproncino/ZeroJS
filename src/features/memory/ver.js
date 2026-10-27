import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserMemory } from '../../services/users.js';

export const data = new SlashCommandBuilder()
    .setName('memoria-ver')
    .setDescription('Mostra o que a Zero lembra sobre você.');

const MAX_MESSAGE_LENGTH = 1900;

const formatList = (label, items) => {
    if (!items?.length) return null;
    return [`**${label}:**`, ...items.map((item) => `- ${item}`)].join('\n');
};

const formatTimestamp = (value) => {
    if (!value) return 'Nunca';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Desconhecido';

    return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
};

const splitDiscordMessages = (text) => {
    const chunks = [];
    let current = '';

    for (const originalLine of String(text).split('\n')) {
        let line = originalLine;
        if (line.length > MAX_MESSAGE_LENGTH) {
            if (current) chunks.push(current);
            current = '';

            while (line.length > MAX_MESSAGE_LENGTH) {
                let splitAt = MAX_MESSAGE_LENGTH;
                const previousCodeUnit = line.charCodeAt(splitAt - 1);
                if (previousCodeUnit >= 0xD800 && previousCodeUnit <= 0xDBFF) splitAt -= 1;
                chunks.push(line.slice(0, splitAt));
                line = line.slice(splitAt);
            }
        }

        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > MAX_MESSAGE_LENGTH) {
            if (current) chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }

    if (current) chunks.push(current);
    return chunks;
};

export const execute = async (interaction) => {
    const { user } = interaction;

    try {
        const memory = await getUserMemory(user.id);
        const sections = [
            formatList('Traços', memory.traits),
            formatList('Curtidas', memory.likes),
            formatList('Desgostos', memory.dislikes),
            formatList('Notas de conversa', memory.conversationNotes),
        ].filter(Boolean);

        const memoryText = sections.length
            ? sections.join('\n\n')
            : '_Ainda não há memória salva para você._';
        const chunks = splitDiscordMessages([
            `**Memória da Zero sobre ${user.username}:**`,
            memoryText,
            `**Atualizada em:** ${formatTimestamp(memory.lastUpdatedAt)}`,
        ].join('\n\n'));

        await interaction.reply({ content: chunks[0], flags: MessageFlags.Ephemeral });
        for (const chunk of chunks.slice(1)) {
            await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
        }
    } catch (error) {
        console.error('[/MEMORIA-VER] Falha ao consultar memória:', error?.message || error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'Não consegui acessar sua memória agora. Tenta novamente em instantes.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
};
