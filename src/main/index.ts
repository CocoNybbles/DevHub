import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  globalShortcut,
  session,
  Notification
} from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { Project, ProjectInput, Settings, WhisperModelId } from '../shared/types'
import { checkClaudeAuth, startClaudeLogin } from './claudeAuth'
import { AgentManager } from './agents'
import { getState, updateState } from './store'
import { findSolution, isVSCodeInstalled, openInVSCode } from './tools'
import { deleteModel, downloadVoice, transcribe, voiceStatus } from './voice'
import { runVoiceCommand } from './voiceCommands'
import { validateAgentArgs } from '../shared/agentArgs'

let mainWindow: BrowserWindow | null = null

/** Sendet ein Ereignis an die Oberfläche (falls das Fenster existiert). */
function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const agents = new AgentManager({
  onData: (id, data) => send('agents:data', id, data),
  onChanged: (list) => send('agents:changed', list),
  onCodeFocus: (focus) => send('code:focus', focus),
  onStartFailed: (name, output) => send('agents:startFailed', name, output)
})

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

  // Entwicklungshilfe: DEVHUB_SCREENSHOT=<datei.png> speichert nach DEVHUB_SCREENSHOT_DELAY ms (Standard 8000) ein Bild des Fensters
  const shot = process.env.DEVHUB_SCREENSHOT
  if (shot) {
    mainWindow.webContents.once('did-finish-load', () =>
      setTimeout(
        async () => {
          if (!mainWindow) return
          // Fenster nach vorn holen, sonst liefert Chromium ggf. ein veraltetes Bild
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

/** Aktuell registriertes globales Kürzel (Sprachbefehl), null = keins. */
let globalHotkey: string | null = null

function unregisterGlobalHotkey(): void {
  if (globalHotkey) globalShortcut.unregister(globalHotkey)
  globalHotkey = null
}

/** Ersetzt das globale Kürzel. false, wenn es ungültig oder bereits systemweit belegt ist. */
function registerGlobalHotkey(accelerator: string): boolean {
  unregisterGlobalHotkey()
  try {
    if (!globalShortcut.register(accelerator, () => send('voice:globalHotkey'))) return false
  } catch {
    return false // ungültiger Accelerator
  }
  globalHotkey = accelerator
  return true
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

  // --- Werkzeuge ---
  ipcMain.handle('tools:vscodeInstalled', () => isVSCodeInstalled())

  // --- Projekte ---
  ipcMain.handle('projects:list', () => getState().projects)
  ipcMain.handle('projects:save', async (_, input: ProjectInput) => {
    const name = input.name?.trim()
    if (!name) throw new Error('Name fehlt')
    if (!input.agentPath || !existsSync(input.agentPath))
      throw new Error('Agent-Pfad existiert nicht')
    if (input.projectFile && !existsSync(input.projectFile))
      throw new Error('Projektdatei existiert nicht')
    if (input.vscodePath && !(await isVSCodeInstalled()))
      throw new Error('VS Code ist nicht installiert')
    if (input.vscodePath && !existsSync(input.vscodePath))
      throw new Error('VS-Code-Ordner existiert nicht')
    const argsError = validateAgentArgs(input.agentArgs)
    if (argsError) throw new Error(`Start-Flags: ${argsError}`)

    const saved = {
      id: input.id ?? randomUUID(),
      name,
      agentPath: input.agentPath,
      projectFile: input.projectFile || undefined,
      vscodePath: input.vscodePath || undefined,
      agentArgs: input.agentArgs?.trim() || undefined
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
    updateState((s) => {
      s.projects = s.projects.filter((p) => p.id !== id)
      s.agents = s.agents.filter((a) => a.projectId !== id)
    })
  })
  ipcMain.handle('projects:openProjectFile', async (_, id: string) => {
    const file = project(id).projectFile
    if (!file) return
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  })
  ipcMain.handle('projects:openInVSCode', (_, id: string) => {
    const dir = project(id).vscodePath
    if (dir) openInVSCode(dir)
  })
  ipcMain.handle('projects:pickFolder', async (_, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      defaultPath
    })
    return r.canceled ? null : r.filePaths[0]
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

  // --- Agents ---
  ipcMain.handle('agents:list', () => agents.list())
  ipcMain.handle('agents:restore', () => agents.restore())
  ipcMain.handle('agents:start', (_, projectId: string, task?: string) =>
    agents.start(projectId, task)
  )
  ipcMain.handle('agents:stop', (_, id: string) => agents.stop(id))
  ipcMain.handle('agents:rename', (_, id: string, name: string) => agents.rename(id, name))
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

  // --- Code-Ansicht ---
  ipcMain.handle('code:readFile', (_, path: string) => {
    try {
      if (statSync(path).size > 5_000_000) return { ok: false, error: 'Datei ist zu groß (> 5 MB)' }
      return { ok: true, content: readFileSync(path, 'utf8') }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  ipcMain.handle('code:openInVSCode', (_, path: string, line: number) => openInVSCode(path, line))

  // --- Sprache ---
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
            : result.message
      new Notification({ title: 'DevHub', body }).show()
    }
    return result
  })

  // --- Einstellungen ---
  ipcMain.handle('settings:get', () => getState().settings)
  ipcMain.handle('settings:update', (_, patch: Partial<Settings>) => {
    const current = getState().settings
    const next = { ...current, ...patch }
    if (patch.voiceRememberLanguage === false) next.voiceLanguage = null // ausschalten = vergessen
    if (patch.agentArgs !== undefined) {
      const argsError = validateAgentArgs(patch.agentArgs)
      if (argsError) throw new Error(`Start-Flags: ${argsError}`)
      next.agentArgs = patch.agentArgs.trim()
    }
    if (patch.hotkeyAgentVoice !== undefined || patch.hotkeyGlobalVoice !== undefined) {
      if (!next.hotkeyAgentVoice || !next.hotkeyGlobalVoice) throw new Error('Kürzel fehlt')
      if (next.hotkeyAgentVoice.toLowerCase() === next.hotkeyGlobalVoice.toLowerCase())
        throw new Error('Beide Sprach-Kürzel sind gleich')
    }
    if (next.hotkeyGlobalVoice !== current.hotkeyGlobalVoice) {
      if (!registerGlobalHotkey(next.hotkeyGlobalVoice)) {
        registerGlobalHotkey(current.hotkeyGlobalVoice)
        throw new Error(
          `Das Kürzel ${next.hotkeyGlobalVoice} ist ungültig oder von einer anderen Anwendung belegt`
        )
      }
    }
    updateState((s) => (s.settings = next))
    return getState().settings
  })
  ipcMain.handle('settings:suspendGlobalHotkey', (_, suspend: boolean) => {
    if (suspend) unregisterGlobalHotkey()
    else registerGlobalHotkey(getState().settings.hotkeyGlobalVoice)
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.devhub.app')

  // F12 öffnet DevTools im Dev-Modus, Strg+R ist im Produktivbuild deaktiviert
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // Mikrofon für die Sprachsteuerung erlauben, sonst nichts
  session.defaultSession.setPermissionRequestHandler((_, permission, cb) =>
    cb(permission === 'media')
  )
  session.defaultSession.setPermissionCheckHandler((_, permission) => permission === 'media')

  await agents.init()
  registerIpc()
  createWindow()

  // Systemweiter Hotkey für globale Sprachbefehle (einstellbar)
  const hotkey = getState().settings.hotkeyGlobalVoice
  if (!registerGlobalHotkey(hotkey)) {
    console.warn(`[DevHub] Globaler Hotkey ${hotkey} ist ungültig oder bereits belegt.`)
  }
})

// Agents beenden, aber gespeichert lassen → Wiederherstellung beim nächsten Start
app.on('before-quit', () => agents.shutdown())
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
