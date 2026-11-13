import { open } from 'fs/promises'
import type { CodeSnippet, EditedFile, LineRange } from '../shared/types'

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
}

const NOTHING: TranscriptNews = { snippets: [], edits: [] }

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
      if (size < this.offset) this.offset = 0 // Datei neu geschrieben
      if (size === this.offset) return NOTHING
      const buf = Buffer.alloc(size - this.offset)
      await file.read(buf, 0, buf.length, this.offset)
      const lastNewline = buf.lastIndexOf(0x0a)
      if (lastNewline < 0) return NOTHING
      this.offset += lastNewline + 1
      const lines = buf.subarray(0, lastNewline).toString('utf8').split('\n')
      return {
        snippets: snippetsFromLines(this.agentId, lines),
        edits: editsFromLines(this.agentId, lines)
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
