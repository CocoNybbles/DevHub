import { existsSync, readdirSync } from 'fs'
import { open, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import type { SessionMatch } from '../shared/types'
import { t } from '../shared/i18n'

/** Transcripts live under ~/.claude/projects/<folder>/<sessionId>.jsonl */
const transcriptsDir = (): string =>
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')

/** Path of a session's transcript (null = none exists → not resumable) */
export function findSessionFile(sessionId: string): string | null {
  const base = transcriptsDir()
  try {
    for (const dir of readdirSync(base)) {
      const file = join(base, dir, `${sessionId}.jsonl`)
      if (existsSync(file)) return file
    }
  } catch {
    // folder missing
  }
  return null
}

/** Session in a transcript on disk (for "Resume session …") */
export interface TranscriptInfo {
  sessionId: string
  /** Working directory the session ran in (from the transcript) */
  cwd: string
  /** Name set with `/rename`, otherwise claude's generated title */
  title?: string
  firstPrompt?: string
  lastPrompt?: string
  /** Session of a DevHub team member (it had the team tools) */
  team?: boolean
  updatedAt: number
  size: number
}

/** List at most this many sessions (the most recently changed) */
const MAX_LOCAL_SESSIONS = 100
/** cwd + first instruction are at the beginning of a transcript … */
const HEAD_BYTES = 64 * 1024
/** … titles are appended again and again, the latest ones are at the end */
const TAIL_BYTES = 256 * 1024

/** MCP tool DevHub gives only to team members (server name "devhub" in the agent's mcp.json) */
const TEAM_TOOL = 'mcp__devhub__send_team_message'

/** claude's folder name for a working directory: every non-alphanumeric character → "-" */
const normalize = (path: string): string => resolve(path).replace(/[\\/]+$/, '')
const encodeDir = (path: string): string => normalize(path).replace(/[^a-zA-Z0-9]/g, '-')
const samePath = (a: string, b: string): boolean =>
  normalize(a).toLowerCase() === normalize(b).toLowerCase()

/**
 * Sessions on disk that ran in one of the directories `cwds` (newest first). The transcript
 * folder is matched by its encoded name and confirmed by the `cwd` recorded in the transcript
 * (the encoding is ambiguous: `a-b` and `a\b` give the same name). Sessions without a single
 * instruction cannot be resumed and are left out.
 */
export async function listLocalSessions(cwds: string[]): Promise<TranscriptInfo[]> {
  const base = transcriptsDir()
  const wanted = cwds.map((c) => encodeDir(c).toLowerCase())
  let dirs: string[]
  try {
    dirs = readdirSync(base).filter((d) => {
      const name = d.toLowerCase()
      // Very long paths: claude may shorten the folder name
      return wanted.some((w) => name === w || (w.length > 200 && name.startsWith(w.slice(0, 200))))
    })
  } catch {
    return []
  }
  const files: { file: string; sessionId: string; updatedAt: number; size: number }[] = []
  for (const dir of dirs) {
    let names: string[]
    try {
      names = readdirSync(join(base, dir))
    } catch {
      continue
    }
    for (const name of names) {
      const m = /^([0-9a-f-]{36})\.jsonl$/i.exec(name)
      if (!m) continue
      try {
        const s = await stat(join(base, dir, name))
        files.push({
          file: join(base, dir, name),
          sessionId: m[1],
          updatedAt: s.mtimeMs,
          size: s.size
        })
      } catch {
        // vanished in the meantime
      }
    }
  }
  files.sort((a, b) => b.updatedAt - a.updatedAt)
  const infos = await Promise.all(
    files
      .slice(0, MAX_LOCAL_SESSIONS)
      .map(async ({ file, ...f }): Promise<TranscriptInfo | null> => {
        const info = await readTranscriptInfo(file, f.size).catch(() => null)
        if (!info?.cwd || !cwds.some((c) => samePath(c, info.cwd!))) return null
        if (!info.firstPrompt && !info.title) return null
        return { ...f, ...info, cwd: info.cwd }
      })
  )
  return infos.filter((x) => x !== null)
}

interface InfoLine {
  type?: string
  cwd?: string
  isMeta?: boolean
  isSidechain?: boolean
  customTitle?: string
  aiTitle?: string
  lastPrompt?: string
  message?: { content?: string | { type?: string; text?: string }[] }
}

async function readTranscriptInfo(
  file: string,
  size: number
): Promise<
  Pick<TranscriptInfo, 'title' | 'firstPrompt' | 'lastPrompt' | 'team'> & { cwd?: string }
> {
  const handle = await open(file, 'r')
  try {
    const read = async (from: number, length: number): Promise<string[]> => {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buf, 0, length, from)
      return buf.toString('utf8', 0, bytesRead).split('\n')
    }
    const parse = (raw: string): InfoLine | null => {
      try {
        return JSON.parse(raw)
      } catch {
        return null // cut-off line at the edge of the read window
      }
    }
    let cwd: string | undefined
    let firstPrompt: string | undefined
    const head = await read(0, Math.min(size, HEAD_BYTES))
    // The agent's MCP tools are listed at the start; only team members have the team tools
    const team = head.some((raw) => raw.includes(TEAM_TOOL))
    for (const raw of head) {
      if (cwd && firstPrompt) break
      if (!raw.includes('"cwd"') && !raw.includes('"user"')) continue
      const line = parse(raw)
      if (!line) continue
      if (!cwd && typeof line.cwd === 'string') cwd = line.cwd
      if (!firstPrompt && line.type === 'user' && !line.isMeta && !line.isSidechain) {
        const text = textOf(line.message?.content).trim()
        // Command wrappers (<command-name> …) and tool results are not an instruction
        if (text && !text.startsWith('<')) firstPrompt = text.slice(0, 200)
      }
    }
    let customTitle: string | undefined
    let aiTitle: string | undefined
    let lastPrompt: string | undefined
    const tailFrom = Math.max(0, size - TAIL_BYTES)
    for (const raw of await read(tailFrom, size - tailFrom)) {
      if (!raw.startsWith('{"type":"')) continue
      const line = parse(raw)
      if (line?.type === 'custom-title' && line.customTitle) customTitle = line.customTitle
      else if (line?.type === 'ai-title' && line.aiTitle) aiTitle = line.aiTitle
      else if (line?.type === 'last-prompt' && line.lastPrompt) lastPrompt = line.lastPrompt
    }
    return {
      cwd,
      title: (customTitle ?? aiTitle)?.slice(0, 200),
      firstPrompt,
      team,
      lastPrompt: lastPrompt?.slice(0, 200)
    }
  } finally {
    await handle.close()
  }
}

type Content = string | { type?: string; text?: string }[] | undefined

/** Text of a message (string or text blocks) */
function textOf(content: Content): string {
  if (typeof content === 'string') return content
  return (content ?? [])
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n')
}

/** Larger transcripts are skipped by the search */
const MAX_SEARCH_BYTES = 60_000_000
const MAX_EXCERPTS = 3
const EXCERPT_RADIUS = 90

export interface SearchableSession {
  sessionId: string
  name: string
  projectId: string
  agentId?: string
  archivedId?: string
}

interface Line {
  type?: string
  isMeta?: boolean
  message?: { content?: string | { type?: string; text?: string }[] }
}

/** Full-text search (case-insensitive) in the sessions' instructions and replies. */
export async function searchSessions(
  sessions: SearchableSession[],
  query: string
): Promise<SessionMatch[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const matches: SessionMatch[] = []
  for (const s of sessions) {
    const file = findSessionFile(s.sessionId)
    if (!file) continue
    try {
      if ((await stat(file)).size > MAX_SEARCH_BYTES) continue
      const excerpts: string[] = []
      for (const raw of (await readFile(file, 'utf8')).split('\n')) {
        // Pre-filter on the raw line before JSON is parsed
        if (!raw.toLowerCase().includes(needle)) continue
        let line: Line
        try {
          line = JSON.parse(raw)
        } catch {
          continue
        }
        if ((line.type !== 'user' && line.type !== 'assistant') || line.isMeta) continue
        const text = textOf(line.message?.content)
        const at = text.toLowerCase().indexOf(needle)
        if (at < 0) continue
        const from = Math.max(0, at - EXCERPT_RADIUS)
        const to = Math.min(text.length, at + needle.length + EXCERPT_RADIUS)
        excerpts.push(
          `${line.type === 'user' ? t('backend.searchYou') : s.name}: ${from > 0 ? '…' : ''}${text
            .slice(from, to)
            .replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`
        )
        if (excerpts.length >= MAX_EXCERPTS) break
      }
      if (excerpts.length) matches.push({ ...s, excerpts })
    } catch {
      // not readable → skip
    }
  }
  return matches
}
