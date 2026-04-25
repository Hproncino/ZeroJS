import { Events } from 'discord.js';
import { setCurrentActivity, setShutdownMeta } from '../shared/runtimeLog.js';

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
    let isShuttingDown = false;
    let handlersRegistered = false;
    let startPromise = null;
    const normalizedToken = typeof token === 'string' ? token.trim() : '';

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
        if (isShuttingDown || reconnectTimeout) return;

        reconnectAttempts += 1;
        const delay = getReconnectDelay(reconnectAttempts);

        if (reconnectAttempts > maxReconnectAttempts) {
            console.error(`Reconexão falhou após ${maxReconnectAttempts} tentativas (${reason}). Reiniciando processo...`);
            setShutdownMeta({ reason: 'reconnectExceeded', detail: reason });
            setCurrentActivity(`connectionManager exit: reconnectExceeded reason=${reason} attempts=${reconnectAttempts}/${maxReconnectAttempts}`);
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

            // Reinicia processo em vez de relogar no mesmo Client para evitar acumulo de listeners internos do shard.
            console.error('Cliente segue offline apos janela de reconexao. Reiniciando processo...');
            setShutdownMeta({ reason: 'reconnectWindowExpired', detail: reason });
            setCurrentActivity(`connectionManager exit: reconnectWindowExpired reason=${reason} attempts=${reconnectAttempts}/${maxReconnectAttempts}`);
            process.exit(1);
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
        if (handlersRegistered) return;
        handlersRegistered = true;

        client.on(Events.ClientReady, () => {
            reconnectAttempts = 0;
            startHealthcheck();
        });

        client.on('error', (error) => {
            console.error('Erro no cliente do Discord:', error);
            scheduleReconnect('evento error');
        });

        client.on('shardDisconnect', (event, shardId) => {
            console.warn(`Shard ${shardId} desconectada. Codigo: ${event?.code ?? 'n/a'}`);
            scheduleReconnect('shardDisconnect');
        });

        client.on('shardError', (error, shardId) => {
            console.error(`Erro na shard ${shardId}:`, error);
            scheduleReconnect('shardError');
        });

        client.on('invalidated', () => {
            if (isShuttingDown) return;
            console.error('Sessao invalidada pelo Discord. Reiniciando processo para recuperar sessao limpa...');
            setShutdownMeta({ reason: 'discordInvalidated' });
            setCurrentActivity('connectionManager exit: discord invalidated');
            process.exit(1);
        });
    };

    const start = async () => {
        if (isShuttingDown) return;
        if (startPromise) return startPromise;

        if (!normalizedToken) {
            console.error('TOKEN do Discord ausente ou vazio. Verifique o arquivo .env e as variáveis de ambiente.');
            return;
        }

        startPromise = (async () => {
            try {
                await client.login(normalizedToken);
            } catch (error) {
                console.error('Falha ao iniciar o bot:', error);
                startPromise = null;
                scheduleReconnect('falha no startup');
                throw error;
            } finally {
                if (!client.isReady()) {
                    startPromise = null;
                }
            }
        })();

        return startPromise.catch(() => undefined);
    };

    const shutdown = async (reason = 'manual') => {
        if (isShuttingDown) return;

        isShuttingDown = true;
        console.log(`Encerrando bot (${reason}) sem forcar reconexao...`);

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
