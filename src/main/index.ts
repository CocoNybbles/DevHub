import './dataPath' // muss zuerst laufen: legt den Datenordner neben der .exe fest
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
import { join } from 'path'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type {
  AgentTemplate,
  AgentTemplateInput,
  Project,
  ProjectInput,
  Selection,
  Settings,
  TeamTemplate,
  TeamTemplateInput,
  WhisperModelId
} from '../shared/types'
import { checkClaudeAuth, startClaudeLogin } from './claudeAuth'
import { AgentManager } from './agents'
import { applyOrder, getState, updateState } from './store'
import {
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

// Nur eine Instanz: zwei würden dieselben Agents (Sessions) wiederherstellen und denselben
// Datenordner beschreiben. Ein zweiter Start holt stattdessen das vorhandene Fenster nach vorn.
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

/** Sendet ein Ereignis an die Oberfläche (falls das Fenster existiert). */
function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const agents = new AgentManager({
  onData: (id, data) => send('agents:data', id, data),
  onChanged: (list, teams) => send('agents:changed', list, teams),
  onCodeFocus: (focus) => send('code:focus', focus),
  onSnippets: (id, snippets) => send('code:snippets', id, snippets),
  onStartFailed: (name, output) => send('agents:startFailed', name, output),
  onEditorOpened: (id, text) => {
    send('editor:opened', id, text)
    // Fenster nach vorn holen: Strg+G kommt aus dem Terminal, der Tab soll sofort sichtbar sein
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.show()
  },
  onEditorAppend: (id, text) => send('editor:append', id, text)
})

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

/** Grobe Formprüfung einer Ansicht aus dem Renderer, bevor sie gespeichert wird. */
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
    if (input.folderPath && !existsSync(input.folderPath))
      throw new Error('Ordner (Pfad 3) existiert nicht')
    const argsError = validateAgentArgs(input.agentArgs)
    if (argsError) throw new Error(`Start-Flags: ${argsError}`)
    const programError =
      validateProgram(input.projectFileApp?.trim()) ?? validateProgram(input.folderApp?.trim())
    if (programError) throw new Error(programError)

    const saved = {
      id: input.id ?? randomUUID(),
      name,
      agentPath: input.agentPath,
      projectFile: input.projectFile || undefined,
      projectFileApp: input.projectFileApp?.trim() || undefined,
      folderPath: input.folderPath || undefined,
      folderApp: input.folderApp?.trim() || undefined,
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
  ipcMain.handle('projects:reorder', (_, ids: string[]) => {
    updateState((s) => (s.projects = applyOrder(s.projects, ids)))
    return getState().projects
  })
  ipcMain.handle('projects:openProjectFile', async (_, id: string) => {
    const p = project(id)
    if (!p.projectFile) return
    if (!existsSync(p.projectFile)) throw new Error(`Projektdatei nicht gefunden: ${p.projectFile}`)
    // Programm: Projekt → global → Windows-Standardprogramm für die Dateiendung
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
    // Programm: Projekt → global → VS Code (falls installiert) → Windows-Explorer
    const program = p.folderApp || getState().settings.folderApp
    if (program) return openWithProgram(program, p.folderPath)
    if (await isVSCodeInstalled()) return openInVSCode(p.folderPath)
    const err = await shell.openPath(p.folderPath)
    if (err) throw new Error(err)
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

  // --- Vorlagen (vordefinierte Agents) ---
  ipcMain.handle('templates:list', () => getState().templates)
  ipcMain.handle('templates:save', (_, input: AgentTemplateInput) => {
    const name = input.name?.trim().replace(/\s+/g, ' ')
    if (!name) throw new Error('Name fehlt')
    // „Agent 3“ o. Ä. kollidiert mit den automatisch vergebenen Namen
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
    // Laufende Agents behalten ihren Namen, starten danach aber ohne Vorlage
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
    // Laufende Teams bleiben bestehen, verlieren aber die gemeinsamen Richtlinien
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
  ipcMain.handle('agents:start', (_, projectId: string, task?: string, templateId?: string) =>
    agents.start(projectId, task, undefined, templateId)
  )
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
  ipcMain.handle('code:snippets', () => agents.snippets())
  ipcMain.handle('clipboard:writeText', (_, text: string) => clipboard.writeText(String(text)))

  // --- Strg+G-Editor-Tab ---
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
  // Vorschaubild als data:-URL (nur Bilddateien, begrenzte Größe)
  ipcMain.handle('editor:imagePreview', (_, path: string) => {
    const type = IMAGE_TYPES[String(path).split('.').pop()?.toLowerCase() ?? '']
    try {
      if (!type || statSync(path).size > 15_000_000) return null
      return `data:${type};base64,${readFileSync(path).toString('base64')}`
    } catch {
      return null
    }
  })

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
            : result.kind === 'teamStarted'
              ? `Team ${result.teamName} gestartet (${result.projectName}): ${result.agentNames.join(', ')}`
              : result.message
      new Notification({ title: 'DevHub', body }).show()
    }
    return result
  })

  // --- Ansicht (wird beim nächsten Start wiederhergestellt) ---
  ipcMain.handle('view:get', () => getState().view)
  ipcMain.handle('view:set', (_, selection: Selection) => {
    const next = isSelection(selection) ? selection : null
    if (JSON.stringify(next) !== JSON.stringify(getState().view)) {
      updateState((s) => (s.view = next))
    }
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
