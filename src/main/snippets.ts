import { open } from 'fs/promises'
import type { AgentUsage, CodeSnippet, EditedFile, LineRange, TokenTotals } from '../shared/types'

/** Höchstens so viele Snippets pro Agent behalten (die neuesten) */
export const MAX_SNIPPETS = 30

/** Code-Blöcke (```lang … ``` bzw. ~~~) aus Markdown-Text. */
export function extractCodeBlocks(markdown: string): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = []
  // Öffnender Zaun (mind. 3 ` oder ~, optional eingerückt), Sprache, Inhalt, gleicher Zaun
  const re = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/gm
  for (const m of markdown.matchAll(re)) {
    const indent = m[1].length
    // Einrückung des Zauns (z. B. in Listen) auch vom Inhalt entfernen
    const code = m[4]
      .split('\n')
      .map((line) => line.replace(new RegExp(`^[ \\t]{0,${indent}}`), ''))
      .join('\n')
      .replace(/\s+$/, '')
    if (code.trim()) blocks.push({ language: m[3].toLowerCase(), code })
  }
  return blocks
}

interface TranscriptEntry {
  type?: string
  uuid?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { content?: string | { type?: string; text?: string }[] }
}

/** Snippets aus JSONL-Zeilen des Claude-Code-Transkripts (nur Antworttext des Agents selbst). */
export function snippetsFromLines(agentId: string, lines: string[]): CodeSnippet[] {
  const out: CodeSnippet[] = []
  for (const line of lines) {
    // Schneller Vorfilter, bevor JSON geparst wird (Transkripte können groß sein)
    if (!line.includes('"assistant"') || !(line.includes('```') || line.includes('~~~'))) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    // Subagents (isSidechain) schreiben nicht für den Nutzer
    if (entry.type !== 'assistant' || entry.isSidechain || !entry.uuid) continue
    const content = entry.message?.content
    const texts =
      typeof content === 'string'
        ? [content]
        : (content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text!)
    const at = entry.timestamp ? Date.parse(entry.timestamp) || Date.now() : Date.now()
    let n = 0
    for (const text of texts) {
      for (const b of extractCodeBlocks(text)) {
        out.push({ id: `${entry.uuid}-${n++}`, agentId, language: b.language, code: b.code, at })
      }
    }
  }
  return out
}

export interface TranscriptNews {
  snippets: CodeSnippet[]
  edits: EditedFile[]
  /** Verbrauch der ganzen Sitzung – nur gesetzt, wenn er sich geändert hat */
  usage?: AgentUsage
  /** Anfang der letzten Antwort des Agents – nur gesetzt, wenn es eine neue gibt */
  lastText?: string
  /** Erste Anweisung des Nutzers (Titel der Sitzung) */
  firstPrompt?: string
}

const NOTHING: TranscriptNews = { snippets: [], edits: [] }

const zeroTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

function addTotals(to: TokenTotals, t: TokenTotals, sign = 1): void {
  to.input += sign * t.input
  to.output += sign * t.output
  to.cacheRead += sign * t.cacheRead
  to.cacheWrite += sign * t.cacheWrite
}

/** `YYYY-MM-DD` in lokaler Zeit */
export function localDay(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

interface UsageLine {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  timestamp?: string
  message?: {
    id?: string
    model?: string
    content?: string | { type?: string; text?: string }[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

const textOf = (content: NonNullable<UsageLine['message']>['content']): string =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n')

/** Länge der gemerkten letzten Antwort */
const LAST_TEXT_CHARS = 1500

/**
 * Token-Verbrauch, letzte Antwort und erste Anweisung aus Transkript-Zeilen. Eine Antwort steht
 * mit derselben `message.id` in mehreren Zeilen (je Inhaltsblock) – gezählt wird sie einmal.
 */
export class UsageTracker {
  private byMessage = new Map<string, { day: string; totals: TokenTotals }>()
  readonly usage: AgentUsage = { context: 0, total: zeroTotals(), byDay: {} }
  lastText?: string
  firstPrompt?: string

  /** Liefert, was sich geändert hat */
  add(lines: string[]): { usage: boolean; lastText: boolean } {
    const changed = { usage: false, lastText: false }
    for (const line of lines) {
      const assistant = line.includes('"assistant"')
      if (!assistant && (this.firstPrompt !== undefined || !line.includes('"user"'))) continue
      let entry: UsageLine
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (entry.type === 'user') {
        if (this.firstPrompt === undefined && !entry.isMeta && !entry.isSidechain) {
          const text = textOf(entry.message?.content).trim()
          // Befehls-Hüllen (<command-name> …) und Tool-Ergebnisse sind keine Anweisung
          if (text && !text.startsWith('<')) this.firstPrompt = text.slice(0, 200)
        }
        continue
      }
      if (entry.type !== 'assistant' || !entry.message) continue
      const text = textOf(entry.message.content).trim()
      if (text && !entry.isSidechain) {
        this.lastText = text.slice(0, LAST_TEXT_CHARS)
        changed.lastText = true
      }
      const u = entry.message.usage
      const id = entry.message.id
      if (!u || !id) continue
      const totals: TokenTotals = {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0
      }
      const day = localDay(entry.timestamp ? Date.parse(entry.timestamp) || Date.now() : Date.now())
      const before = this.byMessage.get(id)
      if (before) {
        addTotals(this.usage.total, before.totals, -1)
        addTotals((this.usage.byDay[before.day] ??= zeroTotals()), before.totals, -1)
      }
      this.byMessage.set(id, { day, totals })
      addTotals(this.usage.total, totals)
      addTotals((this.usage.byDay[day] ??= zeroTotals()), totals)
      if (!entry.isSidechain) {
        this.usage.context = totals.input + totals.cacheRead + totals.cacheWrite
        if (entry.message.model) this.usage.model = entry.message.model
      }
      changed.usage = true
    }
    return changed
  }
}

/** Höchstens so viele bearbeitete Dateien pro Agent behalten (die zuletzt geänderten) */
export const MAX_EDITED_FILES = 30

interface PatchHunk {
  newStart?: number
  lines?: string[]
}

/** Geänderte Zeilen (neue Zählung) aus einem `structuredPatch`; Löschungen markieren die Folgezeile. */
export function changedRanges(patch: PatchHunk[]): LineRange[] {
  const lines = new Set<number>()
  for (const hunk of patch) {
    let n = hunk.newStart ?? 1
    for (const line of hunk.lines ?? []) {
      const c = line[0]
      if (c === '+') lines.add(n++)
      else if (c === '-') lines.add(Math.max(1, n))
      else if (c !== '\\') n++ // „\ No newline at end of file“ zählt nicht
    }
  }
  const ranges: LineRange[] = []
  for (const l of [...lines].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1]
    if (last && l <= last.end + 1) last.end = Math.max(last.end, l)
    else ranges.push({ start: l, end: l })
  }
  return ranges
}

/**
 * Dateiänderung aus dem Ergebnis eines Edit/Write/MultiEdit-Aufrufs – `tool_response` im
 * PostToolUse-Hook bzw. `toolUseResult` im Transkript (gleiches Format: `filePath` + `structuredPatch`).
 */
export function editFromToolResult(
  agentId: string,
  result: unknown,
  at: number
): EditedFile | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { filePath?: unknown; structuredPatch?: unknown; type?: unknown }
  if (typeof r.filePath !== 'string' || !Array.isArray(r.structuredPatch)) return null
  return {
    agentId,
    filePath: r.filePath,
    at,
    changedLines: changedRanges(r.structuredPatch as PatchHunk[]),
    created: r.type === 'create' || undefined
  }
}

/** Dateiänderungen aus JSONL-Zeilen des Transkripts (Tool-Ergebnisse in `user`-Einträgen). */
export function editsFromLines(agentId: string, lines: string[]): EditedFile[] {
  const out: EditedFile[] = []
  for (const line of lines) {
    if (!line.includes('"structuredPatch"')) continue
    let entry: { type?: string; timestamp?: string; toolUseResult?: unknown }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'user') continue
    const at = entry.timestamp ? Date.parse(entry.timestamp) || Date.now() : Date.now()
    const edit = editFromToolResult(agentId, entry.toolUseResult, at)
    if (edit) out.push(edit)
  }
  return out
}

/**
 * Bearbeitete Dateien zusammenführen: gleiche Datei (ohne Groß-/Kleinschreibung) behält ihren Platz
 * und übernimmt die neuere Änderung; neue Dateien hinten. Begrenzt auf die zuletzt geänderten.
 */
export function mergeEdits(existing: EditedFile[], added: EditedFile[]): EditedFile[] {
  const list = [...existing]
  for (const e of added) {
    const i = list.findIndex((x) => x.filePath.toLowerCase() === e.filePath.toLowerCase())
    if (i < 0) list.push(e)
    else if (e.at >= list[i].at) list[i] = e
  }
  if (list.length <= MAX_EDITED_FILES) return list
  const keep = new Set([...list].sort((a, b) => b.at - a.at).slice(0, MAX_EDITED_FILES))
  return list.filter((e) => keep.has(e))
}

/**
 * Liest ein Transkript inkrementell (ab der zuletzt gelesenen Stelle, nur vollständige Zeilen).
 * Beim ersten Lesen wird die ganze Datei ausgewertet – nach einer Wiederherstellung sind so auch
 * die Snippets der früheren Sitzung wieder da.
 */
export class TranscriptReader {
  private offset = 0
  private queue: Promise<TranscriptNews> = Promise.resolve(NOTHING)
  private tracker = new UsageTracker()

  constructor(
    readonly path: string,
    private agentId: string
  ) {}

  /** Neue Snippets/Dateiänderungen seit dem letzten Aufruf (Aufrufe laufen nacheinander). */
  read(): Promise<TranscriptNews> {
    this.queue = this.queue.then(
      () => this.readNew(),
      () => this.readNew()
    )
    return this.queue
  }

  private async readNew(): Promise<TranscriptNews> {
    // Bei SessionStart eines neuen Agents gibt es das Transkript noch nicht
    const file = await open(this.path, 'r').catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (!file) return NOTHING
    try {
      const { size } = await file.stat()
      if (size < this.offset) {
        // Datei neu geschrieben
        this.offset = 0
        this.tracker = new UsageTracker()
      }
      if (size === this.offset) return NOTHING
      const buf = Buffer.alloc(size - this.offset)
      await file.read(buf, 0, buf.length, this.offset)
      const lastNewline = buf.lastIndexOf(0x0a)
      if (lastNewline < 0) return NOTHING
      this.offset += lastNewline + 1
      const lines = buf.subarray(0, lastNewline).toString('utf8').split('\n')
      const changed = this.tracker.add(lines)
      return {
        snippets: snippetsFromLines(this.agentId, lines),
        edits: editsFromLines(this.agentId, lines),
        usage: changed.usage ? structuredClone(this.tracker.usage) : undefined,
        lastText: changed.lastText ? this.tracker.lastText : undefined,
        firstPrompt: this.tracker.firstPrompt
      }
    } finally {
      await file.close()
    }
  }
}

/** Neue Snippets einsortieren: neueste zuerst, gleicher Code nur einmal (der neueste), begrenzt. */
export function mergeSnippets(existing: CodeSnippet[], added: CodeSnippet[]): CodeSnippet[] {
  // Neueste Antwort zuerst, innerhalb einer Antwort die Reihenfolge des Textes behalten
  const newest = added
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.at - a.s.at || a.i - b.i)
    .map((x) => x.s)
  const all = newest.concat(existing)
  const seen = new Set<string>()
  return all
    .filter((s) => {
      const key = s.code.trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_SNIPPETS)
}
