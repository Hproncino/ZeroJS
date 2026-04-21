# Guia de Instalacao - ZeroJS

Este arquivo documenta a instalacao das tecnologias usadas no projeto.

## Tecnologias do projeto

- Node.js 20+
- npm
- discord.js
- OpenAI API
- MongoDB
- dotenv

## 1. Pre-requisitos

1. Instale Node.js 20 ou superior.
2. Garanta que o npm esteja disponivel.
3. Tenha uma aplicacao e bot no Discord Developer Portal.
4. Gere uma chave da OpenAI.
5. Tenha um MongoDB local ou MongoDB Atlas.

Verifique no terminal:

```bash
node -v
npm -v
```

## 2. Instalar dependencias

Na raiz do projeto:

```bash
npm install
```

## 3. Configurar variaveis de ambiente

Crie um arquivo `.env` na raiz com:

```env
TOKEN=SEU_TOKEN_DO_DISCORD
OPENAI_API_KEY=SUA_CHAVE_DA_OPENAI
MONGODB_URI=SUA_URI_MONGODB
CHANNEL_ID=ID_DO_CANAL_DISCORD
```

## 4. Rodar o bot

Modo desenvolvimento:

```bash
npm run dev
```

Modo normal:

```bash
npm run start
```

Teste local:

```bash
npm run test
```

## 5. Dependencias instaladas

- @supabase/supabase-js
- discord.js
- dotenv
- mongodb
- openai
