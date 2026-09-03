# ZeroJS

ZeroJS é um bot do Discord em Node.js com integração à OpenAI para conversas inteligentes, respostas em tempo real, transcrição de áudio e interpretação de imagens anexadas.

Guia de instalação das tecnologias: [README.instalacao.md](./README.instalacao.md)

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
│  │  └─ persona/            # análise, estado, memória episódica e planner
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
- Leitura de anexos de imagem enviados pelo usuário para descrever o que aparece na imagem.
- Transcrição de anexos de áudio antes de enviar o contexto para a OpenAI.

## Features implementadas

- Transcrição automática de áudio anexado usando Whisper.
- Liberação de DM apenas para usuários registrados.
- Slash Command de ativação para liberar o acesso em mensagens diretas.
- Registro de usuários ativados em MongoDB.
- Envio opcional de imagem aleatória local junto à resposta final.
- Interpretação de imagens enviadas pelo usuário com análise multimodal via OpenAI.

## Consciência do bot

- O bot mantém memória de usuário em MongoDB e usa isso como contexto suave nas conversas.
- Em diálogos recentes, ele considera o histórico da conversa para preservar continuidade.
- Ao receber uma imagem, ele tenta descrever apenas o que está visível e evita inventar detalhes quando a imagem está ruim ou ambígua.
- O bot não gera imagens; ele apenas interpreta imagens enviadas e pode responder com imagens locais aleatórias quando isso estiver habilitado.
- Em áudio, ele transcreve o anexo antes de responder.

## Persona State

A personalidade dinâmica fica fora do LLM e é processada por módulos independentes:

1. `conversationAnalyzer.js` extrai sinais graduais da mensagem (elogio, provocação, confiança, curiosidade, tamanho e mídia).
2. `personaStateService.js` aplica inércia ao estado emocional e ao relacionamento, recupera episódios e coordena o turno.
3. `responsePlanner.js` escolhe modo e comportamentos secundários, como detalhar, provocar, discordar, demonstrar curiosidade, hesitar ou fazer referência a uma memória.
4. O `src/index.js` envia o estado atual, episódios relevantes e plano como uma mensagem `system` estruturada. O LLM transforma essa intenção em linguagem, mas não controla a transição de estado.
5. Depois do envio, o novo estado e o episódio da interação são persistidos.

No documento MongoDB do usuário, os campos `personaEmotionalState`, `personaRelationshipState`, `personaOpinions`, `personaEpisodes`, `personaInteractionCount` e `personaLastUpdatedAt` mantêm a continuidade. Episódios ficam limitados aos 40 mais recentes para evitar crescimento sem limite. A análise e o plano são temporários durante o turno; o histórico recente continua sendo responsabilidade do Discord.

O estado usa valores entre `0` e `1`, atualização com inércia e regras explícitas: elogios elevam warmth/affection, provocações elevam irritation/annoyance, confiança eleva trust/confidence, assuntos interessantes elevam curiosity e mensagens longas consomem energy. Ausência do MongoDB não impede a resposta: a persona é omitida naquele turno e o fluxo existente segue em modo degradado.

### Segurança e observabilidade

O texto de episódios é tratado como dado não confiável: é limitado, higienizado e nunca é usado como instrução. Episódios só entram no contexto quando compartilham termos com a mensagem atual ou possuem importância muito alta. O `mood` aceito é limitado a valores conhecidos e todas as métricas numéricas são normalizadas entre `0` e `1`; portanto, conteúdo do usuário não pode atribuir diretamente uma emoção ou comando ao sistema.

Cada turno persistido gera um evento `[PERSONA_TRANSITION]` no log de execução, contendo usuário, contador, estado emocional anterior/seguinte, relacionamento anterior/seguinte, sinais detectados e plano escolhido. O texto da mensagem não é incluído nesse evento. Para acompanhar um teste manual, observe o caminho `logs/run-...-pid....log` exibido no cabeçalho do processo; o mesmo trecho fica no relatório `logs/shutdown-...log` quando o processo encerra.

## Observações

- Em servidor, o bot responde somente no canal definido por `CHANNEL_ID`.
- Em DM, apenas usuários ativados conseguem conversar com o bot.

## Exemplos

![Exemplo1](https://github.com/user-attachments/assets/bfd8d39b-21f1-4dbb-9525-88847169db99)


![Exemplo 2](https://github.com/user-attachments/assets/5330edd2-1507-4119-b089-aaeafcc29954)


