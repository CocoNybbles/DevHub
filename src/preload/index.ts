import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type { DevHubApi } from '../shared/types'

/** Subscribes to an event from the main process and returns an unsubscribe function. */
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
    start: (projectId, options) => invoke('agents:start', projectId, options),
    fork: (id) => invoke('agents:fork', id),
    enqueue: (id, text) => invoke('agents:enqueue', id, text),
    dequeue: (id, queueId) => invoke('agents:dequeue', id, queueId),
    activityLog: (id) => invoke('agents:activityLog', id),
    onFocusRequest: (cb) => subscribe('agents:focusRequest', cb),
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
    onSnippets: (cb) => subscribe('code:snippets', cb),
    edits: () => invoke('code:edits'),
    onEdits: (cb) => subscribe('code:edits', cb),
    onPlan: (cb) => subscribe('code:plan', cb),
    onShowDiff: (cb) => subscribe('code:showDiff', cb)
  },
  inbox: {
    permissions: () => invoke('inbox:permissions'),
    answer: (id, answer, message) => invoke('inbox:answer', id, answer, message),
    onPermissions: (cb) => subscribe('inbox:permissions', cb),
    onNotice: (cb) => subscribe('inbox:notice', cb)
  },
  tasks: {
    list: () => invoke('tasks:list'),
    save: (input) => invoke('tasks:save', input),
    remove: (id) => invoke('tasks:remove', id),
    setStatus: (id, status) => invoke('tasks:setStatus', id, status),
    start: (id, templateId) => invoke('tasks:start', id, templateId),
    assign: (id, agentId) => invoke('tasks:assign', id, agentId),
    onChanged: (cb) => subscribe('tasks:changed', cb)
  },
  history: {
    list: () => invoke('history:list'),
    remove: (id) => invoke('history:remove', id),
    resume: (id, fork) => invoke('history:resume', id, fork),
    search: (query) => invoke('history:search', query)
  },
  git: {
    targets: (projectId) => invoke('git:targets', projectId),
    changes: (projectId, targetId) => invoke('git:changes', projectId, targetId),
    diff: (projectId, targetId, path) => invoke('git:diff', projectId, targetId, path),
    saveFile: (projectId, targetId, path, content) =>
      invoke('git:saveFile', projectId, targetId, path, content),
    discard: (projectId, targetId, path) => invoke('git:discard', projectId, targetId, path),
    commit: (projectId, targetId, message, paths) =>
      invoke('git:commit', projectId, targetId, message, paths),
    merge: (projectId, targetId) => invoke('git:merge', projectId, targetId),
    removeWorktree: (projectId, targetId, force) =>
      invoke('git:removeWorktree', projectId, targetId, force)
  },
  runs: {
    list: (projectId) => invoke('runs:list', projectId),
    start: (projectId, name) => invoke('runs:start', projectId, name),
    stop: (projectId, name) => invoke('runs:stop', projectId, name),
    output: (projectId, name) => invoke('runs:output', projectId, name),
    onChanged: (cb) => subscribe('runs:changed', cb),
    onOutput: (cb) => subscribe('runs:output', cb)
  },
  preview: {
    open: (projectId) => invoke('preview:open', projectId),
    screenshot: (projectId, agentId) => invoke('preview:screenshot', projectId, agentId)
  },
  prompts: {
    list: () => invoke('prompts:list'),
    save: (input) => invoke('prompts:save', input),
    remove: (id) => invoke('prompts:remove', id)
  },
  engines: {
    list: () => invoke('engines:list'),
    save: (input) => invoke('engines:save', input),
    remove: (id) => invoke('engines:remove', id)
  },
  reports: {
    daily: (projectId) => invoke('reports:daily', projectId)
  },
  remote: {
    info: () => invoke('remote:info')
  },
  clipboard: {
    writeText: (text) => invoke('clipboard:writeText', text),
    read: () => invoke('clipboard:read')
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
    onGlobalHotkey: (cb) => subscribe('voice:globalHotkey', cb),
    onSpeak: (cb) => subscribe('voice:speak', cb)
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
