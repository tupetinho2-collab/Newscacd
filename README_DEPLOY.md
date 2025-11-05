
# Deploy rápido para obter um URL público

## Opção A — Render (one-click a partir do repositório)
1. Crie um repositório no GitHub e **envie** todo o conteúdo desta pasta (incluindo `render.yaml`).
2. Acesse **dashboard.render.com** → **New** → **Blueprint**.
3. Selecione seu repositório e confirme. O Render executará:
   - `npm ci`
   - `cd client && npm ci && npm run build`
   - `cd server && npm ci`
   - e iniciará com `node server/index.js`.
4. Ao final do deploy, o Render mostrará um **URL público** (ex.: `https://radar-de-noticias.onrender.com`). É esse link que você pode usar.

> O servidor Express já está configurado para servir a **API** (`/api/news`) e o **front-end** (arquivos de `client/dist`).

## Opção B — Railway (Dockerfile)
1. Crie um repositório no GitHub e **envie** o conteúdo desta pasta.
2. Acesse **railway.app** → **New Project** → **Deploy from GitHub** e escolha o repositório.
3. O Railway detectará o **Dockerfile** e fará o build. Porta exposta: **4000**.
4. Quando o deploy terminar, você terá um **URL público**.
