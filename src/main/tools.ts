import { exec, spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { readdir } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'

/** Runs a shell command and returns the first output line (or null on error). */
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
 * Path to the Claude CLI. Prefers claude.exe (native installer) so arguments can be
 * passed without shell quoting; otherwise e.g. claude.cmd (npm).
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
 * Environment variables a running Claude Code session passes on to child processes.
 * If DevHub is started from a Claude terminal, agents would otherwise run as a "child session"
 * (among other things without a transcript → no restore possible).
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

/** Environment for spawned Claude processes: without session markers of a parent Claude instance. */
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

/** Windows paths cannot contain " – so quoting with " is safe. */
function quote(path: string): string {
  if (path.includes('"')) throw new Error('Ungültiger Pfad')
  return `"${path}"`
}

export function openInVSCode(path: string, line?: number): void {
  if (!existsSync(path)) throw new Error(`Pfad nicht gefunden: ${path}`)
  const cmd = line ? `code -g ${quote(`${path}:${line}`)}` : `code ${quote(path)}`
  exec(cmd, { windowsHide: true })
}

/** Validates a program path entered by the user; returns an error message or null. */
export function validateProgram(exe: string | undefined): string | null {
  if (!exe) return null
  if (!isAbsolute(exe)) return 'Programm: bitte den vollständigen Pfad angeben'
  if (!/\.(exe|cmd|bat)$/i.test(exe)) return 'Programm: muss eine .exe (oder .cmd/.bat) sein'
  if (!existsSync(exe)) return `Programm nicht gefunden: ${exe}`
  return null
}

/**
 * Opens a file or folder with a specific program (detached from DevHub, without a
 * console window). Working directory = the folder itself or the file's folder.
 */
export function openWithProgram(exe: string, file: string): Promise<void> {
  const err = validateProgram(exe)
  if (err) return Promise.reject(new Error(err))
  const cwd = statSync(file).isDirectory() ? file : dirname(file)
  return new Promise((resolve, reject) => {
    // .cmd/.bat need a shell; start .exe directly (no shell → no special-character issues)
    const script = /\.(cmd|bat)$/i.test(exe)
    const child = script
      ? // cmd /s /c ""a b.cmd" "file"": outer quotes are stripped, inner ones stay (spaces)
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
 * How a project folder is recognized (file or folder names directly inside it).
 * The first match is shown as the marker.
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

/** How deep below a chosen folder to search for projects */
const PROJECT_SCAN_DEPTH = 3
const PROJECT_SCAN_LIMIT = 300

export interface FoundProject {
  path: string
  /** Marker, e.g. "Git" or ".sln" */
  marker: string
}

/**
 * Finds projects: a folder with a project marker (Git, .sln, package.json …) is one project
 * (no further search below it – monorepos stay one project). Otherwise its subfolders are
 * searched (up to PROJECT_SCAN_DEPTH levels) – so a "Dev" folder yields all projects
 * inside it.
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
      return // no access or similar
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

/** Folders skipped when searching for solution files. */
const SKIP_DIRS = new Set(['node_modules', 'bin', 'obj', 'out', 'dist', 'build', 'packages'])

/**
 * Searches the folder (and up to 3 levels below) for a `.sln`/`.slnx`.
 * Prefers the shallowest level, and there a file named like the folder. null if none found.
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
        continue // no access or similar
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
    level = next.slice(0, 500) // cap against huge trees
  }
  return null
}
