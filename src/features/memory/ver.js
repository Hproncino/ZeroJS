import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserMemory } from '../../services/users.js';

export const data = new SlashCommandBuilder()
    .setName('memoria-ver')
    .setDescription('Mostra o que a Zero lembra sobre você.');

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

        await interaction.reply({
            content: [
                `**Memória da Zero sobre ${user.username}:**`,
                memoryText,
                `**Atualizada em:** ${formatTimestamp(memory.lastUpdatedAt)}`,
            ].join('\n\n'),
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        console.error('[/MEMORIA-VER] Falha ao consultar memória:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'Não consegui acessar sua memória agora. Tenta novamente em instantes.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
};