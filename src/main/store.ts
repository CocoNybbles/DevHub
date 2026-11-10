import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Agent, Project, Settings } from '../shared/types'
import { DEFAULT_HOTKEYS } from '../shared/hotkeys'

/** Persistierter Zustand: Projekte, (zuletzt laufende) Agents, Einstellungen. */
interface PersistedState {
  projects: Project[]
  agents: Omit<Agent, 'status' | 'statusMessage'>[]
  settings: Settings
}

const DEFAULT_STATE: PersistedState = {
  projects: [],
  agents: [],
  settings: {
    voiceModel: null,
    voiceAutoSend: true,
    hotkeyAgentVoice: DEFAULT_HOTKEYS.agentVoice,
    hotkeyGlobalVoice: DEFAULT_HOTKEYS.globalVoice,
    agentArgs: '',
    voiceRememberLanguage: true,
    voiceLanguage: null
  }
}

export function dataDir(...parts: string[]): string {
  const dir = join(app.getPath('userData'), ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

const stateFile = (): string => join(dataDir(), 'devhub-state.json')

let state: PersistedState | null = null

export function getState(): PersistedState {
  if (state) return state
  try {
    const file = stateFile()
    const loaded = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    state = {
      ...DEFAULT_STATE,
      ...loaded,
      settings: { ...DEFAULT_STATE.settings, ...(loaded.settings ?? {}) }
    }
  } catch (e) {
    console.error('[DevHub] Zustand konnte nicht geladen werden:', e)
    state = structuredClone(DEFAULT_STATE)
  }
  return state!
}

/** Ändert den Zustand und schreibt ihn sofort (atomar über Temp-Datei). */
export function updateState(mutator: (s: PersistedState) => void): void {
  const s = getState()
  mutator(s)
  const file = stateFile()
  writeFileSync(file + '.tmp', JSON.stringify(s, null, 2), 'utf8')
  renameSync(file + '.tmp', file)
}
