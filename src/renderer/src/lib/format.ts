import type { AgentUsage, Settings, TokenTotals } from '../../../shared/types'

/** 950 → „950“, 12 345 → „12k“, 1 234 567 → „1,2M“ */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

export const zeroTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export function addTotals(a: TokenTotals, b: TokenTotals | undefined): TokenTotals {
  if (!b) return a
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite
  }
}

/**
 * Geschätzte Kosten in USD aus den Preisen der Einstellungen (je Million Tokens).
 * Cache-Lesen zählt mit 10 %, Cache-Schreiben mit 125 % des Eingabepreises. null = keine Preise.
 */
export function costOf(
  t: TokenTotals,
  s: Pick<Settings, 'priceInput' | 'priceOutput'>
): number | null {
  if (!s.priceInput && !s.priceOutput) return null
  const input = t.input + t.cacheRead * 0.1 + t.cacheWrite * 1.25
  return (input * s.priceInput + t.output * s.priceOutput) / 1_000_000
}

export const formatCost = (usd: number): string =>
  `${usd.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`

/** „Kontext 84k · heute 12k aus“ für Tooltips */
export function usageLine(
  usage: AgentUsage | undefined,
  s: Pick<Settings, 'priceInput' | 'priceOutput'>
): string {
  if (!usage) return ''
  const cost = costOf(usage.total, s)
  return (
    `Kontext ${formatTokens(usage.context)} Tokens · Ausgabe gesamt ${formatTokens(usage.total.output)}` +
    (cost !== null ? ` · ≈ ${formatCost(cost)}` : '') +
    (usage.model ? `\nModell: ${usage.model}` : '')
  )
}

/** `YYYY-MM-DD` in lokaler Zeit (wie im Main) */
export function localDay(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

export const timeOf = (at: number): string =>
  new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

export const dateTimeOf = (at: number): string =>
  new Date(at).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Platzhalter `{{name}}` eines Prompts in der Reihenfolge ihres Auftretens (ohne Doppelte) */
export function placeholdersOf(text: string): string[] {
  const names: string[] = []
  for (const m of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => values[name] ?? '')
}
