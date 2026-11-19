import type { AgentUsage, Settings, TokenTotals } from '../../../shared/types'
import { getLocale, t } from '../../../shared/i18n'

/** 950 → "950", 12 345 → "12k", 1 234 567 → "1.2M" (decimal separator of the current language) */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  const millions = (n / 1_000_000).toLocaleString(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false
  })
  return `${millions}M`
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
 * Estimated cost in USD from the prices in the settings (per million tokens).
 * Cache reads count at 10 %, cache writes at 125 % of the input price. null = no prices.
 */
export function costOf(
  totals: TokenTotals,
  s: Pick<Settings, 'priceInput' | 'priceOutput'>
): number | null {
  if (!s.priceInput && !s.priceOutput) return null
  const input = totals.input + totals.cacheRead * 0.1 + totals.cacheWrite * 1.25
  return (input * s.priceInput + totals.output * s.priceOutput) / 1_000_000
}

/** "1,23 $" (German) / "$1.23" (English) */
export const formatCost = (usd: number): string =>
  t('format.cost', {
    amount: usd.toLocaleString(getLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  })

/** "Context 84k tokens · total output 12k" for tooltips */
export function usageLine(
  usage: AgentUsage | undefined,
  s: Pick<Settings, 'priceInput' | 'priceOutput'>
): string {
  if (!usage) return ''
  const cost = costOf(usage.total, s)
  return (
    t('format.usageSummary', {
      context: formatTokens(usage.context),
      output: formatTokens(usage.total.output)
    }) +
    (cost !== null ? ` · ≈ ${formatCost(cost)}` : '') +
    (usage.model ? `\n${t('format.usageModel', { model: usage.model })}` : '')
  )
}

/** `YYYY-MM-DD` in local time (as in main) */
export function localDay(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

export const timeOf = (at: number): string =>
  new Date(at).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })

export const dateTimeOf = (at: number): string =>
  new Date(at).toLocaleString(getLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** Placeholders `{{name}}` of a prompt in order of appearance (without duplicates) */
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
