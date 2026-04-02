import { REST, Routes } from 'discord.js';

export const registerGlobalCommands = async (token, applicationId, commands) => {
    const rest = new REST().setToken(token);

    await rest.put(
        Routes.applicationCommands(applicationId),
        { body: commands }
    );
};
