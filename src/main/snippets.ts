import { open } from 'fs/promises'
import type { CodeSnippet } from '../shared/types'

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

/**
 * Liest ein Transkript inkrementell (ab der zuletzt gelesenen Stelle, nur vollständige Zeilen).
 * Beim ersten Lesen wird die ganze Datei ausgewertet – nach einer Wiederherstellung sind so auch
 * die Snippets der früheren Sitzung wieder da.
 */
export class TranscriptReader {
  private offset = 0
  private queue: Promise<CodeSnippet[]> = Promise.resolve([])

  constructor(
    readonly path: string,
    private agentId: string
  ) {}

  /** Neue Snippets seit dem letzten Aufruf (Aufrufe laufen nacheinander). */
  read(): Promise<CodeSnippet[]> {
    this.queue = this.queue.then(
      () => this.readNew(),
      () => this.readNew()
    )
    return this.queue
  }

  private async readNew(): Promise<CodeSnippet[]> {
    const file = await open(this.path, 'r')
    try {
      const { size } = await file.stat()
      if (size < this.offset) this.offset = 0 // Datei neu geschrieben
      if (size === this.offset) return []
      const buf = Buffer.alloc(size - this.offset)
      await file.read(buf, 0, buf.length, this.offset)
      const lastNewline = buf.lastIndexOf(0x0a)
      if (lastNewline < 0) return []
      this.offset += lastNewline + 1
      const lines = buf.subarray(0, lastNewline).toString('utf8').split('\n')
      return snippetsFromLines(this.agentId, lines)
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
