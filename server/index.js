
import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import cors from "cors";
import path from 'path';
import { fileURLToPath } from 'url';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(localizedFormat);
dayjs.extend(customParseFormat);

// We'll use America/Sao_Paulo as requested.
const DEFAULT_TZ = "America/Sao_Paulo";
const PORT = process.env.PORT || 4000;

// Utility: safe fetch with timeout
async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 20000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    const text = await res.text();
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWhitespace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Parse a date string robustly across pt/en/es websites.
// Try ISO attributes first. Fall back to locale-aware parsing.
// Returns an ISO string in the DEFAULT_TZ, or null.
function parseDateTime(raw, localeHint = "pt") {
  if (!raw) return null;

  // Try ISO first
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?)?/);
  if (isoMatch) {
    const d = dayjs.tz(isoMatch[0], DEFAULT_TZ);
    if (d.isValid()) return d.toISOString();
  }

  const cleaned = normalizeWhitespace(raw)
    .replace(/\|/g, " ")
    .replace(/Publicado em:?\s*/i, "")
    .replace(/Publicada em:?\s*/i, "")
    .replace(/Atualizado em:?\s*/i, "");

  const candidates = [
    // PT-BR
    { fmt: "D [de] MMMM [de] YYYY HH:mm", loc: "pt" },
    { fmt: "D [de] MMMM [de] YYYY", loc: "pt" },
    { fmt: "DD/MM/YYYY HH:mm", loc: "pt" },
    { fmt: "DD/MM/YYYY", loc: "pt" },
    { fmt: "D/M/YYYY", loc: "pt" },
    // ES
    { fmt: "D [de] MMMM [de] YYYY HH:mm", loc: "es" },
    { fmt: "D [de] MMMM [de] YYYY", loc: "es" },
    // EN
    { fmt: "D MMMM YYYY HH:mm", loc: "en" },
    { fmt: "D MMMM YYYY", loc: "en" },
    { fmt: "MMMM D, YYYY", loc: "en" },
    { fmt: "MMMM D, YYYY HH:mm", loc: "en" },
  ];

  for (const c of candidates) {
    const d = dayjs.tz(cleaned, c.fmt, c.loc, DEFAULT_TZ);
    if (d.isValid()) return d.toISOString();
  }

  // Try extracting day/month/year numbers (common on gov.br)
  const dmY = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{2}:\d{2}))?/);
  if (dmY) {
    const [_, dd, mm, yyyy, hhmm] = dmY;
    const s = `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}${hhmm? "T"+hhmm+":00" : "T12:00:00"}`;
    const d = dayjs.tz(s, DEFAULT_TZ);
    if (d.isValid()) return d.toISOString();
  }

  // No parse
  return null;
}

function withinLastTwoDays(iso, tz=DEFAULT_TZ) {
  if (!iso) return false;
  const now = dayjs().tz(tz);
  const startToday = now.startOf("day");
  const startYesterday = startToday.subtract(1, "day");
  const endToday = startToday.endOf("day");
  const d = dayjs.tz(iso, tz);
  return d.isAfter(startYesterday) && d.isBefore(endToday);
}

// Fetch OG tags from an article page as a fallback (image + published_time)
async function fetchArticleMeta(url) {
  try {
    const html = await safeFetch(url);
    const $ = cheerio.load(html);
    const ogImage = $('meta[property="og:image"]').attr("content") || $('meta[name="twitter:image"]').attr("content") || null;
    const ogTime = $('meta[property="article:published_time"]').attr("content") ||
                   $('meta[name="date"]').attr("content") ||
                   $('time[datetime]').attr("datetime") ||
                   null;
    const publishedAt = parseDateTime(ogTime) || null;
    return { ogImage, publishedAt };
  } catch (e) {
    return { ogImage: null, publishedAt: null };
  }
}

async function scrapeUNNewsPT() {
  const url = "https://news.un.org/pt/news?page=0";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".view-content .views-row").each((i, el) => {
    const title = normalizeWhitespace($(el).find("h2 a").text());
    const link = $(el).find("h2 a").attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".views-field-created .field-content").text();
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://news.un.org${link}`,
        image: img && (img.startsWith("http") ? img : `https://news.un.org${img}`),
        publishedAt
      });
    }
  });
  // Fallback: fetch OG for those missing image or date
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
  const url = "https://www.gov.br/mre/pt-br/canais_atendimento/imprensa/notas-a-imprensa";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".listagem .item, .tileListaNoticias .item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image: img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt
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
  const url = "https://www.unep.org/es/resources/filter/sort_by=publication_date/sort_order=desc/page=0";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".view-content .views-row, .search-result").each((_, el) => {
    const a = $(el).find("h3 a, h2 a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".date, .field--name-field-date").text();
    const publishedAt = parseDateTime(timeText, "es");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.unep.org${link}`,
        image: img && (img.startsWith("http") ? img : `https://www.unep.org${img}`),
        publishedAt
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
  $(".view-content .views-row, article, .news-listing .news-item").each((_, el) => {
    const a = $(el).find("h2 a, h3 a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".date").text();
    const publishedAt = parseDateTime(timeText, "en");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://unfccc.int${link}`,
        image: img && (img.startsWith("http") ? img : `https://unfccc.int${img}`),
        publishedAt
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

async function scrapeRelacoesExteriores() {
  const url = "https://relacoesexteriores.com.br/analises/artigo/";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $("article").each((_, el) => {
    const a = $(el).find("h2 a, .entry-title a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".posted-on").text();
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link,
        image: img,
        publishedAt
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

async function scrapeMMA() {
  const url = "https://www.gov.br/mma/pt-br/noticias";
  const html = await safeFetch(url);
  const $ = cheerio.load(html);
  const items = [];
  $(".listagem .item, .tileListaNoticias .item").each((_, el) => {
    const a = $(el).find("a").first();
    const title = normalizeWhitespace(a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image: img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt
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
    const title = normalizeWhitespace($(el).find("h3, h2").first().text() || a.text());
    const link = a.attr("href");
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find(".date, time").first().text() || $(el).find("time").attr("datetime");
    const publishedAt = parseDateTime(timeText, "en");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://infobrics.org${link}`,
        image: img && (img.startsWith("http") ? img : `https://infobrics.org${img}`),
        publishedAt
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
    const title = normalizeWhitespace(a.find(".titulo").text() || a.attr("title"));
    const link = a.attr("href");
    const img = a.find("img").attr("data-src") || a.find("img").attr("src");
    const timeText = a.find(".data-publicacao, time").text() || a.find("time").attr("datetime");
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://agenciadenoticias.ibge.gov.br${link}`,
        image: img && (img.startsWith("http") ? img : `https://agenciadenoticias.ibge.gov.br${img}`),
        publishedAt
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
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image: img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt
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
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".data, .data-publicacao").text();
    const publishedAt = parseDateTime(timeText, "pt");
    if (title && link) {
      items.push({
        title,
        url: link.startsWith("http") ? link : `https://www.gov.br${link}`,
        image: img && (img.startsWith("http") ? img : `https://www.gov.br${img}`),
        publishedAt
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
    const img = $(el).find("img").attr("src");
    const timeText = $(el).find("time").attr("datetime") || $(el).find(".posted-on").text();
    const publishedAt = parseDateTime(timeText, "en");
    if (title && link) {
      items.push({
        title,
        url: link,
        image: img,
        publishedAt
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

// Register sources
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

// Simple cache controlled by "force" query param
const cache = new Map(); // key -> { data, at }
const CACHE_MS = 1000 * 60 * 60; // 1 hour cache just in case (won't refresh unless asked)

async function getSourceData(src) {
  const key = src.key;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && (now - cached.at) < CACHE_MS) return cached.data;

  const data = await src.fetcher();
  cache.set(key, { data, at: now });
  return data;
}

async function getSourceDataForce(src) {
  const data = await src.fetcher();
  cache.set(src.key, { data, at: Date.now() });
  return data;
}

function filterAndSort(items) {
  const filtered = items.filter(it => withinLastTwoDays(it.publishedAt));
  filtered.sort((a, b) => {
    const da = dayjs(a.publishedAt || 0);
    const db = dayjs(b.publishedAt || 0);
    return db.valueOf() - da.valueOf();
  });
  return filtered;
}

const app = express();
app.use(cors());
app.get("/", (req, res) => {
  res.type("text/plain").send("News server up. Use /api/news");
});

// Aggregate endpoint
app.get("/api/news", async (req, res) => {
  const { sources, force } = req.query;
  const only = sources ? String(sources).split(",").map(s => s.trim()) : null;

  const selected = only ? SOURCES.filter(s => only.includes(s.key)) : SOURCES;

  try {
    const results = await Promise.all(selected.map(s => force ? getSourceDataForce(s) : getSourceData(s)));
    const now = dayjs().tz(DEFAULT_TZ);
    const payload = {
      tz: DEFAULT_TZ,
      generatedAt: now.toISOString(),
      sources: selected.map((s, i) => ({
        key: s.key,
        name: s.name,
        color: s.color,
        items: filterAndSort(results[i]).map(it => ({
          title: it.title,
          url: it.url,
          image: it.image,
          publishedAt: it.publishedAt
        }))
      })),
    };
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});


// ---- Static client (serve React build) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, "../client/dist");

app.use(express.static(clientDist));

// Keep API routes working; catch-all for client routes AFTER API
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"));
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
