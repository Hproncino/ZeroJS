import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { isRegistered, saveUser } from '../users.js';

export const data = new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Ativa a Zero na sua DM para que ela possa te responder.');

export const execute = async (interaction) => {
    const { user } = interaction;

    if (await isRegistered(user.id)) {
        await interaction.reply({
            content: 'Relaxa, você já está ativado. Pode falar comigo na DM diretamente. *...Iria ser preocupante se você tivesse esquecido.*',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await saveUser(user.id, user.username);

    try {
        await user.send('Pronto. Você está ativado agora. Pode falar comigo aqui quando quiser. *...Não demorou tanto assim, né?*');
    } catch {
        // DMs bloqueadas pelo usuário — o registro ainda é confirmado
    }

    await interaction.reply({
        content: 'Feito! Agora você pode me enviar mensagens na DM. *Não me decepcione.*',
        flags: MessageFlags.Ephemeral,
    });
};
