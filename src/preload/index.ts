import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
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
    openProjectFile: (id) => invoke('projects:openProjectFile', id),
    openInVSCode: (id) => invoke('projects:openInVSCode', id),
    pickFolder: (defaultPath) => invoke('projects:pickFolder', defaultPath),
    pickProjectFile: (defaultPath) => invoke('projects:pickProjectFile', defaultPath)
  },
  agents: {
    list: () => invoke('agents:list'),
    restore: () => invoke('agents:restore'),
    start: (projectId, task) => invoke('agents:start', projectId, task),
    stop: (id) => invoke('agents:stop', id),
    rename: (id, name) => invoke('agents:rename', id, name),
    write: (id, data) => ipcRenderer.send('agents:write', id, data),
    sendLine: (id, text) => invoke('agents:sendLine', id, text),
    resize: (id, cols, rows) => ipcRenderer.send('agents:resize', id, cols, rows),
    buffer: (id) => invoke('agents:buffer', id),
    onData: (cb) => subscribe('agents:data', cb),
    onChanged: (cb) => subscribe('agents:changed', cb),
    onStartFailed: (cb) => subscribe('agents:startFailed', cb)
  },
  code: {
    readFile: (path) => invoke('code:readFile', path),
    openInVSCode: (path, line) => invoke('code:openInVSCode', path, line),
    onFocus: (cb) => subscribe('code:focus', cb)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
