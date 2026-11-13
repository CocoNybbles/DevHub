import { existsSync, readdirSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { SessionMatch } from '../shared/types'

/** Transkripte liegen unter ~/.claude/projects/<ordner>/<sessionId>.jsonl */
const transcriptsDir = (): string =>
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')

/** Pfad des Transkripts einer Session (null = keins vorhanden → nicht fortsetzbar) */
export function findSessionFile(sessionId: string): string | null {
  const base = transcriptsDir()
  try {
    for (const dir of readdirSync(base)) {
      const file = join(base, dir, `${sessionId}.jsonl`)
      if (existsSync(file)) return file
    }
  } catch {
    // Ordner fehlt
  }
  return null
}

/** Größere Transkripte werden bei der Suche übersprungen */
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

/** Volltextsuche (ohne Groß-/Kleinschreibung) in Anweisungen und Antworten der Sitzungen. */
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
        // Vorfilter auf der Rohzeile, bevor JSON geparst wird
        if (!raw.toLowerCase().includes(needle)) continue
        let line: Line
        try {
          line = JSON.parse(raw)
        } catch {
          continue
        }
        if ((line.type !== 'user' && line.type !== 'assistant') || line.isMeta) continue
        const content = line.message?.content
        const text =
          typeof content === 'string'
            ? content
            : (content ?? [])
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text)
                .join('\n')
        const at = text.toLowerCase().indexOf(needle)
        if (at < 0) continue
        const from = Math.max(0, at - EXCERPT_RADIUS)
        const to = Math.min(text.length, at + needle.length + EXCERPT_RADIUS)
        excerpts.push(
          `${line.type === 'user' ? 'Du' : s.name}: ${from > 0 ? '…' : ''}${text
            .slice(from, to)
            .replace(/\s+/g, ' ')}${to < text.length ? '…' : ''}`
        )
        if (excerpts.length >= MAX_EXCERPTS) break
      }
      if (excerpts.length) matches.push({ ...s, excerpts })
    } catch {
      // nicht lesbar → überspringen
    }
  }
  return matches
}
