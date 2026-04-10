import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { isRegistered, saveUser } from '../../services/users.js';

export const data = new SlashCommandBuilder()
    .setName('ativar-dm')
    .setDescription('Ativa a Zero na sua DM para que ela possa te responder.');

export const execute = async (interaction) => {
    const { user } = interaction;
    
    console.log(`\n[/ATIVAR] Usuário ${user.username} (${user.id}) executou o comando`);
    try {
        const registered = await isRegistered(user.id);
        console.log(`[/ATIVAR] Verificado: usuário já registrado? ${registered}`);

        if (registered) {
            await interaction.reply({
                content: 'Relaxa, você já está ativado. Pode falar comigo na DM diretamente. *...Iria ser preocupante se você tivesse esquecido.*',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        console.log(`[/ATIVAR] Salvando novo usuário: ${user.username}`);
        await saveUser(user.id, user.username);
        console.log('[/ATIVAR] Usuário salvo com sucesso');

        try {
            console.log(`[/ATIVAR] Tentando enviar DM para ${user.username}...`);
            await user.send('Pronto. Você está ativado agora. Pode falar comigo aqui quando quiser. *...Não demorou tanto assim, né?*');
            console.log('[/ATIVAR] DM enviada com sucesso');
        } catch (dmError) {
            console.error('[/ATIVAR] Erro ao enviar DM:', dmError.message);
        }

        await interaction.reply({
            content: 'Feito! Agora você pode me enviar mensagens na DM. *Não me decepcione.*',
            flags: MessageFlags.Ephemeral,
        });
        console.log('[/ATIVAR] Resposta enviada no servidor');
    } catch (error) {
        console.error('[/ATIVAR] Falha no processo de ativação:', error);

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'Não consegui validar seu acesso agora porque o banco está indisponível. Tenta novamente em instantes.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
};
