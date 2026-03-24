export const createConnectionManager = (client, options) => {
    const {
        token,
        maxReconnectAttempts = 8,
        baseReconnectDelayMs = 2000,
        maxReconnectDelayMs = 30000,
        healthcheckIntervalMs = 30000,
    } = options;

    let reconnectAttempts = 0;
    let reconnectTimeout = null;
    let healthcheckInterval = null;
    let isRelogging = false;
    let isShuttingDown = false;

    const getReconnectDelay = (attempt) => {
        const delay = baseReconnectDelayMs * (2 ** Math.max(0, attempt - 1));
        return Math.min(delay, maxReconnectDelayMs);
    };

    const clearReconnectTimeout = () => {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    };

    const stopHealthcheck = () => {
        if (healthcheckInterval) {
            clearInterval(healthcheckInterval);
            healthcheckInterval = null;
        }
    };

    const scheduleReconnect = (reason = 'desconhecido') => {
        if (isShuttingDown || reconnectTimeout || isRelogging) return;

        reconnectAttempts += 1;
        const delay = getReconnectDelay(reconnectAttempts);

        if (reconnectAttempts > maxReconnectAttempts) {
            console.error(`Reconexão falhou após ${maxReconnectAttempts} tentativas (${reason}). Reiniciando processo...`);
            process.exit(1);
            return;
        }

        console.warn(`Bot offline (${reason}). Tentando reconectar em ${Math.round(delay / 1000)}s (tentativa ${reconnectAttempts}/${maxReconnectAttempts}).`);

        reconnectTimeout = setTimeout(async () => {
            reconnectTimeout = null;

            if (isShuttingDown || client.isReady()) {
                reconnectAttempts = 0;
                return;
            }

            isRelogging = true;
            try {
                try {
                    await client.destroy();
                } catch {
                    // Ignora erro de destroy se o cliente já estiver desconectado.
                }

                await client.login(token);
                console.log('Reconexão realizada com sucesso.');
                reconnectAttempts = 0;
            } catch (error) {
                console.error('Falha ao reconectar:', error);
                scheduleReconnect('falha no login');
            } finally {
                isRelogging = false;
            }
        }, delay);
    };

    const startHealthcheck = () => {
        if (healthcheckInterval || isShuttingDown) return;

        healthcheckInterval = setInterval(() => {
            if (!client.isReady()) {
                scheduleReconnect('healthcheck detectou bot offline');
            }
        }, healthcheckIntervalMs);
    };

    const registerClientHandlers = () => {
        client.on('ready', () => {
            reconnectAttempts = 0;
            startHealthcheck();
        });

        client.on('error', (error) => {
            console.error('Erro no cliente do Discord:', error);
            scheduleReconnect('evento error');
        });

        client.on('shardDisconnect', (event, shardId) => {
            console.warn(`Shard ${shardId} desconectada. Código: ${event?.code ?? 'n/a'}`);
            scheduleReconnect('shardDisconnect');
        });

        client.on('shardError', (error, shardId) => {
            console.error(`Erro na shard ${shardId}:`, error);
            scheduleReconnect('shardError');
        });

        client.on('invalidated', () => {
            if (isShuttingDown) return;
            console.error('Sessão invalidada pelo Discord. Reiniciando processo para recuperar sessão limpa...');
            process.exit(1);
        });
    };

    const start = async () => {
        if (isShuttingDown) return;

        try {
            await client.login(token);
        } catch (error) {
            console.error('Falha ao iniciar o bot:', error);
            scheduleReconnect('falha no startup');
        }
    };

    const shutdown = async (reason = 'manual') => {
        if (isShuttingDown) return;

        isShuttingDown = true;
        console.log(`Encerrando bot (${reason}) sem forçar reconexão...`);

        clearReconnectTimeout();
        stopHealthcheck();

        try {
            await client.destroy();
        } catch (error) {
            console.error('Erro ao encerrar cliente do Discord:', error);
        }
    };

    const isManualShutdown = () => isShuttingDown;

    return {
        registerClientHandlers,
        scheduleReconnect,
        start,
        shutdown,
        isManualShutdown,
    };
};
