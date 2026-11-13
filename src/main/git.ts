import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import type { AgentWorktree, GitDiff, GitFileChange } from '../shared/types'

/**
 * Git access for worktrees (one working directory per agent) and for reviewing changes.
 * No Electron dependency, so it can be tested by script. Always called via
 * `execFile` (no shell → paths and messages need no quoting).
 */

/** Hash of the empty tree: comparison base in a repository without a commit */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Larger files are not loaded in the diff */
const MAX_DIFF_BYTES = 2_000_000

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (!err) return done(stdout)
        const missing = (err as NodeJS.ErrnoException).code === 'ENOENT'
        fail(
          new Error(
            missing
              ? 'git wurde nicht gefunden (ist Git installiert und im PATH?)'
              : (stderr || stdout || err.message).trim()
          )
        )
      }
    )
  })
}

const ok = (cwd: string, args: string[]): Promise<boolean> =>
  git(cwd, args).then(
    () => true,
    () => false
  )

/** Root of the repository containing `dir` (null = no repository / no git) */
export async function repoRoot(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null
  try {
    return resolve((await git(dir, ['rev-parse', '--show-toplevel'])).trim())
  } catch {
    return null
  }
}

/** Current branch; the commit if HEAD is detached */
async function currentRef(dir: string): Promise<string> {
  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return branch === 'HEAD' ? (await git(dir, ['rev-parse', 'HEAD'])).trim() : branch
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'

/** An agent's branch – computable from name and id before the worktree exists */
export const worktreeBranch = (agentName: string, agentId: string): string =>
  `devhub/${slug(agentName)}-${agentId.slice(0, 8)}`

/** Folder name of the worktree below a project's worktree folder */
export const worktreeDirName = (agentName: string, agentId: string): string =>
  `${slug(agentName)}-${agentId.slice(0, 8)}`

/** Folder in the repository that belongs to DevHub (excluded from Git locally) */
const DEVHUB_DIR = '.devhub'

/**
 * Worktrees live **inside** the repository (`<repo>/.devhub/worktrees/<name>`), not in the data
 * folder: claude trusts subfolders of an already trusted folder, but for unknown folders it shows
 * its trust dialog on every start (preselected "No, exit") – every new agent would get stuck there.
 */
export const worktreesDir = (repo: string): string => join(repo, DEVHUB_DIR, 'worktrees')

/** Add `.devhub/` to `.git/info/exclude`: the worktrees do not show up as new files. */
async function excludeDevhubDir(repo: string): Promise<void> {
  try {
    const gitDir = resolve(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim())
    const file = join(gitDir, 'info', 'exclude')
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (text.split(/\r?\n/).some((l) => l.trim() === `${DEVHUB_DIR}/`)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${DEVHUB_DIR}/\n`)
  } catch {
    // without the entry `git status` shows the folder as new – not pretty, but not an error
  }
}

/** Creates a worktree with its own branch for an agent (branched from the current state). */
export async function createWorktree(
  repo: string,
  path: string,
  branch: string
): Promise<AgentWorktree> {
  if (!(await ok(repo, ['rev-parse', '--verify', 'HEAD'])))
    throw new Error('Das Repository hat noch keinen Commit – Worktrees brauchen einen.')
  const base = await currentRef(repo)
  await excludeDevhubDir(repo)
  mkdirSync(dirname(path), { recursive: true })
  await git(repo, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  return { path: resolve(path), branch, base, repo }
}

/**
 * Recreates a removed worktree at its old location (sessions can only be resumed in their
 * directory): with the old branch if it still exists, otherwise fresh from the current state.
 */
export async function restoreWorktree(wt: AgentWorktree): Promise<void> {
  if (existsSync(wt.path)) return
  await git(wt.repo, ['worktree', 'prune']).catch(() => {})
  mkdirSync(dirname(wt.path), { recursive: true })
  const hasBranch = await ok(wt.repo, ['rev-parse', '--verify', `refs/heads/${wt.branch}`])
  await git(
    wt.repo,
    hasBranch
      ? ['worktree', 'add', wt.path, wt.branch]
      : ['worktree', 'add', '-b', wt.branch, wt.path, 'HEAD']
  )
}

export interface WorktreeState {
  /** Uncommitted changes (including new files) */
  dirty: boolean
  /** Commits missing from the base branch */
  ahead: number
}

export async function worktreeState(wt: AgentWorktree): Promise<WorktreeState> {
  const status = await git(wt.path, ['status', '--porcelain'])
  const ahead = await git(wt.path, ['rev-list', '--count', `${wt.base}..HEAD`]).catch(() => '0')
  return { dirty: status.trim().length > 0, ahead: Number(ahead.trim()) || 0 }
}

/** Removes worktree and branch. Without `force` git fails if there are pending changes. */
export async function removeWorktree(wt: AgentWorktree, force = false): Promise<void> {
  if (existsSync(wt.path)) {
    await git(wt.repo, ['worktree', 'remove', ...(force ? ['--force'] : []), wt.path])
  }
  await git(wt.repo, ['worktree', 'prune']).catch(() => {})
  await git(wt.repo, ['branch', force ? '-D' : '-d', wt.branch]).catch(() => {})
}

/** Removes the worktree if nothing in it would be lost (clean, no commits of its own). */
export async function removeWorktreeIfUnused(wt: AgentWorktree): Promise<boolean> {
  if (!existsSync(wt.path)) return true
  const state = await worktreeState(wt)
  if (state.dirty || state.ahead > 0) return false
  await removeWorktree(wt, true)
  return true
}

export interface WorktreeEntry {
  path: string
  /** Short name of the branch (without refs/heads/), empty if HEAD is detached */
  branch: string
}

export async function listWorktrees(repo: string): Promise<WorktreeEntry[]> {
  const out = await git(repo, ['worktree', 'list', '--porcelain'])
  const list: WorktreeEntry[] = []
  for (const block of out.split(/\r?\n\r?\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    if (!path) continue
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? ''
    list.push({ path: resolve(path.trim()), branch: branch.trim() })
  }
  return list
}

/**
 * Comparison base: in the main folder the last commit, in a worktree the point it was branched
 * from (so the agent's already committed changes count as well).
 */
export async function reviewRef(cwd: string, base?: string): Promise<string> {
  if (base) {
    const mergeBase = await git(cwd, ['merge-base', 'HEAD', base]).catch(() => '')
    if (mergeBase.trim()) return mergeBase.trim()
  }
  return (await ok(cwd, ['rev-parse', '--verify', 'HEAD'])) ? 'HEAD' : EMPTY_TREE
}

/** Files changed compared to `ref`, plus new (not ignored) files */
export async function changes(cwd: string, ref: string): Promise<GitFileChange[]> {
  const list: GitFileChange[] = []
  const diff = await git(cwd, ['diff', '--name-status', '--no-renames', ref])
  for (const line of diff.split(/\r?\n/)) {
    const m = /^([A-Z])\t(.+)$/.exec(line)
    if (!m) continue
    list.push({ path: m[2], kind: m[1] === 'A' ? 'added' : m[1] === 'D' ? 'deleted' : 'modified' })
  }
  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard'])
  for (const path of untracked.split(/\r?\n/)) {
    if (path.trim()) list.push({ path: path.trim(), kind: 'untracked' })
  }
  return list.sort((a, b) => a.path.localeCompare(b.path))
}

/** Absolute path of a file in the working directory; throws if it leads outside */
export function insideWorkdir(cwd: string, path: string): string {
  const full = resolve(cwd, path)
  const rel = relative(resolve(cwd), full)
  if (!rel || rel.startsWith('..') || resolve(cwd, rel) !== full || rel.split(sep)[0] === '.git')
    throw new Error(`Ungültiger Pfad: ${path}`)
  return full
}

export async function fileDiff(cwd: string, ref: string, path: string): Promise<GitDiff> {
  const full = insideWorkdir(cwd, path)
  const original = await git(cwd, ['show', `${ref}:${path}`]).catch(() => '')
  let modified = ''
  if (existsSync(full) && statSync(full).isFile()) {
    if (statSync(full).size > MAX_DIFF_BYTES) return { original: '', modified: '', binary: true }
    modified = readFileSync(full, 'utf8')
  }
  if (original.length > MAX_DIFF_BYTES || original.includes('\0') || modified.includes('\0'))
    return { original: '', modified: '', binary: true }
  return { original, modified }
}

export function saveFile(cwd: string, path: string, content: string): void {
  const full = insideWorkdir(cwd, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

/** Resets a file to its state at `ref`; if it did not exist there, it is deleted. */
export async function discardFile(cwd: string, ref: string, path: string): Promise<void> {
  const full = insideWorkdir(cwd, path)
  if (await ok(cwd, ['cat-file', '-e', `${ref}:${path}`])) {
    await git(cwd, ['checkout', ref, '--', path])
    return
  }
  await git(cwd, ['rm', '-f', '--cached', '--ignore-unmatch', '--', path]).catch(() => {})
  rmSync(full, { force: true })
}

/** Commits the given files (empty = everything); returns git's output. */
export async function commit(cwd: string, message: string, paths: string[] = []): Promise<string> {
  const text = message.trim()
  if (!text) throw new Error('Commit-Nachricht fehlt')
  for (const p of paths) insideWorkdir(cwd, p)
  await git(cwd, ['add', '-A', '--', ...(paths.length ? paths : ['.'])])
  return (await git(cwd, ['commit', '-m', text, ...(paths.length ? ['--', ...paths] : [])])).trim()
}

/**
 * Merges a worktree's branch into the branch checked out in the main folder.
 * Aborts on conflicts (the main folder stays unchanged).
 */
export async function mergeWorktree(wt: AgentWorktree): Promise<string> {
  const state = await worktreeState(wt)
  if (state.dirty)
    throw new Error('Im Worktree gibt es noch nicht committete Änderungen – zuerst committen.')
  if (state.ahead === 0) throw new Error('Der Branch enthält keine neuen Commits.')
  const target = await currentRef(wt.repo)
  try {
    const out = await git(wt.repo, [
      'merge',
      '--no-ff',
      '-m',
      `Merge ${wt.branch} (DevHub)`,
      wt.branch
    ])
    return `In „${target}“ zusammengeführt.\n${out.trim()}`
  } catch (e) {
    await git(wt.repo, ['merge', '--abort']).catch(() => {})
    throw new Error(
      `Zusammenführen in „${target}“ fehlgeschlagen (abgebrochen, nichts geändert):\n${e instanceof Error ? e.message : String(e)}`,
      { cause: e }
    )
  }
}

/** The agent's working directory in the worktree: same subfolder as the agent folder in the repository */
export function worktreeCwd(wt: AgentWorktree, agentPath: string): string {
  const rel = relative(wt.repo, resolve(agentPath))
  const cwd = rel && !rel.startsWith('..') ? join(wt.path, rel) : wt.path
  return existsSync(cwd) ? cwd : wt.path
}
