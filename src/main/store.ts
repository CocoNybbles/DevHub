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

/** Gespeicherter Agent; `needsInput` = Hinweistext, falls er beim Beenden auf Eingabe wartete. */
export type PersistedAgent = Omit<Agent, 'status' | 'statusMessage'> & { needsInput?: string }

/** Persistierter Zustand: Projekte, (zuletzt laufende) Agents, Einstellungen. */
interface PersistedState {
  projects: Project[]
  agents: PersistedAgent[]
  settings: Settings
  /** Zuletzt gezeigte Ansicht in der Mitte */
  view: Selection
  /** Vordefinierte Agents (Vorlagen) */
  templates: AgentTemplate[]
  /** Fest definierte Teams */
  teamTemplates: TeamTemplate[]
  /** Laufende Teams (werden mit ihren Agents wiederhergestellt, leere werden entfernt) */
  teams: Team[]
  /** Zuletzt in der Ordnerauswahl benutzter Ort (übergeordneter Ordner der Wahl) */
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
    voiceFixedLanguage: null
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
    // Kopie der Standardwerte: fehlende Listen dürfen DEFAULT_STATE nicht teilen (push!)
    state = {
      ...structuredClone(DEFAULT_STATE),
      ...loaded,
      settings: { ...DEFAULT_STATE.settings, ...(loaded.settings ?? {}) }
    }
    // Ältere Stände: Pfad 3 hieß `vscodePath`
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
 * Ordnet die Einträge mit den Ids `ids` in dieser Reihenfolge an. Sie nehmen die Plätze ein,
 * die sie bisher in der Liste belegt haben; alle anderen Einträge bleiben, wo sie sind.
 * So lässt sich auch nur eine Gruppe (z. B. die Agents eines Teams) umsortieren.
 */
export function applyOrder<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const byId = new Map(list.map((x) => [x.id, x]))
  const ordered = [...new Set(ids)].filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const moved = new Set(ordered.map((x) => x.id))
  let i = 0
  return list.map((x) => (moved.has(x.id) ? ordered[i++] : x))
}

/** Ändert den Zustand und schreibt ihn sofort (atomar über Temp-Datei). */
export function updateState(mutator: (s: PersistedState) => void): void {
  const s = getState()
  mutator(s)
  const file = stateFile()
  writeFileSync(file + '.tmp', JSON.stringify(s, null, 2), 'utf8')
  renameSync(file + '.tmp', file)
}
