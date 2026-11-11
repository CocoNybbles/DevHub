import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { DevHubApi } from '../shared/types'

/** Abonniert ein Ereignis aus dem Hauptprozess und liefert eine Abmelde-Funktion. */
function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: DevHubApi = {
  claude: {
    checkAuth: () => invoke('claude:checkAuth'),
    startLogin: () => invoke('claude:startLogin')
  },
  tools: {
    vscodeInstalled: () => invoke('tools:vscodeInstalled')
  },
  projects: {
    list: () => invoke('projects:list'),
    save: (input) => invoke('projects:save', input),
    remove: (id) => invoke('projects:remove', id),
    reorder: (ids) => invoke('projects:reorder', ids),
    pickFolders: () => invoke('projects:pickFolders'),
    scan: (dirs) => invoke('projects:scan', dirs),
    openProjectFile: (id) => invoke('projects:openProjectFile', id),
    openFolder: (id) => invoke('projects:openFolder', id),
    pickFolder: (defaultPath) => invoke('projects:pickFolder', defaultPath),
    pickProjectFile: (defaultPath) => invoke('projects:pickProjectFile', defaultPath),
    findSolution: (dir) => invoke('projects:findSolution', dir),
    pickProgram: (defaultPath) => invoke('projects:pickProgram', defaultPath)
  },
  agents: {
    list: () => invoke('agents:list'),
    restore: () => invoke('agents:restore'),
    start: (projectId, task, templateId) => invoke('agents:start', projectId, task, templateId),
    stop: (id) => invoke('agents:stop', id),
    rename: (id, name) => invoke('agents:rename', id, name),
    reorder: (ids) => invoke('agents:reorder', ids),
    write: (id, data) => ipcRenderer.send('agents:write', id, data),
    sendLine: (id, text) => invoke('agents:sendLine', id, text),
    sendVoice: (id, text) => invoke('agents:sendVoice', id, text),
    setVoiceAutoSend: (id, value) => invoke('agents:setVoiceAutoSend', id, value),
    resize: (id, cols, rows) => ipcRenderer.send('agents:resize', id, cols, rows),
    buffer: (id) => invoke('agents:buffer', id),
    onData: (cb) => subscribe('agents:data', cb),
    onChanged: (cb) => subscribe('agents:changed', cb),
    onStartFailed: (cb) => subscribe('agents:startFailed', cb)
  },
  code: {
    readFile: (path) => invoke('code:readFile', path),
    openInVSCode: (path, line) => invoke('code:openInVSCode', path, line),
    onFocus: (cb) => subscribe('code:focus', cb),
    snippets: () => invoke('code:snippets'),
    onSnippets: (cb) => subscribe('code:snippets', cb)
  },
  clipboard: {
    writeText: (text) => invoke('clipboard:writeText', text)
  },
  editor: {
    text: (id) => invoke('editor:text', id),
    finish: (id, text, submit) => invoke('editor:finish', id, text, submit),
    saveImage: (id, ext, data) => invoke('editor:saveImage', id, ext, data),
    pickFiles: () => invoke('editor:pickFiles'),
    imagePreview: (path) => invoke('editor:imagePreview', path),
    pathForFile: (file) => webUtils.getPathForFile(file),
    onOpened: (cb) => subscribe('editor:opened', cb),
    onAppend: (cb) => subscribe('editor:append', cb)
  },
  voice: {
    status: () => invoke('voice:status'),
    download: (model) => invoke('voice:download', model),
    deleteModel: (model) => invoke('voice:deleteModel', model),
    onProgress: (cb) => subscribe('voice:progress', cb),
    transcribe: (wav) => invoke('voice:transcribe', wav),
    command: (text) => invoke('voice:command', text),
    onGlobalHotkey: (cb) => subscribe('voice:globalHotkey', cb)
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    suspendGlobalHotkey: (suspend) => invoke('settings:suspendGlobalHotkey', suspend)
  },
  teams: {
    list: () => invoke('teams:list'),
    start: (projectId, teamTemplateId, task) =>
      invoke('teams:start', projectId, teamTemplateId, task),
    stop: (teamId) => invoke('teams:stop', teamId)
  },
  teamTemplates: {
    list: () => invoke('teamTemplates:list'),
    save: (input) => invoke('teamTemplates:save', input),
    remove: (id) => invoke('teamTemplates:remove', id)
  },
  templates: {
    list: () => invoke('templates:list'),
    save: (input) => invoke('templates:save', input),
    remove: (id) => invoke('templates:remove', id)
  },
  view: {
    get: () => invoke('view:get'),
    set: (selection) => invoke('view:set', selection)
  }
}

contextBridge.exposeInMainWorld('api', api)
