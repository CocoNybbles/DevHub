import { useState } from 'react'
import type { Agent, AgentTemplate, Project, Team, TeamTemplate } from '../../../shared/types'
import type { Selection } from '../App'
import { formatAccelerator } from '../../../shared/hotkeys'
import ContextMenu, { MenuItem, MenuState } from './ContextMenu'
import {
  ChevronIcon,
  CloseIcon,
  CodeIcon,
  GearIcon,
  MicIcon,
  PlayIcon,
  OpenFileIcon,
  PlusIcon,
  TeamIcon
} from './Icons'

/** „rider64.exe“ statt vollem Pfad; leer = Bezeichnung des Standardprogramms */
const programLabel = (exe: string, fallback: string): string =>
  exe ? (exe.split(/[\\/]/).pop() ?? exe) : fallback

interface Props {
  projects: Project[]
  agents: Agent[]
  /** Laufende Teams */
  teams: Team[]
  selection: Selection
  vscodeInstalled: boolean
  globalVoiceActive: boolean
  /** Kürzel für globale Sprachbefehle (Accelerator) */
  globalHotkey: string
  /** multi = Strg gehalten: Agents zum Raster hinzufügen/entfernen statt Auswahl ersetzen */
  onSelectProject: (id: string, multi: boolean) => void
  onSelectAgent: (id: string, multi: boolean) => void
  /** Klick auf ein Team: alle Mitglieder im Raster (multi: hinzufügen/entfernen) */
  onSelectTeam: (team: Team, multi: boolean) => void
  /** Vordefinierte Agents und Teams → Auswahl beim Start */
  templates: AgentTemplate[]
  teamTemplates: TeamTemplate[]
  /** templateId: aus einer Vorlage starten, sonst normaler Agent */
  onStartAgent: (projectId: string, templateId?: string) => void
  onStartTeam: (projectId: string, teamTemplateId: string) => void
  onStopTeam: (team: Team) => void
  onStopAgent: (agent: Agent) => void
  onRenameAgent: (id: string, name: string) => void
  /** Globale Einstellung „Sprachtext automatisch abschicken“ (Anzeige im Menü) */
  globalVoiceAutoSend: boolean
  /** undefined = globale Einstellung verwenden */
  onSetVoiceAutoSend: (id: string, value: boolean | undefined) => void
  onAddProject: () => void
  onEditProject: (p: Project) => void
  onRemoveProject: (p: Project) => void
  onOpenProjectFile: (p: Project) => void
  /** Globale Programme aus den Einstellungen ('' = Standard) – für die Tooltips */
  globalProjectFileApp: string
  globalFolderApp: string
  onOpenFolder: (p: Project) => void
  onGlobalVoice: () => void
  onOpenSettings: () => void
}

const STATUS_LABEL: Record<Agent['status'], string> = {
  starting: 'Startet …',
  working: 'Arbeitet',
  idle: 'Bereit',
  needsInput: 'Wartet auf Eingabe'
}

/** Linke Spalte: registrierte Projekte, ihre Teams und Agents. */
function Sidebar(props: Props): React.JSX.Element {
  const { projects, agents, teams, selection } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  /** Menüeinträge zum Starten: normaler Agent, je Vorlage ein Eintrag, je Team ein Eintrag. */
  const startItems = (projectId: string): MenuItem[] => [
    { label: 'Agent starten', action: () => props.onStartAgent(projectId) },
    ...props.templates.map((t) => ({
      label: `${t.name} starten${t.model ? ` (${t.model})` : ''}`,
      action: () => props.onStartAgent(projectId, t.id)
    })),
    ...(props.teamTemplates.length ? [{ label: 'Teams', heading: true, action: () => {} }] : []),
    ...props.teamTemplates.map((t) => ({
      label: `Team ${t.name} starten (${t.members.length})`,
      action: () => props.onStartTeam(projectId, t.id)
    }))
  ]
  const hasStartChoice = props.templates.length > 0 || props.teamTemplates.length > 0

  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const isShown = (id: string): boolean =>
    (selection?.kind === 'agent' && selection.agentId === id) ||
    (selection?.kind === 'agents' && selection.agentIds.includes(id))

  const agentRow = (a: Agent, inTeam: boolean): React.JSX.Element => (
    <div
      key={a.id}
      className={[
        'row agent-row',
        inTeam ? 'in-team' : '',
        a.status === 'needsInput' ? 'attention' : '',
        isShown(a.id) ? 'selected' : ''
      ].join(' ')}
      onClick={(e) => props.onSelectAgent(a.id, e.ctrlKey || e.metaKey)}
      onContextMenu={(e) => {
        e.preventDefault()
        const voice = (label: string, value: boolean | undefined): MenuItem => ({
          label,
          checked: a.voiceAutoSend === value,
          action: () => props.onSetVoiceAutoSend(a.id, value)
        })
        setMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: 'Umbenennen', action: () => setRenaming(a.id) },
            { label: 'Beenden', danger: true, action: () => props.onStopAgent(a) },
            { label: 'Sprach-Anweisungen', heading: true, action: () => {} },
            voice(
              `Wie global (${props.globalVoiceAutoSend ? 'abschicken' : 'nur eintragen'})`,
              undefined
            ),
            voice('Automatisch abschicken', true),
            voice('Nur ins Terminal eintragen', false)
          ]
        })
      }}
      title={`${STATUS_LABEL[a.status]}${a.statusMessage ? ` – ${a.statusMessage}` : ''}${a.model ? `\nModell: ${a.model}` : ''}\nStrg+Klick: zum Raster hinzufügen/entfernen\nRechtsklick: umbenennen, Sprach-Einstellung`}
    >
      <span className={`dot ${a.status}`} />
      {renaming === a.id ? (
        <RenameInput
          initial={a.name}
          onDone={(name) => {
            setRenaming(null)
            if (name && name !== a.name) props.onRenameAgent(a.id, name)
          }}
        />
      ) : (
        <span className="row-name">
          {a.name}
          {a.status === 'needsInput' && a.statusMessage && (
            <span className="row-sub">{a.statusMessage}</span>
          )}
        </span>
      )}
      <button
        className="icon stop-agent"
        title="Agent beenden"
        onClick={(e) => {
          e.stopPropagation()
          props.onStopAgent(a)
        }}
      >
        <CloseIcon />
      </button>
    </div>
  )

  /** Teamkopf + eingerückte Mitglieder (Reihenfolge wie beim Start, erstes = Leitung). */
  const teamGroup = (team: Team, members: Agent[]): React.JSX.Element => {
    const ids = members.map((a) => a.id)
    const allShown = selection?.kind === 'agents' && ids.every((id) => isShown(id))
    const attention = members.some((a) => a.status === 'needsInput')
    const isOpen = !collapsed.has(team.id)
    return (
      <div key={team.id} className="tree-team">
        <div
          className={['row team-row', allShown ? 'selected' : ''].join(' ')}
          onClick={(e) => props.onSelectTeam(team, e.ctrlKey || e.metaKey)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: 'Im Raster zeigen', action: () => props.onSelectTeam(team, false) },
                { label: 'Team beenden', danger: true, action: () => props.onStopTeam(team) }
              ]
            })
          }}
          title={`${team.temporary ? 'Temporäres Team' : 'Team'} „${team.name}“ – Mitglieder dürfen sich Nachrichten schicken\nLeitung: ${members[0]?.name ?? '–'}\nKlick: alle im Raster · Strg+Klick: hinzufügen/entfernen · Rechtsklick: beenden`}
        >
          <button
            className={`chevron ${isOpen ? 'open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              toggle(team.id)
            }}
          >
            <ChevronIcon />
          </button>
          <TeamIcon />
          <span className="row-name">
            {team.name}
            {team.temporary && <span className="team-tag">temporär</span>}
          </span>
          {!isOpen && attention && <span className="dot needsInput" title="Ein Agent wartet" />}
          <span className="count">{members.length}</span>
          <button
            className="icon stop-agent"
            title="Team beenden"
            onClick={(e) => {
              e.stopPropagation()
              props.onStopTeam(team)
            }}
          >
            <CloseIcon />
          </button>
        </div>
        {isOpen && <div className="team-members">{members.map((a) => agentRow(a, true))}</div>}
      </div>
    )
  }

  return (
    <aside className="pane sidebar">
      <header className="pane-header">
        <span>Projekte</span>
        <div className="header-actions">
          <button
            className={`icon ${props.globalVoiceActive ? 'recording' : ''}`}
            title={`Sprachbefehl: Agent/Team per Name ansprechen oder neu starten (${formatAccelerator(props.globalHotkey)})`}
            onClick={props.onGlobalVoice}
          >
            <MicIcon />
          </button>
          <button className="icon" title="Einstellungen" onClick={props.onOpenSettings}>
            <GearIcon />
          </button>
          <button className="icon" title="Projekt hinzufügen" onClick={props.onAddProject}>
            <PlusIcon />
          </button>
        </div>
      </header>

      <div className="tree">
        {projects.length === 0 && (
          <div className="empty muted">
            <div>
              Noch keine Projekte registriert.
              <br />
              <button className="link" onClick={props.onAddProject}>
                Projekt hinzufügen
              </button>
            </div>
          </div>
        )}

        {projects.map((p) => {
          const projectAgents = agents.filter((a) => a.projectId === p.id)
          const projectTeams = teams
            .filter((t) => t.projectId === p.id)
            .sort((a, b) => a.createdAt - b.createdAt)
          const teamIds = new Set(projectTeams.map((t) => t.id))
          // Agents ohne (bekanntes) Team stehen unter den Teams
          const loose = projectAgents.filter((a) => !a.teamId || !teamIds.has(a.teamId))
          const isOpen = !collapsed.has(p.id)
          const attention = projectAgents.some((a) => a.status === 'needsInput')
          return (
            <div key={p.id} className="tree-project">
              <div
                className={`row project-row ${selection?.kind === 'project' && selection.projectId === p.id ? 'selected' : ''}`}
                onClick={(e) => props.onSelectProject(p.id, e.ctrlKey || e.metaKey)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      ...startItems(p.id),
                      { label: 'Projekt', heading: true, action: () => {} },
                      { label: 'Bearbeiten …', action: () => props.onEditProject(p) },
                      { label: 'Entfernen', danger: true, action: () => props.onRemoveProject(p) }
                    ]
                  })
                }}
                title={`${p.agentPath}\nStrg+Klick: alle Agents zum Raster hinzufügen/entfernen`}
              >
                <button
                  className={`chevron ${isOpen ? 'open' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(p.id)
                  }}
                >
                  <ChevronIcon />
                </button>
                <span className="row-name">{p.name}</span>
                {!isOpen && attention && (
                  <span className="dot needsInput" title="Ein Agent wartet" />
                )}
                {projectAgents.length > 0 && <span className="count">{projectAgents.length}</span>}
                <span className="row-actions">
                  {p.projectFile && (
                    <button
                      className="icon"
                      title={`Projektdatei öffnen: ${p.projectFile}\nmit ${programLabel(p.projectFileApp || props.globalProjectFileApp, 'Windows-Standardprogramm')}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onOpenProjectFile(p)
                      }}
                    >
                      <OpenFileIcon />
                    </button>
                  )}
                  {p.folderPath && (
                    <button
                      className="icon"
                      title={`Ordner öffnen: ${p.folderPath}\nmit ${programLabel(
                        p.folderApp || props.globalFolderApp,
                        props.vscodeInstalled ? 'VS Code' : 'Windows-Explorer'
                      )}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onOpenFolder(p)
                      }}
                    >
                      <CodeIcon />
                    </button>
                  )}
                </span>
                <button
                  className="icon start-agent"
                  title={
                    hasStartChoice
                      ? 'Starten: Agent, vordefinierter Agent oder Team'
                      : 'Neuen Agent starten'
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    // Mit Vorlagen/Teams: Auswahl unter dem Button, sonst direkt starten
                    if (!hasStartChoice) return props.onStartAgent(p.id)
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ x: r.left, y: r.bottom + 2, items: startItems(p.id) })
                  }}
                >
                  <PlayIcon size={12} />
                </button>
              </div>

              {isOpen && (
                <>
                  {projectTeams.map((t) =>
                    teamGroup(
                      t,
                      projectAgents
                        .filter((a) => a.teamId === t.id)
                        .sort((a, b) => a.createdAt - b.createdAt)
                    )
                  )}
                  {loose.map((a) => agentRow(a, false))}
                </>
              )}
            </div>
          )
        })}
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  )
}

function RenameInput({
  initial,
  onDone
}: {
  initial: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <input
      className="rename"
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim() || null)
        if (e.key === 'Escape') onDone(null)
      }}
      maxLength={40}
    />
  )
}

export default Sidebar
