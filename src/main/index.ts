import './dataPath' // must run first: sets the data folder next to the .exe
import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  session,
  Notification,
  clipboard
} from 'electron'
import { basename, dirname, join, resolve } from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type {
  Agent,
  AgentTemplate,
  AgentTemplateInput,
  AgentWorktree,
  Engine,
  EngineInput,
  PermissionAnswer,
  Project,
  ProjectInput,
  PromptTemplate,
  PromptTemplateInput,
  ReviewInfo,
  ReviewTarget,
  RunCommand,
  ScannedProject,
  Selection,
  Settings,
  StartOptions,
  TaskStatus,
  TeamTemplate,
  TeamTemplateInput,
  WhisperModelId
} from '../shared/types'
import { checkClaudeAuth, startClaudeLogin } from './claudeAuth'
import { AgentManager } from './agents'
import { applyOrder, getState, updateState } from './store'
import { RunManager } from './runs'
import { RemoteServer } from './remote'
import { dailyReport, spokenSummary } from './reports'
import { searchSessions } from './history'
import {
  changes as gitChanges,
  commit as gitCommit,
  discardFile,
  fileDiff,
  listWorktrees,
  mergeWorktree,
  removeWorktree,
  repoRoot,
  reviewRef,
  worktreesDir,
  saveFile
} from './git'
import { validateRule } from '../shared/permissions'
import {
  findProjects,
  findSolution,
  isVSCodeInstalled,
  openInVSCode,
  openWithProgram,
  validateProgram
} from './tools'
import { deleteModel, downloadVoice, transcribe, voiceStatus } from './voice'
import { runVoiceCommand } from './voiceCommands'
import { isValidModelName, validateAgentArgs } from '../shared/agentArgs'

let mainWindow: BrowserWindow | null = null

// Single instance only: two would restore the same agents (sessions) and write to the same
// data folder. A second launch brings the existing window to the front instead.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

/** Sends an event to the UI (if the window exists). */
function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const runs = new RunManager({
  onChanged: (projectId) => send('runs:changed', projectId),
  onOutput: (projectId, name, chunk) => send('runs:output', projectId, name, chunk)
})

/** MCP-Tools `run_*`: Agents sehen und steuern die Projekt-Befehle des Ausführen-Fensters. */
function runTool(
  p: Project,
  tool: 'run_list' | 'run_output' | 'run_start' | 'run_stop',
  args: Record<string, unknown>
): string {
  const list = runs.list(p)
  if (tool === 'run_list') {
    if (!list.length)
      return 'No commands are configured for this project (the user can add them in the DevHub project settings).'
    return list
      .map((r) => {
        const state = r.running
          ? 'running'
          : r.exitCode === undefined
            ? 'not started yet'
            : `exited with code ${r.exitCode ?? '?'}`
        return `- ${r.name}: \`${r.command}\` – ${state}`
      })
      .join('\n')
  }
  const wanted = String(args.name ?? '')
    .trim()
    .toLowerCase()
  const run = list.find((r) => r.name.trim().toLowerCase() === wanted)
  if (!run) throw new Error(`No command named "${String(args.name ?? '')}". Call run_list first.`)
  if (tool === 'run_start') {
    runs.start(p, run.name)
    return `Started "${run.name}". Read its output with run_output.`
  }
  if (tool === 'run_stop') {
    runs.stop(p.id, run.name)
    return `Stopping "${run.name}".`
  }
  const count = Math.max(1, Math.min(400, Math.floor(Number(args.lines)) || 80))
  const lines = runs.output(p.id, run.name).split(/\r?\n/)
  const tail = lines.slice(-count).join('\n').trim()
  return `${run.name} (${run.running ? 'running' : 'not running'}), last ${count} lines:\n${tail || '(no output yet)'}`
}

/** Zuletzt gemeldeter Wartegrund je Agent (keine doppelten Benachrichtigungen kurz hintereinander) */
const lastAttention = new Map<string, { message: string; at: number }>()

/** Agent wartet auf den Nutzer und DevHub ist im Hintergrund → Windows-Benachrichtigung + Blinken. */
function notifyAttention(agent: Agent, message: string): void {
  if (!getState().settings.notifyOnWaiting) return
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return
  const last = lastAttention.get(agent.id)
  if (last && last.message === message && Date.now() - last.at < 5000) return
  lastAttention.set(agent.id, { message, at: Date.now() })
  mainWindow.flashFrame(true)
  if (!Notification.isSupported()) return
  const projectName = getState().projects.find((p) => p.id === agent.projectId)?.name
  const n = new Notification({
    title: projectName ? `${agent.name} · ${projectName}` : agent.name,
    body: message.slice(0, 240)
  })
  n.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    send('agents:focusRequest', agent.id)
  })
  n.show()
}

const agents = new AgentManager({
  onPermissions: (list) => send('inbox:permissions', list),
  onNotice: (notice) => send('inbox:notice', notice),
  onAttention: notifyAttention,
  onTurnFinished: (agent) => {
    if (!getState().settings.voiceReadback || !agent.lastMessage) return
    spokenSummary(agent.name, agent.lastMessage)
      .then((text) => text && send('voice:speak', text))
      .catch((e) => console.error('[DevHub] Vorlesen:', e))
  },
  onPlan: (plan) => send('code:plan', plan),
  onShowDiff: (id, filePath) => {
    send('code:showDiff', id, filePath)
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.show()
  },
  onTasksChanged: (tasks) => send('tasks:changed', tasks),
  runTool,
  onData: (id, data) => send('agents:data', id, data),
  onChanged: (list, teams) => send('agents:changed', list, teams),
  onCodeFocus: (focus) => send('code:focus', focus),
  onSnippets: (id, snippets) => send('code:snippets', id, snippets),
  onEdits: (id, files) => send('code:edits', id, files),
  onStartFailed: (name, output) => send('agents:startFailed', name, output),
  onEditorOpened: (id, text) => {
    send('editor:opened', id, text)
    // Bring the window to the front: Ctrl+G comes from the terminal, the tab should be visible immediately
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.show()
  },
  onEditorAppend: (id, text) => send('editor:append', id, text)
})

const remote = new RemoteServer(agents)

// ------------------------------------------------------------ Änderungen prüfen (Git)

interface ResolvedTarget {
  target: ReviewTarget
  /** Nur bei Worktrees */
  worktree?: AgentWorktree
}

/** Prüfbare Arbeitsverzeichnisse eines Projekts: Hauptordner + Worktrees seiner Agents. */
async function reviewTargets(
  projectId: string
): Promise<{ info: ReviewInfo; all: ResolvedTarget[] }> {
  const p = project(projectId)
  const repo = await repoRoot(p.agentPath)
  if (!repo) return { info: { isRepo: false, targets: [] }, all: [] }
  const same = (a: string, b: string): boolean =>
    resolve(a).toLowerCase() === resolve(b).toLowerCase()
  const running = agents.list().filter((a) => a.projectId === projectId)
  const root = resolve(worktreesDir(repo)).toLowerCase()
  const all: ResolvedTarget[] = []
  for (const wt of await listWorktrees(repo)) {
    if (same(wt.path, repo)) {
      const inMain = running.find((a) => !a.worktree)
      all.unshift({
        target: {
          id: 'main',
          label: `Hauptordner${wt.branch ? ` (${wt.branch})` : ''}`,
          cwd: repo,
          isWorktree: false,
          branch: wt.branch || undefined,
          agentId: inMain?.id
        }
      })
      continue
    }
    if (!wt.path.toLowerCase().startsWith(root) || !wt.branch) continue
    const agent = running.find((a) => a.worktree && same(a.worktree.path, wt.path))
    const archived = getState().archive.find((x) => x.worktree && same(x.worktree.path, wt.path))
    const known = agent?.worktree ?? archived?.worktree
    const base = known?.base ?? all[0]?.target.branch ?? 'HEAD'
    all.push({
      target: {
        id: `wt:${wt.branch}`,
        label: `${agent?.name ?? (archived ? `${archived.name} (beendet)` : basename(wt.path))} · ${wt.branch}`,
        cwd: wt.path,
        isWorktree: true,
        branch: wt.branch,
        base,
        agentId: agent?.id
      },
      worktree: { path: wt.path, branch: wt.branch, base, repo }
    })
  }
  return { info: { isRepo: true, targets: all.map((t) => t.target) }, all }
}

async function reviewTarget(projectId: string, targetId: string): Promise<ResolvedTarget> {
  const found = (await reviewTargets(projectId)).all.find((t) => t.target.id === targetId)
  if (!found) throw new Error('Arbeitsverzeichnis nicht gefunden')
  return found
}

// ------------------------------------------------------------ Web-Vorschau

/** Vorschau-Fenster je Projekt */
const previews = new Map<string, BrowserWindow>()

function previewUrl(p: Project): string {
  const url = p.previewUrl?.trim()
  if (!url)
    throw new Error(`Für „${p.name}“ ist keine Vorschau-Adresse eingetragen (Projekt bearbeiten)`)
  return url
}

function openPreview(projectId: string): BrowserWindow {
  const p = project(projectId)
  const url = previewUrl(p)
  let win = previews.get(projectId)
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    if (win.webContents.getURL() !== url) void win.loadURL(url).catch(() => {})
    return win
  }
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    title: `Vorschau · ${p.name}`,
    backgroundColor: '#ffffff',
    // Fremde Seite: abgeschottet, ohne Preload/Node
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  win.on('closed', () => previews.delete(projectId))
  previews.set(projectId, win)
  void win.loadURL(url).catch(() => {})
  return win
}

/** Dateiendungen, die im Editor-Tab als Bild-Vorschau gezeigt werden */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1000,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1d23',
    title: 'DevHub',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  // Blinken in der Taskleiste (wartender Agent) endet, sobald das Fenster wieder vorn ist
  mainWindow.on('focus', () => mainWindow?.flashFrame(false))

  // Dev aid: DEVHUB_SCREENSHOT=<file.png> saves an image of the window after DEVHUB_SCREENSHOT_DELAY ms (default 8000)
  const shot = process.env.DEVHUB_SCREENSHOT
  if (shot) {
    mainWindow.webContents.once('did-finish-load', () =>
      setTimeout(
        async () => {
          if (!mainWindow) return
          // Bring the window to the front, otherwise Chromium may return a stale image
          mainWindow.show()
          mainWindow.focus()
          mainWindow.webContents.invalidate()
          await new Promise((r) => setTimeout(r, 1000))
          const img = await mainWindow.webContents.capturePage()
          writeFileSync(shot, img.toPNG())
          const dom = await mainWindow.webContents.executeJavaScript(
            `JSON.stringify({ agents: [...document.querySelectorAll('.agent-row')].map(e => e.className + ' | ' + e.textContent), code: document.querySelector('.code-note')?.textContent ?? null })`
          )
          console.log('[DevHub] DOM', dom)
        },
        Number(process.env.DEVHUB_SCREENSHOT_DELAY) || 8000
      )
    )
  }

  mainWindow.webContents.on('render-process-gone', (_, details) => {
    console.error('[DevHub] Renderer beendet:', details.reason, details.exitCode)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Currently registered global shortcut (voice command), null = none. */
let globalHotkey: string | null = null

function unregisterGlobalHotkey(): void {
  if (globalHotkey) globalShortcut.unregister(globalHotkey)
  globalHotkey = null
}

/** Replaces the global shortcut. false if it is invalid or already taken system-wide. */
function registerGlobalHotkey(accelerator: string): boolean {
  unregisterGlobalHotkey()
  try {
    if (!globalShortcut.register(accelerator, () => send('voice:globalHotkey'))) return false
  } catch {
    return false // invalid accelerator
  }
  globalHotkey = accelerator
  return true
}

/** Rough shape check of a view from the renderer before it is saved. */
function isSelection(v: unknown): v is NonNullable<Selection> {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  const optId = s.activeAgentId === undefined || typeof s.activeAgentId === 'string'
  if (s.kind === 'agent') return typeof s.agentId === 'string'
  if (s.kind === 'project') return typeof s.projectId === 'string' && optId
  if (s.kind === 'agents') {
    return Array.isArray(s.agentIds) && s.agentIds.every((x) => typeof x === 'string') && optId
  }
  return false
}

function project(id: string): Project {
  const p = getState().projects.find((x) => x.id === id)
  if (!p) throw new Error('Projekt nicht gefunden')
  return p
}

function registerIpc(): void {
  // --- Claude ---
  ipcMain.handle('claude:checkAuth', () => checkClaudeAuth())
  ipcMain.handle('claude:startLogin', () => startClaudeLogin())

  // --- Tools ---
  ipcMain.handle('tools:vscodeInstalled', () => isVSCodeInstalled())

  // --- Projects ---
  ipcMain.handle('projects:list', () => getState().projects)
  ipcMain.handle('projects:save', async (_, input: ProjectInput) => {
    const name = input.name?.trim()
    if (!name) throw new Error('Name fehlt')
    if (!input.agentPath || !existsSync(input.agentPath))
      throw new Error('Agent-Pfad existiert nicht')
    if (input.projectFile && !existsSync(input.projectFile))
      throw new Error('Projektdatei existiert nicht')
    if (input.folderPath && !existsSync(input.folderPath))
      throw new Error('Ordner (Pfad 3) existiert nicht')
    const argsError = validateAgentArgs(input.agentArgs)
    if (argsError) throw new Error(`Start-Flags: ${argsError}`)
    const programError =
      validateProgram(input.projectFileApp?.trim()) ?? validateProgram(input.folderApp?.trim())
    if (programError) throw new Error(programError)

    const runCommands: RunCommand[] = (Array.isArray(input.runCommands) ? input.runCommands : [])
      .map((c) => ({
        name: String(c?.name ?? '').trim(),
        command: String(c?.command ?? '').trim()
      }))
      .filter((c) => c.name || c.command)
    for (const c of runCommands) {
      if (!c.name || !c.command)
        throw new Error('Befehle: Name und Befehl müssen beide ausgefüllt sein')
      if (/[\r\n]/.test(c.command)) throw new Error(`Befehl „${c.name}“: nur eine Zeile`)
    }
    if (new Set(runCommands.map((c) => c.name.toLowerCase())).size < runCommands.length)
      throw new Error('Befehle: Namen müssen eindeutig sein')
    const permissionRules = [
      ...new Set((input.permissionRules ?? []).map((r) => String(r).trim()).filter(Boolean))
    ]
    for (const rule of permissionRules) {
      const ruleError = validateRule(rule)
      if (ruleError) throw new Error(`Freigabe-Regel „${rule}“: ${ruleError}`)
    }
    const previewUrl = input.previewUrl?.trim() || undefined
    if (previewUrl && !/^https?:\/\/\S+$/i.test(previewUrl))
      throw new Error('Vorschau-Adresse muss mit http:// oder https:// beginnen')
    if (input.useWorktrees && !(await repoRoot(input.agentPath)))
      throw new Error('Worktrees: Der Agent-Ordner liegt in keinem Git-Repository (oder git fehlt)')

    const saved: Project = {
      id: input.id ?? randomUUID(),
      name,
      agentPath: input.agentPath,
      projectFile: input.projectFile || undefined,
      projectFileApp: input.projectFileApp?.trim() || undefined,
      folderPath: input.folderPath || undefined,
      folderApp: input.folderApp?.trim() || undefined,
      agentArgs: input.agentArgs?.trim() || undefined,
      useWorktrees: input.useWorktrees || undefined,
      checks: input.checks?.trim() || undefined,
      runCommands: runCommands.length ? runCommands : undefined,
      previewUrl,
      permissionRules: permissionRules.length ? permissionRules : undefined
    }
    updateState((s) => {
      const i = s.projects.findIndex((p) => p.id === saved.id)
      if (i >= 0) s.projects[i] = saved
      else s.projects.push(saved)
    })
    return saved
  })
  ipcMain.handle('projects:remove', (_, id: string) => {
    for (const a of agents.list().filter((a) => a.projectId === id)) agents.stop(a.id)
    for (const r of runs.list(project(id))) runs.stop(id, r.name)
    updateState((s) => {
      s.projects = s.projects.filter((p) => p.id !== id)
      s.agents = s.agents.filter((a) => a.projectId !== id)
      s.tasks = s.tasks.filter((t) => t.projectId !== id)
      s.archive = s.archive.filter((x) => x.projectId !== id)
    })
    send('tasks:changed', getState().tasks)
  })
  ipcMain.handle('projects:reorder', (_, ids: string[]) => {
    updateState((s) => (s.projects = applyOrder(s.projects, ids)))
    return getState().projects
  })
  ipcMain.handle('projects:openProjectFile', async (_, id: string) => {
    const p = project(id)
    if (!p.projectFile) return
    if (!existsSync(p.projectFile)) throw new Error(`Projektdatei nicht gefunden: ${p.projectFile}`)
    // Program: project → global → Windows default program for the file extension
    const program = p.projectFileApp || getState().settings.projectFileApp
    if (program) return openWithProgram(program, p.projectFile)
    const err = await shell.openPath(p.projectFile)
    if (err) throw new Error(err)
  })
  ipcMain.handle('projects:pickProgram', async (_, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      defaultPath,
      filters: [
        { name: 'Programme', extensions: ['exe', 'cmd', 'bat'] },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('projects:openFolder', async (_, id: string) => {
    const p = project(id)
    if (!p.folderPath) return
    if (!existsSync(p.folderPath)) throw new Error(`Ordner nicht gefunden: ${p.folderPath}`)
    // Program: project → global → VS Code (if installed) → Windows Explorer
    const program = p.folderApp || getState().settings.folderApp
    if (program) return openWithProgram(program, p.folderPath)
    if (await isVSCodeInstalled()) return openInVSCode(p.folderPath)
    const err = await shell.openPath(p.folderPath)
    if (err) throw new Error(err)
  })
  ipcMain.handle('projects:pickFolder', async (_, defaultPath?: string) => {
    // No default (new project): continue where the last pick was – in the parent
    // folder, so the next project next to it is visible right away
    const last = getState().lastPickDir
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      defaultPath: defaultPath || (last && existsSync(last) ? last : undefined)
    })
    if (r.canceled || !r.filePaths[0]) return null
    const parent = dirname(r.filePaths[0])
    if (parent !== last) updateState((s) => (s.lastPickDir = parent))
    return r.filePaths[0]
  })
  // Import: multiple folders (Ctrl+click) – e.g. a whole "Dev" folder or individual projects
  ipcMain.handle('projects:pickFolders', async () => {
    const last = getState().lastPickDir
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Ordner mit Projekten auswählen (Strg+Klick für mehrere)',
      properties: ['openDirectory', 'multiSelections'],
      defaultPath: last && existsSync(last) ? last : undefined
    })
    if (r.canceled || !r.filePaths.length) return []
    const parent = dirname(r.filePaths[0])
    if (parent !== last) updateState((s) => (s.lastPickDir = parent))
    return r.filePaths
  })
  ipcMain.handle('projects:scan', async (_, dirs: string[]) => {
    const roots = (Array.isArray(dirs) ? dirs : []).filter(
      (d) => typeof d === 'string' && existsSync(d)
    )
    const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
    const registered = new Set(getState().projects.map((p) => norm(p.agentPath)))
    const found = await findProjects(roots)
    return Promise.all(
      found.map(async (f): Promise<ScannedProject> => ({
        path: f.path,
        name: basename(f.path),
        marker: f.marker,
        projectFile: await findSolution(f.path),
        registered: registered.has(norm(f.path))
      }))
    )
  })
  ipcMain.handle('projects:findSolution', (_, dir: string) =>
    dir && existsSync(dir) ? findSolution(dir) : null
  )
  ipcMain.handle('projects:pickProjectFile', async (_, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      defaultPath,
      filters: [
        {
          name: 'Projektmappen & Projekte',
          extensions: [
            'sln',
            'slnx',
            'csproj',
            'vbproj',
            'fsproj',
            'vcxproj',
            'sqlproj',
            'pyproj',
            'njsproj'
          ]
        },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // --- Templates (predefined agents) ---
  ipcMain.handle('templates:list', () => getState().templates)
  ipcMain.handle('templates:save', (_, input: AgentTemplateInput) => {
    const name = input.name?.trim().replace(/\s+/g, ' ')
    if (!name) throw new Error('Name fehlt')
    // "Agent 3" or similar collides with the automatically assigned names
    if (/^agent \d+$/i.test(name)) throw new Error('„Agent N“ ist für normale Agents reserviert')
    if (/ \d+$/.test(name))
      throw new Error('Name darf nicht auf eine Zahl enden (wird für „Name 2“, „Name 3“ verwendet)')
    const others = getState().templates.filter((t) => t.id !== input.id)
    if (others.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Es gibt bereits eine Vorlage „${name}“`)
    const model = input.model?.trim() || undefined
    if (model && !isValidModelName(model)) throw new Error(`Ungültiger Modellname: ${model}`)

    const saved: AgentTemplate = {
      id: input.id ?? randomUUID(),
      name,
      model,
      instructions: input.instructions?.trim() || undefined
    }
    updateState((s) => {
      const i = s.templates.findIndex((t) => t.id === saved.id)
      if (i >= 0) s.templates[i] = saved
      else s.templates.push(saved)
    })
    return saved
  })
  ipcMain.handle('templates:remove', (_, id: string) => {
    const usedBy = getState().teamTemplates.filter((t) =>
      t.members.some((m) => m.templateId === id)
    )
    if (usedBy.length)
      throw new Error(`Wird in Team ${usedBy.map((t) => `„${t.name}“`).join(', ')} verwendet`)
    // Running agents keep their name but start without a template from then on
    updateState((s) => (s.templates = s.templates.filter((t) => t.id !== id)))
  })

  // --- Teams ---
  ipcMain.handle('teamTemplates:list', () => getState().teamTemplates)
  ipcMain.handle('teamTemplates:save', (_, input: TeamTemplateInput) => {
    const name = input.name?.trim().replace(/\s+/g, ' ')
    if (!name) throw new Error('Name fehlt')
    if (/^team \d+$/i.test(name)) throw new Error('„Team N“ ist für temporäre Teams reserviert')
    if (/ \d+$/.test(name))
      throw new Error('Name darf nicht auf eine Zahl enden (wird für „Name 2“ verwendet)')
    const others = getState().teamTemplates.filter((t) => t.id !== input.id)
    if (others.some((t) => t.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Es gibt bereits ein Team „${name}“`)
    const templates = getState().templates
    const members = (input.members ?? []).map((m) => ({
      templateId:
        m.templateId && templates.some((t) => t.id === m.templateId) ? m.templateId : undefined
    }))
    if (members.length < 2) throw new Error('Ein Team braucht mindestens zwei Mitglieder')
    if (members.length > 8) throw new Error('Höchstens 8 Mitglieder')

    const saved: TeamTemplate = {
      id: input.id ?? randomUUID(),
      name,
      members,
      instructions: input.instructions?.trim() || undefined
    }
    updateState((s) => {
      const i = s.teamTemplates.findIndex((t) => t.id === saved.id)
      if (i >= 0) s.teamTemplates[i] = saved
      else s.teamTemplates.push(saved)
    })
    return saved
  })
  ipcMain.handle('teamTemplates:remove', (_, id: string) => {
    // Running teams remain but lose the shared guidelines
    updateState((s) => (s.teamTemplates = s.teamTemplates.filter((t) => t.id !== id)))
  })
  ipcMain.handle('teams:list', () => agents.teams())
  ipcMain.handle('teams:start', (_, projectId: string, teamTemplateId: string, task?: string) =>
    agents.startTeam(projectId, { teamTemplateId, task })
  )
  ipcMain.handle('teams:stop', (_, teamId: string) => agents.stopTeam(teamId))

  // --- Agents ---
  ipcMain.handle('agents:list', () => agents.list())
  ipcMain.handle('agents:restore', () => agents.restore())
  ipcMain.handle('agents:start', (_, projectId: string, options?: StartOptions) =>
    agents.start(projectId, options?.task, undefined, options?.templateId, {
      engineId: options?.engineId
    })
  )
  ipcMain.handle('agents:fork', (_, id: string) => agents.fork(id))
  ipcMain.handle('agents:enqueue', (_, id: string, text: string) =>
    agents.enqueue(id, String(text ?? ''))
  )
  ipcMain.handle('agents:dequeue', (_, id: string, queueId: string) => agents.dequeue(id, queueId))
  ipcMain.handle('agents:activityLog', (_, id: string) => agents.activityLog(id))

  // --- Eingang: Freigaben ---
  ipcMain.handle('inbox:permissions', () => agents.userPermissions())
  ipcMain.handle('inbox:answer', (_, id: number, answer: PermissionAnswer, message?: string) => {
    if (!['allow', 'deny', 'always', 'terminal'].includes(answer))
      throw new Error('Ungültige Antwort')
    agents.answerUserPermission(Number(id), answer, message)
  })

  // --- Aufgaben ---
  ipcMain.handle('tasks:list', () => agents.tasks())
  ipcMain.handle('tasks:save', (_, input: { id?: string; projectId: string; text: string }) =>
    agents.saveTask(input)
  )
  ipcMain.handle('tasks:remove', (_, id: string) => agents.removeTask(id))
  ipcMain.handle('tasks:setStatus', (_, id: string, status: TaskStatus) => {
    if (!['open', 'running', 'done'].includes(status)) throw new Error('Ungültiger Status')
    agents.updateTask(
      id,
      status === 'open' ? { status, agentId: undefined, agentName: undefined } : { status }
    )
  })
  ipcMain.handle('tasks:start', (_, id: string, templateId?: string) =>
    agents.startTask(id, templateId)
  )
  ipcMain.handle('tasks:assign', (_, id: string, agentId: string) => agents.assignTask(id, agentId))

  // --- Verlauf ---
  ipcMain.handle('history:list', () => agents.archive())
  ipcMain.handle('history:remove', (_, id: string) => agents.removeArchived(id))
  ipcMain.handle('history:resume', (_, id: string, fork?: boolean) =>
    agents.resumeArchived(id, fork === true)
  )
  ipcMain.handle('history:search', (_, query: string) =>
    searchSessions(
      [
        ...agents
          .list()
          .filter((a) => !a.engineId)
          .map((a) => ({
            sessionId: a.sessionId,
            name: a.name,
            projectId: a.projectId,
            agentId: a.id
          })),
        ...agents.archive().map((x) => ({
          sessionId: x.sessionId,
          name: x.name,
          projectId: x.projectId,
          archivedId: x.id
        }))
      ],
      String(query ?? '')
    )
  )

  // --- Änderungen prüfen (Git) ---
  ipcMain.handle('git:targets', async (_, projectId: string): Promise<ReviewInfo> => {
    try {
      return (await reviewTargets(projectId)).info
    } catch (e) {
      return { isRepo: false, targets: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('git:changes', async (_, projectId: string, targetId: string) => {
    const { target } = await reviewTarget(projectId, targetId)
    return gitChanges(target.cwd, await reviewRef(target.cwd, target.base))
  })
  ipcMain.handle('git:diff', async (_, projectId: string, targetId: string, path: string) => {
    const { target } = await reviewTarget(projectId, targetId)
    return fileDiff(target.cwd, await reviewRef(target.cwd, target.base), String(path))
  })
  ipcMain.handle(
    'git:saveFile',
    async (_, projectId: string, targetId: string, path: string, content: string) => {
      const { target } = await reviewTarget(projectId, targetId)
      saveFile(target.cwd, String(path), String(content))
    }
  )
  ipcMain.handle('git:discard', async (_, projectId: string, targetId: string, path: string) => {
    const { target } = await reviewTarget(projectId, targetId)
    await discardFile(target.cwd, await reviewRef(target.cwd, target.base), String(path))
  })
  ipcMain.handle(
    'git:commit',
    async (_, projectId: string, targetId: string, message: string, paths?: string[]) => {
      const { target } = await reviewTarget(projectId, targetId)
      return gitCommit(target.cwd, String(message ?? ''), Array.isArray(paths) ? paths : [])
    }
  )
  ipcMain.handle('git:merge', async (_, projectId: string, targetId: string) => {
    const { worktree } = await reviewTarget(projectId, targetId)
    if (!worktree) throw new Error('Nur Worktrees lassen sich zusammenführen')
    return mergeWorktree(worktree)
  })
  ipcMain.handle(
    'git:removeWorktree',
    async (_, projectId: string, targetId: string, force?: boolean) => {
      const { target, worktree } = await reviewTarget(projectId, targetId)
      if (!worktree) throw new Error('Der Hauptordner kann nicht entfernt werden')
      if (target.agentId) throw new Error('In diesem Worktree läuft noch ein Agent – erst beenden')
      await removeWorktree(worktree, force === true)
    }
  )

  // --- Ausführen: Projekt-Befehle + Web-Vorschau ---
  ipcMain.handle('runs:list', (_, projectId: string) => runs.list(project(projectId)))
  ipcMain.handle('runs:start', (_, projectId: string, name: string) =>
    runs.start(project(projectId), String(name))
  )
  ipcMain.handle('runs:stop', (_, projectId: string, name: string) =>
    runs.stop(projectId, String(name))
  )
  ipcMain.handle('runs:output', (_, projectId: string, name: string) =>
    runs.output(projectId, String(name))
  )
  ipcMain.handle('preview:open', (_, projectId: string) => {
    openPreview(projectId)
  })
  // Bild der Vorschau speichern und als Anhang in den Prompt des Agents eintragen (ohne Abschicken)
  ipcMain.handle('preview:screenshot', async (_, projectId: string, agentId: string) => {
    const win = openPreview(projectId)
    if (win.webContents.isLoading())
      await new Promise<void>((done) => win.webContents.once('did-stop-loading', () => done()))
    await new Promise((done) => setTimeout(done, 400))
    const image = await win.webContents.capturePage()
    const file = agents.saveEditorImage(agentId, 'png', image.toPNG().buffer as ArrayBuffer)
    agents.write(agentId, `@"${file}" `)
    return file
  })

  // --- Prompt-Bibliothek ---
  ipcMain.handle('prompts:list', () => getState().prompts)
  ipcMain.handle('prompts:save', (_, input: PromptTemplateInput) => {
    const name = input.name?.trim().replace(/\s+/g, ' ')
    const text = input.text?.trim()
    if (!name) throw new Error('Name fehlt')
    if (!text) throw new Error('Text fehlt')
    const others = getState().prompts.filter((p) => p.id !== input.id)
    if (others.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Es gibt bereits einen Prompt „${name}“`)
    const saved: PromptTemplate = { id: input.id ?? randomUUID(), name, text }
    updateState((s) => {
      const i = s.prompts.findIndex((p) => p.id === saved.id)
      if (i >= 0) s.prompts[i] = saved
      else s.prompts.push(saved)
    })
    return saved
  })
  ipcMain.handle('prompts:remove', (_, id: string) =>
    updateState((s) => (s.prompts = s.prompts.filter((p) => p.id !== id)))
  )

  // --- Weitere Engines ---
  ipcMain.handle('engines:list', () => getState().engines)
  ipcMain.handle('engines:save', (_, input: EngineInput) => {
    const name = input.name?.trim().replace(/\s+/g, ' ')
    const command = input.command?.trim()
    if (!name) throw new Error('Name fehlt')
    if (/^agent \d+$/i.test(name)) throw new Error('„Agent N“ ist für normale Agents reserviert')
    if (/ \d+$/.test(name)) throw new Error('Name darf nicht auf eine Zahl enden')
    if (!command) throw new Error('Befehl fehlt')
    if (/[\r\n]/.test(command)) throw new Error('Befehl: nur eine Zeile')
    const taken = [...getState().engines.filter((e) => e.id !== input.id), ...getState().templates]
    if (taken.some((e) => e.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Der Name „${name}“ ist schon vergeben (Engine oder vordefinierter Agent)`)
    const saved: Engine = { id: input.id ?? randomUUID(), name, command }
    updateState((s) => {
      const i = s.engines.findIndex((e) => e.id === saved.id)
      if (i >= 0) s.engines[i] = saved
      else s.engines.push(saved)
    })
    return saved
  })
  ipcMain.handle('engines:remove', (_, id: string) => {
    if (agents.list().some((a) => a.engineId === id))
      throw new Error('Mit dieser Engine läuft noch ein Agent')
    updateState((s) => (s.engines = s.engines.filter((e) => e.id !== id)))
  })

  // --- Berichte, Fernzugriff ---
  ipcMain.handle('reports:daily', (_, projectId?: string) =>
    dailyReport(agents, projectId || undefined)
  )
  ipcMain.handle('remote:info', () => remote.info())
  ipcMain.handle('agents:stop', (_, id: string) => agents.stop(id))
  ipcMain.handle('agents:rename', (_, id: string, name: string) => agents.rename(id, name))
  ipcMain.handle('agents:reorder', (_, ids: string[]) => agents.reorder(ids))
  ipcMain.handle('agents:sendLine', (_, id: string, text: string) => agents.sendLine(id, text))
  ipcMain.handle('agents:sendVoice', (_, id: string, text: string) => agents.sendVoice(id, text))
  ipcMain.handle('agents:setVoiceAutoSend', (_, id: string, value?: boolean) =>
    agents.setVoiceAutoSend(id, typeof value === 'boolean' ? value : undefined)
  )
  ipcMain.handle('agents:buffer', (_, id: string) => agents.buffer(id))
  ipcMain.on('agents:write', (_, id: string, data: string) => agents.write(id, data))
  ipcMain.on('agents:resize', (_, id: string, cols: number, rows: number) =>
    agents.resize(id, cols, rows)
  )

  // --- Code view ---
  ipcMain.handle('code:readFile', (_, path: string) => {
    try {
      if (statSync(path).size > 5_000_000) return { ok: false, error: 'Datei ist zu groß (> 5 MB)' }
      return { ok: true, content: readFileSync(path, 'utf8') }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.handle('code:openInVSCode', (_, path: string, line: number) => openInVSCode(path, line))
  ipcMain.handle('code:snippets', () => agents.snippets())
  ipcMain.handle('code:edits', () => agents.edits())
  ipcMain.handle('clipboard:writeText', (_, text: string) => clipboard.writeText(String(text)))
  // Electron 44: clipboard is asynchronous (W3C style); images are available as image/png
  ipcMain.handle('clipboard:read', async () => ({
    text: await clipboard.readText(),
    hasImage: await clipboard.has('image/png')
  }))

  // --- Ctrl+G editor tab ---
  ipcMain.handle('editor:text', (_, id: string) => agents.editorText(id))
  ipcMain.handle('editor:finish', (_, id: string, text: string | null, submit: boolean) =>
    agents.finishEditor(id, typeof text === 'string' ? text : null, submit === true)
  )
  ipcMain.handle('editor:saveImage', (_, id: string, ext: string, data: ArrayBuffer) =>
    agents.saveEditorImage(id, ext, data)
  )
  ipcMain.handle('editor:pickFiles', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Bilder oder Dateien anhängen',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Bilder', extensions: Object.keys(IMAGE_TYPES) },
        { name: 'Alle Dateien', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })
  // Preview image as data: URL (image files only, limited size)
  ipcMain.handle('editor:imagePreview', (_, path: string) => {
    const type = IMAGE_TYPES[String(path).split('.').pop()?.toLowerCase() ?? '']
    try {
      if (!type || statSync(path).size > 15_000_000) return null
      return `data:${type};base64,${readFileSync(path).toString('base64')}`
    } catch {
      return null
    }
  })

  // --- Voice ---
  ipcMain.handle('voice:status', () => voiceStatus())
  ipcMain.handle('voice:download', (_, model: WhisperModelId) =>
    downloadVoice(model, (p) => send('voice:progress', p))
  )
  ipcMain.handle('voice:deleteModel', (_, model: WhisperModelId) => deleteModel(model))
  ipcMain.handle('voice:transcribe', (_, wav: ArrayBuffer) => transcribe(wav))
  ipcMain.handle('voice:command', async (_, text: string) => {
    const result = await runVoiceCommand(text, agents)
    if (mainWindow && !mainWindow.isFocused() && Notification.isSupported()) {
      const body =
        result.kind === 'sent'
          ? `→ ${result.agentName}: ${result.message}`
          : result.kind === 'started'
            ? `${result.agentName} gestartet (${result.projectName})`
            : result.kind === 'teamStarted'
              ? `Team ${result.teamName} gestartet (${result.projectName}): ${result.agentNames.join(', ')}`
              : result.message
      new Notification({ title: 'DevHub', body }).show()
    }
    return result
  })

  // --- View (restored on next start) ---
  ipcMain.handle('view:get', () => getState().view)
  ipcMain.handle('view:set', (_, selection: Selection) => {
    const next = isSelection(selection) ? selection : null
    if (JSON.stringify(next) !== JSON.stringify(getState().view)) {
      updateState((s) => (s.view = next))
    }
  })

  // --- Settings ---
  ipcMain.handle('settings:get', () => getState().settings)
  ipcMain.handle('settings:update', (_, patch: Partial<Settings>) => {
    const current = getState().settings
    const next = { ...current, ...patch }
    if (patch.voiceRememberLanguage === false) next.voiceLanguage = null // turning off = forget
    if (patch.agentArgs !== undefined) {
      const argsError = validateAgentArgs(patch.agentArgs)
      if (argsError) throw new Error(`Start-Flags: ${argsError}`)
      next.agentArgs = patch.agentArgs.trim()
    }
    if (patch.projectFileApp !== undefined) {
      next.projectFileApp = patch.projectFileApp.trim()
      const programError = validateProgram(next.projectFileApp)
      if (programError) throw new Error(programError)
    }
    if (patch.folderApp !== undefined) {
      next.folderApp = patch.folderApp.trim()
      const programError = validateProgram(next.folderApp)
      if (programError) throw new Error(programError)
    }
    if (
      patch.hotkeyAgentVoice !== undefined ||
      patch.hotkeyGlobalVoice !== undefined ||
      patch.hotkeyEditor !== undefined
    ) {
      const keys = [next.hotkeyAgentVoice, next.hotkeyGlobalVoice, next.hotkeyEditor]
      if (keys.some((k) => !k)) throw new Error('Kürzel fehlt')
      if (new Set(keys.map((k) => k.toLowerCase())).size < keys.length)
        throw new Error('Dieses Kürzel ist schon für eine andere Aktion vergeben')
    }
    if (next.hotkeyGlobalVoice !== current.hotkeyGlobalVoice) {
      if (!registerGlobalHotkey(next.hotkeyGlobalVoice)) {
        registerGlobalHotkey(current.hotkeyGlobalVoice)
        throw new Error(
          `Das Kürzel ${next.hotkeyGlobalVoice} ist ungültig oder von einer anderen Anwendung belegt`
        )
      }
    }
    const number = (v: unknown, min: number, max: number, label: string): number => {
      const n = Number(v)
      if (!Number.isFinite(n) || n < min || n > max)
        throw new Error(`${label}: Wert zwischen ${min} und ${max} erwartet`)
      return n
    }
    next.contextWarnTokens = Math.round(
      number(next.contextWarnTokens, 0, 5_000_000, 'Kontext-Warnung')
    )
    next.priceInput = number(next.priceInput, 0, 10_000, 'Preis Eingabe')
    next.priceOutput = number(next.priceOutput, 0, 10_000, 'Preis Ausgabe')
    next.remotePort = Math.round(number(next.remotePort, 1024, 65535, 'Port'))
    // Geheimer Adressteil entsteht beim ersten Einschalten; leeren = neu erzeugen (alte Links verfallen)
    if (next.remoteEnabled && !next.remoteToken)
      next.remoteToken = randomBytes(18).toString('base64url')
    updateState((s) => (s.settings = next))
    remote.apply(next)
    return getState().settings
  })
  ipcMain.handle('settings:suspendGlobalHotkey', (_, suspend: boolean) => {
    if (suspend) unregisterGlobalHotkey()
    else registerGlobalHotkey(getState().settings.hotkeyGlobalVoice)
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.devhub.app')

  // F12 opens DevTools in dev mode, Ctrl+R is disabled in the production build
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // Allow the microphone for voice control, nothing else
  session.defaultSession.setPermissionRequestHandler((_, permission, cb) =>
    cb(permission === 'media')
  )
  session.defaultSession.setPermissionCheckHandler((_, permission) => permission === 'media')

  await agents.init()
  registerIpc()
  createWindow()
  remote.apply(getState().settings)

  // System-wide hotkey for global voice commands (configurable)
  const hotkey = getState().settings.hotkeyGlobalVoice
  if (!registerGlobalHotkey(hotkey)) {
    console.warn(`[DevHub] Globaler Hotkey ${hotkey} ist ungültig oder bereits belegt.`)
  }
})

// Agents beenden, aber gespeichert lassen → Wiederherstellung beim nächsten Start
app.on('before-quit', () => {
  agents.shutdown()
  runs.stopAll()
  remote.stop()
  for (const win of previews.values()) if (!win.isDestroyed()) win.destroy()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
