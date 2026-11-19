import { open } from 'fs/promises'
import type { AgentUsage, CodeSnippet, EditedFile, LineRange, TokenTotals } from '../shared/types'

/** Keep at most this many snippets per agent (the newest) */
export const MAX_SNIPPETS = 30

/** Code blocks (```lang … ``` or ~~~) from Markdown text. */
export function extractCodeBlocks(markdown: string): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = []
  // Opening fence (at least 3 ` or ~, optionally indented), language, content, same fence
  const re = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/gm
  for (const m of markdown.matchAll(re)) {
    const indent = m[1].length
    // Also strip the fence's indentation (e.g. in lists) from the content
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

/** Snippets from JSONL lines of the Claude Code transcript (only the agent's own reply text). */
export function snippetsFromLines(agentId: string, lines: string[]): CodeSnippet[] {
  const out: CodeSnippet[] = []
  for (const line of lines) {
    // Quick pre-filter before parsing JSON (transcripts can be large)
    if (!line.includes('"assistant"') || !(line.includes('```') || line.includes('~~~'))) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    // Subagents (isSidechain) don't write for the user
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
  /** Usage of the whole session – only set if it has changed */
  usage?: AgentUsage
  /** Beginning of the agent's last response – only set if there is a new one */
  lastText?: string
  /** The user's first instruction (title of the session) */
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

/** `YYYY-MM-DD` in local time */
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

/** Length of the remembered last response */
const LAST_TEXT_CHARS = 1500

/**
 * Token usage, last response and first instruction from transcript lines. A response appears
 * with the same `message.id` in several lines (one per content block) – it is counted once.
 */
export class UsageTracker {
  private byMessage = new Map<string, { day: string; totals: TokenTotals }>()
  readonly usage: AgentUsage = { context: 0, total: zeroTotals(), byDay: {} }
  lastText?: string
  firstPrompt?: string

  /** Returns what has changed */
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
          // Command wrappers (<command-name> …) and tool results are not an instruction
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

/** Keep at most this many edited files per agent (the most recently changed) */
export const MAX_EDITED_FILES = 30

interface PatchHunk {
  newStart?: number
  lines?: string[]
}

/** Changed lines (new numbering) from a `structuredPatch`; deletions mark the following line. */
export function changedRanges(patch: PatchHunk[]): LineRange[] {
  const lines = new Set<number>()
  for (const hunk of patch) {
    let n = hunk.newStart ?? 1
    for (const line of hunk.lines ?? []) {
      const c = line[0]
      if (c === '+') lines.add(n++)
      else if (c === '-') lines.add(Math.max(1, n))
      else if (c !== '\\') n++ // "\ No newline at end of file" doesn't count
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
 * File change from the result of an Edit/Write/MultiEdit call – `tool_response` in the
 * PostToolUse hook or `toolUseResult` in the transcript (same format: `filePath` + `structuredPatch`).
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

/** File changes from JSONL lines of the transcript (tool results in `user` entries). */
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
 * Merges edited files: the same file (case-insensitive) keeps its position and takes the
 * newer change; new files go at the end. Limited to the most recently changed.
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
 * Reads a transcript incrementally (from the last read position, complete lines only).
 * The first read processes the whole file – so after a restore the snippets of the
 * previous session are back too.
 */
export class TranscriptReader {
  private offset = 0
  private queue: Promise<TranscriptNews> = Promise.resolve(NOTHING)
  private tracker = new UsageTracker()

  constructor(
    readonly path: string,
    private agentId: string
  ) {}

  /** New snippets/file changes since the last call (calls run sequentially). */
  read(): Promise<TranscriptNews> {
    this.queue = this.queue.then(
      () => this.readNew(),
      () => this.readNew()
    )
    return this.queue
  }

  private async readNew(): Promise<TranscriptNews> {
    // On SessionStart of a new agent the transcript doesn't exist yet
    const file = await open(this.path, 'r').catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (!file) return NOTHING
    try {
      const { size } = await file.stat()
      if (size < this.offset) {
        // File was rewritten
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

/** Inserts new snippets: newest first, identical code only once (the newest), capped. */
export function mergeSnippets(existing: CodeSnippet[], added: CodeSnippet[]): CodeSnippet[] {
  // Newest reply first; within a reply keep the order of the text
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
