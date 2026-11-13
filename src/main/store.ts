import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  Agent,
  AgentTemplate,
  Project,
  Selection,
  Settings,
  Team,
  TeamTemplate
} from '../shared/types'
import { DEFAULT_HOTKEYS } from '../shared/hotkeys'

/** Saved agent; `needsInput` = hint text if it was waiting for input when quitting. */
export type PersistedAgent = Omit<Agent, 'status' | 'statusMessage'> & { needsInput?: string }

/** Persisted state: projects, (last running) agents, settings. */
interface PersistedState {
  projects: Project[]
  agents: PersistedAgent[]
  settings: Settings
  /** Last view shown in the center */
  view: Selection
  /** Predefined agents (templates) */
  templates: AgentTemplate[]
  /** Predefined teams */
  teamTemplates: TeamTemplate[]
  /** Running teams (restored with their agents, empty ones are removed) */
  teams: Team[]
  /** Location last used in the folder picker (parent folder of the choice) */
  lastPickDir?: string
}

const DEFAULT_STATE: PersistedState = {
  projects: [],
  agents: [],
  templates: [],
  teamTemplates: [],
  teams: [],
  view: null,
  settings: {
    voiceModel: null,
    voiceAutoSend: true,
    hotkeyAgentVoice: DEFAULT_HOTKEYS.agentVoice,
    hotkeyGlobalVoice: DEFAULT_HOTKEYS.globalVoice,
    hotkeyEditor: DEFAULT_HOTKEYS.editor,
    agentArgs: '',
    projectFileApp: '',
    folderApp: '',
    voiceRememberLanguage: true,
    voiceLanguage: null,
    voiceFixedLanguage: null,
    showEditedFiles: true
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
    // Copy of the defaults: missing lists must not share DEFAULT_STATE (push!)
    state = {
      ...structuredClone(DEFAULT_STATE),
      ...loaded,
      settings: { ...DEFAULT_STATE.settings, ...(loaded.settings ?? {}) }
    }
    // Older states: path 3 was called `vscodePath`
    for (const p of state!.projects as (Project & { vscodePath?: string })[]) {
      if (p.vscodePath !== undefined) {
        p.folderPath ??= p.vscodePath
        delete p.vscodePath
      }
    }
  } catch (e) {
    console.error('[DevHub] Zustand konnte nicht geladen werden:', e)
    state = structuredClone(DEFAULT_STATE)
  }
  return state!
}

/**
 * Arranges the entries with the ids `ids` in this order. They take the slots they
 * previously occupied in the list; all other entries stay where they are.
 * This also allows reordering just one group (e.g. the agents of a team).
 */
export function applyOrder<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const byId = new Map(list.map((x) => [x.id, x]))
  const ordered = [...new Set(ids)].filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const moved = new Set(ordered.map((x) => x.id))
  let i = 0
  return list.map((x) => (moved.has(x.id) ? ordered[i++] : x))
}

/** Updates the state and writes it immediately (atomically via a temp file). */
export function updateState(mutator: (s: PersistedState) => void): void {
  const s = getState()
  mutator(s)
  const file = stateFile()
  writeFileSync(file + '.tmp', JSON.stringify(s, null, 2), 'utf8')
  renameSync(file + '.tmp', file)
}
