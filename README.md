
# Radar de Notícias – (servidor + cliente)

Projeto completo para **coletar notícias** dos sites especificados e exibir em um **site moderno e animado**, com destaque para **imagens**, **filtro por fonte**, **ordenadas das mais recentes para as mais antigas**, e **apenas dos últimos 2 dias (hoje e ontem)** considerando o fuso **America/Sao_Paulo**. Há um botão **“Atualizar”**: as notícias **só são recarregadas** quando você clica nele (ou ao recarregar a página).

## Fontes incluídas
- UN News (PT) — `https://news.un.org/pt/news?page=0`
- MRE – Notas à Imprensa — `https://www.gov.br/mre/pt-br/canais_atendimento/imprensa/notas-a-imprensa`
- UNEP (ES) – Recursos — `https://www.unep.org/es/resources/filter/sort_by=publication_date/sort_order=desc/page=0`
- UNFCCC – News — `https://unfccc.int/news`
- Relações Exteriores (Artigos) — `https://relacoesexteriores.com.br/analises/artigo/`
- MMA – Notícias — `https://www.gov.br/mma/pt-br/noticias`
- InfoBRICS – News — `https://infobrics.org/en/news/`
- IBGE – Agência de Notícias — `https://agenciadenoticias.ibge.gov.br/agencia-noticias.html`
- MDIC – Notícias — `https://www.gov.br/mdic/pt-br/assuntos/noticias`
- Gov.br – Meio Ambiente e Clima — `https://www.gov.br/pt-br/noticias/meio-ambiente-e-clima`
- E-IR Articles — `https://www.e-ir.info/category/articles/`

> Observação: `relacoesexteriores.com.br/analises/artigo/` estava duplicado na sua lista; incluído apenas uma vez.

## Requisitos atendidos
- **Título, imagem, data e hora** de cada notícia
- Cada notícia **individualizada**, com botão **“Ler mais”** abrindo a página **original**
- **Ordenação**: mais recentes primeiro
- **Filtro**: “Todas” ou selecionar **apenas uma fonte**
- **Apenas hoje e ontem** (filtro feito no servidor com timezone **America/Sao_Paulo**)
- **Botão “Atualizar”**: só recarrega ao clicar (ou quando recarregar a página)
- **Layout** moderno e animado, com **mapa mundi** estilizado no topo e cores **azul, verde, vermelho e branco**
- **Cada aba de fonte** com **cor própria** (diferentes)

## Como rodar

### 1) Servidor (Node 18+)
```bash
cd server
npm i
npm run dev
# Servirá em http://localhost:4000
```

### 2) Cliente (Vite + React)
```bash
cd client
npm i
npm run dev
# Abrirá em http://localhost:5173 (com proxy de /api para :4000)
```

## Notas técnicas importantes
- **Scrap robusto**: cada fonte tem um parser dedicado com seletores principais e **fallback** (busca `og:image` e `article:published_time` na página do artigo quando a lista não traz imagem ou data).
- **Filtro temporal**: o servidor **descarta** qualquer item fora de **hoje e ontem** (considerando **America/Sao_Paulo**).
- **Ordenação**: os itens são ordenados no servidor do **mais recente** para o **mais antigo**.
- **Cache controlado**: o servidor mantém um cache simples; **só é atualizado** quando o cliente chama `/api/news?force=true` (o botão **“Atualizar”** já usa isso).
- **Imagens**: o componente **NewsCard** dá destaque forte à foto da manchete.
- **UX**: animações suaves com Framer Motion; tabs de fontes e **“Todas”**; mensagem quando não há notícias nos dois dias.

## Personalização
- **Cores por fonte**: edite `SOURCE_COLORS` no `client/src/App.jsx`.
- **Nome do site**: mude o título “Radar de Notícias” em `App.jsx` e `index.html`.
- **Mapa mundi**: o topo usa um **SVG** estilizado (embutido via Tailwind config). Substitua se quiser um mapa mais detalhado.

## Produção
Para deploy, você pode:
1. **Hospedar o servidor** (Express) em um serviço (Railway, Render, etc.);
2. **Build do cliente** (`npm run build`) e servir os arquivos estáticos (Netlify, Vercel, etc.), apontando o proxy de `/api` para o servidor.

---

**Dica CACDista**: essa curadoria é ótima para monitorar multilaterais (UN, UNEP, UNFCCC), órgãos governamentais (MRE, MDIC, MMA) e think tanks/revistas (E‑IR). Você pode adicionar novas fontes repetindo o padrão de parser no `index.js`.
