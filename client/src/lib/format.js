
export function formatPtBRDate(date) {
  const d = new Date(date)
  const formatter = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
  return formatter.format(d)
}
