import { exec, spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { readdir } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'

/** Führt einen Shell-Befehl aus und liefert die erste Ausgabezeile (oder null bei Fehler). */
function firstLine(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null)
      const line = stdout
        .toString()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean)
      resolve(line ?? null)
    })
  })
}

let claudePath: Promise<string | null> | null = null

/**
 * Pfad zur Claude-CLI. Bevorzugt claude.exe (nativer Installer), damit Argumente
 * ohne Shell-Quoting übergeben werden können; sonst z. B. claude.cmd (npm).
 */
export function resolveClaude(): Promise<string | null> {
  claudePath ??= new Promise((resolve) => {
    exec('where claude', { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const lines = stdout
        .toString()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
      resolve(
        lines.find((l) => l.toLowerCase().endsWith('.exe')) ??
          lines.find((l) => l.toLowerCase().endsWith('.cmd')) ??
          null
      )
    })
  })
  return claudePath
}

/**
 * Umgebungsvariablen, die eine laufende Claude-Code-Session an Kindprozesse vererbt.
 * Wird DevHub aus einem Claude-Terminal gestartet, würden Agents sonst als "Kind-Session"
 * laufen (u. a. ohne Transkript → keine Wiederherstellung möglich).
 */
const INHERITED_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID'
]

/** Umgebung für gestartete Claude-Prozesse: ohne Session-Marker einer übergeordneten Claude-Instanz. */
export function claudeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !INHERITED_SESSION_VARS.includes(k.toUpperCase())) env[k] = v
  }
  return { ...env, ...extra }
}

let vscode: Promise<boolean> | null = null

export function isVSCodeInstalled(): Promise<boolean> {
  vscode ??= firstLine('where code').then((p) => p !== null)
  return vscode
}

/** Windows-Pfade dürfen kein " enthalten – Quoting mit " ist damit sicher. */
function quote(path: string): string {
  if (path.includes('"')) throw new Error('Ungültiger Pfad')
  return `"${path}"`
}

export function openInVSCode(path: string, line?: number): void {
  if (!existsSync(path)) throw new Error(`Pfad nicht gefunden: ${path}`)
  const cmd = line ? `code -g ${quote(`${path}:${line}`)}` : `code ${quote(path)}`
  exec(cmd, { windowsHide: true })
}

/** Prüft einen vom Nutzer angegebenen Programmpfad; liefert eine Fehlermeldung oder null. */
export function validateProgram(exe: string | undefined): string | null {
  if (!exe) return null
  if (!isAbsolute(exe)) return 'Programm: bitte den vollständigen Pfad angeben'
  if (!/\.(exe|cmd|bat)$/i.test(exe)) return 'Programm: muss eine .exe (oder .cmd/.bat) sein'
  if (!existsSync(exe)) return `Programm nicht gefunden: ${exe}`
  return null
}

/**
 * Öffnet eine Datei oder einen Ordner mit einem bestimmten Programm (losgelöst von DevHub, ohne
 * Konsolenfenster). Arbeitsverzeichnis = der Ordner selbst bzw. der Ordner der Datei.
 */
export function openWithProgram(exe: string, file: string): Promise<void> {
  const err = validateProgram(exe)
  if (err) return Promise.reject(new Error(err))
  const cwd = statSync(file).isDirectory() ? file : dirname(file)
  return new Promise((resolve, reject) => {
    // .cmd/.bat brauchen eine Shell; .exe direkt starten (keine Shell → keine Sonderzeichen-Probleme)
    const script = /\.(cmd|bat)$/i.test(exe)
    const child = script
      ? // cmd /s /c ""a b.cmd" "datei"": äußere Quotes werden entfernt, innere bleiben (Leerzeichen)
        spawn('cmd.exe', ['/d', '/s', '/c', `""${exe}" "${file}""`], {
          cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          windowsVerbatimArguments: true
        })
      : spawn(exe, [file], { cwd, detached: true, stdio: 'ignore' })
    child.once('error', (e) =>
      reject(new Error(`Programm konnte nicht gestartet werden: ${e.message}`))
    )
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * Woran ein Projektordner erkannt wird (Datei- bzw. Ordnernamen direkt darin).
 * Erster Treffer wird als Kennzeichen angezeigt.
 */
const PROJECT_MARKERS: { label: string; test: (name: string, isDir: boolean) => boolean }[] = [
  { label: 'Git', test: (n) => n === '.git' },
  { label: '.sln', test: (n, d) => !d && /\.slnx?$/i.test(n) },
  { label: '.NET', test: (n, d) => !d && /\.(cs|fs|vb|vcx)proj$/i.test(n) },
  { label: 'Node', test: (n, d) => !d && n === 'package.json' },
  { label: 'Python', test: (n, d) => !d && ['pyproject.toml', 'setup.py'].includes(n) },
  { label: 'Rust', test: (n, d) => !d && n === 'Cargo.toml' },
  { label: 'Go', test: (n, d) => !d && n === 'go.mod' },
  { label: 'Java', test: (n, d) => !d && /^(pom\.xml|build\.gradle(\.kts)?)$/.test(n) },
  { label: 'CMake', test: (n, d) => !d && n === 'CMakeLists.txt' },
  { label: 'Claude', test: (n, d) => !d && n === 'CLAUDE.md' }
]

/** Wie tief unter einem gewählten Ordner nach Projekten gesucht wird */
const PROJECT_SCAN_DEPTH = 3
const PROJECT_SCAN_LIMIT = 300

export interface FoundProject {
  path: string
  /** Kennzeichen, z. B. „Git“ oder „.sln“ */
  marker: string
}

/**
 * Sucht Projekte: Ein Ordner mit Projekt-Kennzeichen (Git, .sln, package.json …) ist ein Projekt
 * (darunter wird nicht weiter gesucht – Monorepos bleiben ein Projekt). Sonst werden seine
 * Unterordner durchsucht (bis PROJECT_SCAN_DEPTH Ebenen) – so liefert ein „Dev“-Ordner alle
 * Projekte darin.
 */
export async function findProjects(roots: string[]): Promise<FoundProject[]> {
  const found: FoundProject[] = []
  const seen = new Set<string>()
  const visit = async (dir: string, depth: number): Promise<void> => {
    const key = dir.toLowerCase()
    if (seen.has(key) || found.length >= PROJECT_SCAN_LIMIT) return
    seen.add(key)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // kein Zugriff o. Ä.
    }
    for (const m of PROJECT_MARKERS) {
      if (entries.some((e) => m.test(e.name, e.isDirectory()))) {
        found.push({ path: dir, marker: m.label })
        return
      }
    }
    if (depth >= PROJECT_SCAN_DEPTH) return
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()))
        await visit(join(dir, e.name), depth + 1)
    }
  }
  for (const root of roots) await visit(root, 0)
  return found
}

/** Ordner, die bei der Suche nach Projektmappen übersprungen werden. */
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'out', 'dist', 'build', 'packages'])

/**
 * Sucht im Ordner (und bis zu 3 Ebenen darunter) nach einer `.sln`/`.slnx`.
 * Bevorzugt die flachste Ebene, dort eine Datei mit dem Ordnernamen. null, wenn keine gefunden.
 */
export async function findSolution(root: string): Promise<string | null> {
  const wanted = basename(root.replace(/[\\/]+$/, '')).toLowerCase()
  let level = [root]
  for (let depth = 0; depth <= 3 && level.length > 0; depth++) {
    const next: string[] = []
    const found: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue // kein Zugriff o. Ä.
      }
      for (const e of entries) {
        if (e.isFile() && /\.slnx?$/i.test(e.name)) found.push(join(dir, e.name))
        else if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()))
          next.push(join(dir, e.name))
      }
    }
    if (found.length > 0) {
      const stem = (f: string): string =>
        basename(f)
          .replace(/\.slnx?$/i, '')
          .toLowerCase()
      return found.find((f) => stem(f) === wanted) ?? found.sort()[0]
    }
    level = next.slice(0, 500) // Obergrenze gegen riesige Bäume
  }
  return null
}
