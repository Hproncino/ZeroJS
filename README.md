# ZeroJS

ZeroJS é um bot do Discord em Node.js com integração à OpenAI para conversas inteligentes, respostas em tempo real e suporte a transcrição de áudio.

## Tecnologias utilizadas

- Node.js
- JavaScript (ES Modules)
- discord.js
- OpenAI API (chat e transcrição)
- MongoDB (Para lembrar de características do usuário)
- dotenv

## Estrutura do projeto

```text
.
├─ index.js                  # bootstrap de compatibilidade (chama src/index.js)
├─ src/
│  ├─ index.js               # entrypoint principal do bot
│  ├─ core/                  # núcleo da aplicação (persona, conexão)
│  ├─ services/              # integrações externas e regras de serviço
│  │  ├─ audio/
│  │  └─ discord/
│  ├─ features/              # funcionalidades por domínio
│  │  └─ activation/
│  └─ shared/
│     └─ utils/
├─ scripts/
│  └─ test.js                # teste interativo local
└─ img/
```

## Scripts

- `npm run start` inicia o bot em modo normal.
- `npm run dev` inicia o bot com watch mode.
- `npm run test` executa o modo de teste interativo local.

## Principais funcionalidades

- Integração com OpenAI para respostas inteligentes.
- Respostas em streaming para reduzir latência percebida.
- Controle automático de mensagens longas (quebra em blocos para respeitar o limite de 2000 caracteres do Discord).
- Janela de contexto com até 10 mensagens anteriores para manter continuidade da conversa.
- Filtro de mensagens para ignorar bots, mensagens de sistema e comandos com prefixo `!`.
- Presença dinâmica no Discord com rotação de status.

## Features implementadas

- Transcrição automática de áudio anexado usando Whisper.
- Liberação de DM apenas para usuários registrados.
- Slash Command de ativação para liberar o acesso em mensagens diretas.
- Registro de usuários ativados em MongoDB.
- Envio opcional de imagem aleatória local junto à resposta final.

## Observações

- Em servidor, o bot responde somente no canal definido por `CHANNEL_ID`.
- Em DM, apenas usuários ativados conseguem conversar com o bot.

## Exemplos

![Exemplo 1](/img/exemplos/image.png)

![Exemplo 2](https://github.com/user-attachments/assets/5330edd2-1507-4119-b089-aaeafcc29954)

