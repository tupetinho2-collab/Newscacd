
import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

const SOURCE_COLORS = {
  'un_news_pt': '#1d4ed8',
  'mre_notas': '#16a34a',
  'unep_es': '#ef4444',
  'unfccc': '#0ea5e9',
  'relacoes_exteriores': '#9333ea',
  'mma': '#16a34a',
  'infobrics': '#ef4444',
  'ibge': '#1f2937',
  'mdic': '#1d4ed8',
  'govbr_meio_ambiente': '#0d9488',
  'eir': '#dc2626',
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1))
}

function formatPtBRDate(date) {
  const d = new Date(date)
  const formatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
  const parts = formatter.formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {})
  const day = parts.day
  const month = titleCase(parts.month)
  const year = parts.year
  const weekday = titleCase(parts.weekday)
  const hour = parts.hour && parts.minute ? ` – ${parts.hour}:${parts.minute}` : ''
  return `${day} de ${month} de ${year} – ${weekday}${hour}`
}

function formatHeaderToday() {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  const parts = formatter.formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {})
  return `${parts.day} de ${titleCase(parts.month)} de ${parts.year} – ${titleCase(parts.weekday)}`
}

function SourceTabs({ sources, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        className={`px-4 py-2 rounded-2xl font-semibold border transition hover:shadow ${active==='all'?'bg-brandBlue text-white':'bg-white text-brandBlue border-brandBlue'}`}
        onClick={() => onChange('all')}
      >
        Todas
      </button>
      {sources.map(s => (
        <button
          key={s.key}
          className="px-4 py-2 rounded-2xl font-semibold border transition hover:shadow"
          style={{ backgroundColor: active===s.key ? s.color : '#fff', color: active===s.key ? '#fff' : s.color, borderColor: s.color }}
          onClick={() => onChange(s.key)}
          title={s.name}
        >
          {s.name}
        </button>
      ))}
    </div>
  )
}

function NewsCard({ item, source }) {
  const srcColor = SOURCE_COLORS[source.key] || '#1d4ed8'
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-smooth overflow-hidden border"
      style={{ borderColor: srcColor + '33' }}
    >
      {item.image ? (
        <a href={item.url} target="_blank" rel="noreferrer">
          <img src={item.image} alt={item.title} className="w-full h-52 object-cover hover:scale-[1.02] transition-transform duration-700 ease-out" />
        </a>
      ) : (
        <div className="w-full h-52 bg-gray-100 flex items-center justify-center text-gray-400">Sem imagem</div>
      )}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="badge" style={{ backgroundColor: srcColor, color: '#fff' }}>{source.name}</span>
          {item.publishedAt && (
            <span className="badge" style={{ backgroundColor: '#f1f5f9', color: '#0f172a' }}>
              {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(item.publishedAt))}
            </span>
          )}
        </div>
        <h3 className="text-lg font-bold text-gray-900">{item.title}</h3>
        <div className="flex justify-between items-center">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block px-4 py-2 rounded-xl font-semibold"
            style={{ backgroundColor: srcColor, color: '#fff' }}
          >
            Ler mais
          </a>
        </div>
      </div>
    </motion.article>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [active, setActive] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const sources = useMemo(() => data?.sources ?? [], [data])

  async function load(force=false) {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/news${force ? '?force=true' : ''}`)
      if (!res.ok) throw new Error('Falha ao carregar')
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(false) }, [])

  const items = useMemo(() => {
    if (!data) return []
    if (active === 'all') {
      const merged = []
      for (const s of data.sources) {
        for (const it of s.items) merged.push({ ...it, __source: s })
      }
      // Already sorted in server, but let's sort again just in case
      return merged.sort((a,b)=> new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    }
    const s = data.sources.find(x => x.key === active)
    return (s?.items || []).map(it => ({ ...it, __source: s }))
  }, [data, active])

  return (
    <div>
      {/* HERO */}
      <header className="bg-hero-worldmap bg-cover bg-center">
        <div className="backdrop-blur-[1px]">
          <div className="max-w-6xl mx-auto px-4 py-12">
            <motion.h1
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl md:text-4xl font-black"
              style={{ color: '#1d4ed8' }}
            >
              Radar de Notícias
            </motion.h1>
            <p className="mt-2 text-gray-700 font-semibold">{formatHeaderToday()}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => load(true)}
                className="px-4 py-2 rounded-xl font-semibold shadow hover:shadow-smooth transition"
                style={{ backgroundColor: '#16a34a', color: '#fff' }}
              >
                Atualizar
              </button>
              <div className="text-sm text-gray-600">
                {data?.generatedAt ? `Atualizado: ${formatPtBRDate(data.generatedAt)}` : 'Carregando...'}
              </div>
            </div>

            <div className="mt-6">
              <SourceTabs sources={sources} active={active} onChange={setActive} />
            </div>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {loading && <div className="py-8 text-gray-600">Atualizando notícias…</div>}
        {error && <div className="py-8 text-red-600">{String(error)}</div>}
        {!loading && !error && (
          <motion.div layout className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, idx) => (
              <NewsCard key={it.url + idx} item={it} source={it.__source} />
            ))}
          </motion.div>
        )}
        {!loading && !error && items.length === 0 && (
          <div className="py-16 text-center text-gray-500">Sem notícias dos últimos 2 dias para esta fonte.</div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="py-10 text-center text-gray-500">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-center gap-3">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#1d4ed8' }}></span>
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#16a34a' }}></span>
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }}></span>
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb' }}></span>
          </div>
          <p className="mt-3 text-sm">Cores do site: azul, verde, vermelho e branco • Layout moderno e animado</p>
        </div>
      </footer>
    </div>
  )
}
