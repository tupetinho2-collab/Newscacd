import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(localizedFormat);
dayjs.extend(customParseFormat);

// Timezone usado no filtro (hoje + ontem)
const DEFAULT_TZ = "America/Sao_Paulo";
const PORT = process.env.PORT || 4000;

// Fetch com timeout
// Utility: safe fetch with timeout + headers "reais"
async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const timeoutMs = opts.timeout ?? 20000; // 20s
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}
function parseDateTime(raw) {
  if (!raw) return null;

  // Tenta ISO primeiro
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?)?/);
  if (isoMatch) {
    const d = dayjs.tz(isoMatch[0], DEFAULT_TZ);
    if (d.isValid()) return d.toISOString();
  }

  // Normalizações comuns no gov.br etc.
  let cleaned = normalizeWhitespace(raw)
    .replace(/\|/g, " ")
    .replace(/Publicado em:?\s*/i, "")
    .replace(/Publicada em:?\s*/i, "")
    .replace(/Atualizado em:?\s*/i, "")
    .replace(/[–—−]/g, "-")           // hifens variantes
    .replace(/\bàs?\s+/i, " ")         // "às 14h" -> " 14h"
    .replace(/(\d{1,2})h(\d{2})/g, "$1:$2") // 18h45 -> 18:45
    .replace(/(\d{1,2})h\b/g, "$1:00");     // 9h -> 9:00

  // Formatos numéricos mais comuns
  const formats = [
    "DD/MM/YYYY HH:mm",
    "DD/MM/YYYY",
    "D/M/YYYY",
    "DD-MM-YYYY HH:mm",
    "DD-MM-YYYY",
    "DD.MM.YYYY HH:mm",
    "DD.MM.YYYY",
    // Inglês (UN/UNFCCC)
    "D MMMM YYYY HH:mm",
    "D MMMM YYYY",
    "MMMM D, YYYY HH:mm",
    "MMMM D, YYYY",
  ];

  for (const fmt of formats) {
    const d = dayjs.tz(cleaned, fmt, DEFAULT_TZ); // (string, format, tz)
    if (d.isValid()) return d.toISOString();
  }

  // Último recurso: extrair dd/mm/yyyy (ou -, .) com hora opcional
  const dmY = cleaned.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if (dmY) {
    const [, dd, mm, yyyy, hhmm] = dmY;
    const s = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}${hhmm ? "T" + hhmm + ":00" : "T12:00:00"}`;
    const d = dayjs.tz(s, DEFAULT_TZ);
    if (d.isValid()) return d.toISOString();
  }

  return null;
}

function withinLastTwoDays(iso, tz = DEFAULT_TZ) {
  if (!iso) return false;
  const now = dayjs().tz(tz);
  const startToday = now.startOf("day");
  const startYesterday = startToday.subtract(1, "day");
  const endToday = startToday.endOf("day");

  const d = dayjs.tz(iso, tz);
  return d.valueOf() >= startYesterday.valueOf() && d.valueOf() <= endToday.valueOf();
}


// Fallback: pega og:image e article:published_time da página da matéria
// Fallback: pega og:image e published_time (mais variantes comuns)
async function fetchArticleMeta(url) {
  try {
    const html = await safeFetch(url);
    const $ = cheerio.load(html);

    const ogImage =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      null;

    // procura várias metatags de data usadas por gov.br/UN/etc.
    const ogTime =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[property="article:modified_time"]').attr("content") ||
      $('meta[property="og:updated_time"]').attr("content") ||
      $('meta[name="dc.date"]').attr("content") ||
      $('meta[name="date"]').attr("content") ||
      $('meta[itemprop="datePublished"]').attr("content") ||
      $('meta[itemprop="dateModified"]').attr("content") ||
      $("time[datetime]").attr("datetime") ||
      null;

    const publishedAt = parseDateTime(ogTime) || null;
    return { ogImage, publishedAt };
  } catch {
    return { ogImage: null, publishedAt: null };
  }
}

/* ====================== PARSERS ====================== */

async function scrapeUNNewsPT() {
  const url = "https://news.un.org/pt/news?page=0";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".view-content .views-row").each((_, el) => {
    const title = normalizeWhitespace($(el).find("h2 a").text());
    const link = $(el).find("h2 a").attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") ||
      $(el).find(".views-field-created .field-content").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://news.un.org${link}`,
        image:
          img && (img.startsWith("http") ? img : `https://news.un.org${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeMRE() {
  const url =
    "https://www.gov.br/mre/pt-br/canais_atendimento/imprensa/notas-a-imprensa";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".listagem .item, .tileListaNoticias .item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") ||
      $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image:
          img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeUNEP() {
  const url =
    "https://www.unep.org/es/resources/filter/sort_by=publication_date/sort_order=desc/page=0";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".view-content .views-row, .search-result").each((_, el) => {
    const a = $(el).find("h3 a, h2 a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") ||
      $(el).find(".date, .field--name-field-date").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.unep.org${link}`,
        image:
          img && (img.startsWith("http") ? img : `https://www.unep.org${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeUNFCCC() {
  const url = "https://unfccc.int/news";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".view-content .views-row, article, .news-listing .news-item").each(
    (_, el) => {
      const a = $(el).find("h2 a, h3 a").first();
      const title = normalizeWhitespace(a.text());
      const link = a.attr("href");
      const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
      const timeText =
        $(el).find("time").attr("datetime") || $(el).find(".date").text();
      const publishedAt = parseDateTime(timeText);
      if (title && link) {
        items.push({
          title,
          url: link.startsWith("http") ? link : `https://unfccc.int${link}`,
          image:
            img &&
            (img.startsWith("http") ? img : `https://unfccc.int${img}`),
          publishedAt,
        });
      }
    }
  );
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeRelacoesExteriores() {
  const url = "https://relacoesexteriores.com.br/analises/artigo/";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $("article").each((_, el) => {
    const a = $(el).find("h2 a, .entry-title a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") || $(el).find(".posted-on").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({ title, url: link, image: img, publishedAt });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeMMA() {
  const url = "https://www.gov.br/mma/pt-br/noticias";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".listagem .item, .tileListaNoticias .item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") ||
      $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image:
          img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeInfoBRICS() {
  const url = "https://infobrics.org/en/news/";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".news-list .news-item, article, .content .news").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(
      $(el).find("h3, h2").first().text() || a.text()
    );
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find(".date, time").first().text() ||
      $(el).find("time").attr("datetime");
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://infobrics.org${link}`,
        image:
          img &&
          (img.startsWith("http") ? img : `https://infobrics.org${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeIBGE() {
  const url = "https://agenciadenoticias.ibge.gov.br/agencia-noticias.html";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".noticiasGrid .row .lista-noticias a, .lista-noticias a").each((_, el) => {
    const a = $(el);
    const title = normalizeWhitespace(
      a.find(".titulo").text() || a.attr("title")
    );
    const link = a.attr("href");
    const img = a.find("img").attr("data-src") || a.find("img").attr("src");
    const timeText =
      a.find(".data-publicacao, time").text() || a.find("time").attr("datetime");
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http")
          ? link
          : `https://agenciadenoticias.ibge.gov.br${link}`,
        image:
          img &&
          (img.startsWith("http")
            ? img
            : `https://agenciadenoticias.ibge.gov.br${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeMDIC() {
  const url = "https://www.gov.br/mdic/pt-br/assuntos/noticias";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".listagem .item, .tileListaNoticias .item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") ||
      $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image:
          img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeGovBRMeioAmbienteClima() {
  const url = "https://www.gov.br/pt-br/noticias/meio-ambiente-e-clima";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".listagem .item, .tileListaNoticias .item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") ||
      $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image:
          img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt,
      });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

async function scrapeEIR() {
  const url = "https://www.e-ir.info/category/articles/";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $("article").each((_, el) => {
    const a = $(el).find("h2 a, .entry-title a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
    const timeText =
      $(el).find("time").attr("datetime") || $(el).find(".posted-on").text();
    const publishedAt = parseDateTime(timeText);
    if (title && link) {
      items.push({ title, url: link, image: img, publishedAt });
    }
  });
  for (const it of items) {
    if (!it.image || !it.publishedAt) {
      const meta = await fetchArticleMeta(it.url);
      it.image = it.image || meta.ogImage;
      it.publishedAt = it.publishedAt || meta.publishedAt;
    }
  }
  return items;
}

/* ====================== REGISTRO DE FONTES ====================== */

const SOURCES = [
  { key: "un_news_pt", name: "UN News (PT)", color: "#1d4ed8", fetcher: scrapeUNNewsPT },
  { key: "mre_notas", name: "MRE – Notas à Imprensa", color: "#16a34a", fetcher: scrapeMRE },
  { key: "unep_es", name: "UNEP (ES) – Recursos", color: "#ef4444", fetcher: scrapeUNEP },
  { key: "unfccc", name: "UNFCCC – News", color: "#0ea5e9", fetcher: scrapeUNFCCC },
  { key: "relacoes_exteriores", name: "Relações Exteriores (Artigos)", color: "#9333ea", fetcher: scrapeRelacoesExteriores },
  { key: "mma", name: "MMA – Notícias", color: "#16a34a", fetcher: scrapeMMA },
  { key: "infobrics", name: "InfoBRICS – News", color: "#ef4444", fetcher: scrapeInfoBRICS },
  { key: "ibge", name: "IBGE – Agência de Notícias", color: "#1f2937", fetcher: scrapeIBGE },
  { key: "mdic", name: "MDIC – Notícias", color: "#1d4ed8", fetcher: scrapeMDIC },
  { key: "govbr_meio_ambiente", name: "Gov.br – Meio Ambiente e Clima", color: "#0d9488", fetcher: scrapeGovBRMeioAmbienteClima },
  { key: "eir", name: "E-IR Articles", color: "#dc2626", fetcher: scrapeEIR },
];

/* ====================== CACHE + API ====================== */

const cache = new Map();
const CACHE_MS = 1000 * 60 * 60; // 1h

async function getSourceData(src) {
  const cached = cache.get(src.key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const data = await src.fetcher();
  cache.set(src.key, { data, at: Date.now() });
  return data;
}
async function getSourceDataForce(src) {
  const data = await src.fetcher();
  cache.set(src.key, { data, at: Date.now() });
  return data;
}

function filterAndSort(items) {
  // 1) mantém itens com data de hoje/ontem
  // 2) mantém também itens SEM data (para não “sumirem”)
  const kept = items.filter((it) => {
    if (!it || !it.title || !it.url) return false;
    if (!it.publishedAt) return true;        // ✅ mantém sem data
    return withinLastTwoDays(it.publishedAt); // ✅ mantém hoje/ontem
  });

  // Ordena: com data mais recentes primeiro; sem data ficam por último
  kept.sort((a, b) => {
    const va = a.publishedAt ? dayjs(a.publishedAt).valueOf() : 0;
    const vb = b.publishedAt ? dayjs(b.publishedAt).valueOf() : 0;
    return vb - va;
  });

  return kept;
}


const app = express();
app.use(cors());

// Health
app.get("/", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// Aggregate endpoint (tolerante a falhas por fonte)
app.get("/api/news", async (req, res) => {
  const { sources, force } = req.query;
  const only = sources ? String(sources).split(",").map((s) => s.trim()) : null;
  const selected = only ? SOURCES.filter((s) => only.includes(s.key)) : SOURCES;

  try {
    const tasks = selected.map((s) => (force ? getSourceDataForce(s) : getSourceData(s)));
    const settled = await Promise.allSettled(tasks);

    const now = dayjs().tz(DEFAULT_TZ);
    const payload = {
      tz: DEFAULT_TZ,
      generatedAt: now.toISOString(),
      sources: selected.map((s, i) => {
        const r = settled[i];
        const items = r.status === "fulfilled" ? r.value : [];
        const error = r.status === "rejected" ? (r.reason?.message || String(r.reason)) : null;
        if (error) console.error(`[${s.key}]`, error);
        return {
          key: s.key,
          name: s.name,
          color: s.color,
          items: filterAndSort(items).map((it) => ({
            title: it.title,
            url: it.url,
            image: it.image,
            publishedAt: it.publishedAt,
          })),
          error, // opcional: o front pode exibir aviso na aba
        };
      }),
    };

    res.json(payload); // entregamos o que deu certo
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ====================== CLIENTE ESTÁTICO ====================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, "../client/dist");

app.use(express.static(clientDist));

// Catch-all depois das rotas de API
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

