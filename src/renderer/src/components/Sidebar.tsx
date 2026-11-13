import { useState } from 'react'
import type { Agent, AgentTemplate, Project, Team, TeamTemplate } from '../../../shared/types'
import { isTeamWorker, teamLead } from '../../../shared/types'
import type { Selection } from '../App'
import { formatAccelerator } from '../../../shared/hotkeys'
import ContextMenu, { MenuItem, MenuState } from './ContextMenu'
import {
  ChevronIcon,
  ClearIcon,
  CloseIcon,
  CodeIcon,
  EditIcon,
  EyeIcon,
  FolderImportIcon,
  GearIcon,
  MicIcon,
  PlayIcon,
  OpenFileIcon,
  PlusIcon,
  SortIcon,
  TeamIcon
} from './Icons'

/** "rider64.exe" instead of the full path; empty = label of the default program */
const programLabel = (exe: string, fallback: string): string =>
  exe ? (exe.split(/[\\/]/).pop() ?? exe) : fallback

/** Alphanumeric ascending: "Agent 2" before "Agent 10", case-insensitive */
const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' })

/** Ids of a group after moving `moved` before/after `target` */
function moveId(ids: string[], moved: string, target: string, after: boolean): string[] {
  const rest = ids.filter((id) => id !== moved)
  const i = rest.indexOf(target)
  if (i < 0) return ids
  rest.splice(after ? i + 1 : i, 0, moved)
  return rest
}

/** Orchestrator of a team (older teams without orchestrator: first started member) */
const leadOf = (members: Agent[]): Agent | undefined =>
  members[0]?.teamId ? teamLead(members, members[0].teamId) : undefined

interface Props {
  projects: Project[]
  agents: Agent[]
  /** Running teams */
  teams: Team[]
  selection: Selection
  vscodeInstalled: boolean
  globalVoiceActive: boolean
  /** Shortcut for global voice commands (accelerator) */
  globalHotkey: string
  /** multi = Ctrl held: add/remove agents to/from the grid instead of replacing the selection */
  onSelectProject: (id: string, multi: boolean) => void
  onSelectAgent: (id: string, multi: boolean) => void
  /** Click on a team: all members in the grid (multi: add/remove) */
  onSelectTeam: (team: Team, multi: boolean) => void
  /** Predefined agents and teams → choice when starting */
  templates: AgentTemplate[]
  teamTemplates: TeamTemplate[]
  /** templateId: start from a template, otherwise a normal agent */
  onStartAgent: (projectId: string, templateId?: string) => void
  onStartTeam: (projectId: string, teamTemplateId: string) => void
  onStopTeam: (team: Team) => void
  onStopAgent: (agent: Agent) => void
  onRenameAgent: (id: string, name: string) => void
  /** Voice instruction to exactly this agent */
  onAgentVoiceFor: (id: string) => void
  /** Send `/clear` to the agent */
  onClearAgent: (id: string) => void
  /** A recording is running for this agent */
  recordingAgentId: string | null
  /** Write an instruction in the editor tab (or switch to the open tab) */
  onEditPrompt: (id: string) => void
  /** Shortcut for it (accelerator, for display) */
  editorHotkey: string
  /** New order of all projects (ids) */
  onReorderProjects: (ids: string[]) => void
  /** New order of an agent group (project without team, or team) */
  onReorderAgents: (ids: string[]) => void
  /** Global setting "auto-send voice text" (shown in the menu) */
  globalVoiceAutoSend: boolean
  /** undefined = use the global setting */
  onSetVoiceAutoSend: (id: string, value: boolean | undefined) => void
  onAddProject: () => void
  /** Import projects from (multiple) folders */
  onImportProjects: () => void
  onEditProject: (p: Project) => void
  onRemoveProject: (p: Project) => void
  onOpenProjectFile: (p: Project) => void
  /** Global programs from the settings ('' = default) – for the tooltips */
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

/** Left column: registered projects, their teams and agents. */
function Sidebar(props: Props): React.JSX.Element {
  const { projects, agents, teams, selection } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /** Dragged row; `group` = can only be dropped within this group */
  const [drag, setDrag] = useState<{ group: string; id: string } | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)

  /**
   * Drag & drop for a row. `group`: projects, or agents of a project (without team) /
   * of a team – rows only move within the same group. `ids` = group in display order.
   */
  const dnd = (
    group: string,
    id: string,
    ids: string[],
    onReorder: (ids: string[]) => void,
    enabled = true
  ): React.HTMLAttributes<HTMLDivElement> & { draggable: boolean; className: string } => ({
    draggable: enabled,
    className: [
      drag?.id === id ? 'dragging' : '',
      drop?.id === id ? (drop.after ? 'drop-after' : 'drop-before') : ''
    ].join(' '),
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
      setDrag({ group, id })
    },
    onDragOver: (e) => {
      if (drag?.group !== group) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const r = e.currentTarget.getBoundingClientRect()
      const after = e.clientY > r.top + r.height / 2
      if (drag.id === id) return setDrop(null)
      if (drop?.id !== id || drop.after !== after) setDrop({ id, after })
    },
    onDrop: (e) => {
      e.preventDefault()
      if (drag?.group === group && drop && drag.id !== drop.id) {
        const next = moveId(ids, drag.id, drop.id, drop.after)
        if (next.join() !== ids.join()) onReorder(next)
      }
      setDrag(null)
      setDrop(null)
    },
    onDragEnd: () => {
      setDrag(null)
      setDrop(null)
    }
  })

  /** Menu entries for starting: normal agent, one entry per template, one entry per team. */
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

  /** `group`/`groupIds`: agents that can be reordered among each other via drag & drop */
  const agentRow = (
    a: Agent,
    group: string,
    groupIds: string[],
    lead = false
  ): React.JSX.Element => {
    const d = dnd(group, a.id, groupIds, props.onReorderAgents, renaming !== a.id)
    const worker = isTeamWorker(a)
    const orchestrator = a.teamRole === 'orchestrator'
    const hint = worker
      ? 'Teammitglied – nur beobachten; Anweisungen gehen an den Orchestrator\nStrg+Klick: zum Raster hinzufügen/entfernen\nZiehen: Reihenfolge ändern'
      : 'Strg+Klick: zum Raster hinzufügen/entfernen\nZiehen: Reihenfolge ändern\nRechtsklick: umbenennen, Sprach-Einstellung'
    return (
      <div
        key={a.id}
        {...d}
        className={[
          'row agent-row',
          group.startsWith('team:') ? 'in-team' : '',
          a.status === 'needsInput' ? 'attention' : '',
          isShown(a.id) ? 'selected' : '',
          a.editing ? 'editing' : '',
          worker ? 'watch-only' : '',
          d.className
        ].join(' ')}
        onClick={(e) => props.onSelectAgent(a.id, e.ctrlKey || e.metaKey)}
        onContextMenu={(e) => {
          e.preventDefault()
          // Worker: observe only – no renaming, no instructions, no stopping individually
          if (worker) return
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
              {
                label: a.editing
                  ? 'Zum Editor-Tab'
                  : `Anweisung im Tab schreiben (${formatAccelerator(props.editorHotkey)})`,
                action: () => props.onEditPrompt(a.id)
              },
              {
                label: orchestrator ? 'Team beenden' : 'Beenden',
                danger: true,
                action: () => props.onStopAgent(a)
              },
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
        title={`${STATUS_LABEL[a.status]}${a.statusMessage ? ` – ${a.statusMessage}` : ''}${a.model ? `\nModell: ${a.model}` : ''}${orchestrator ? '\nOrchestrator: steuert das Team, einziger Ansprechpartner' : lead ? '\nLeitet das Team' : ''}\n${hint}`}
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
            {orchestrator ? (
              <span className="team-tag">Orchestrator</span>
            ) : (
              lead && <span className="team-tag">Leitung</span>
            )}
            {worker && (
              <span className="watch-tag" title="Nur beobachten">
                <EyeIcon size={11} />
              </span>
            )}
            {a.editing && (
              <span
                className="team-tag"
                title="Anweisung wird im Editor-Tab geschrieben – Klick wechselt dorthin"
              >
                <EditIcon size={10} /> Tab
              </span>
            )}
            {a.status === 'needsInput' && a.statusMessage && (
              <span className="row-sub">{a.statusMessage}</span>
            )}
          </span>
        )}
        {!worker && (
          <span className="agent-actions">
            <button
              className="icon row-btn"
              title={
                a.editing
                  ? 'Zum Editor-Tab'
                  : `Anweisung in einem Tab schreiben – mit Bildern und Diktat (${formatAccelerator(props.editorHotkey)})`
              }
              onClick={(e) => {
                e.stopPropagation()
                props.onEditPrompt(a.id)
              }}
            >
              <EditIcon size={12} />
            </button>
            <button
              className={`icon row-btn ${props.recordingAgentId === a.id ? 'recording' : ''}`}
              title={`Sprach-Anweisung an ${a.name}`}
              onClick={(e) => {
                e.stopPropagation()
                props.onAgentVoiceFor(a.id)
              }}
            >
              <MicIcon size={12} />
            </button>
            <button
              className="icon row-btn"
              title={`Unterhaltung von ${a.name} leeren (/clear)`}
              onClick={(e) => {
                e.stopPropagation()
                props.onClearAgent(a.id)
              }}
            >
              <ClearIcon size={12} />
            </button>
            <button
              className="icon stop-agent"
              title={
                orchestrator ? 'Team beenden (Orchestrator und alle Mitglieder)' : 'Agent beenden'
              }
              onClick={(e) => {
                e.stopPropagation()
                props.onStopAgent(a)
              }}
            >
              <CloseIcon />
            </button>
          </span>
        )}
      </div>
    )
  }

  /** Team header + indented members (order freely sortable, lead = started first). */
  const teamGroup = (team: Team, members: Agent[]): React.JSX.Element => {
    const ids = members.map((a) => a.id)
    const lead = leadOf(members)
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
                {
                  label: 'Mitglieder nach Name sortieren',
                  action: () => props.onReorderAgents([...members].sort(byName).map((a) => a.id))
                },
                { label: 'Team beenden', danger: true, action: () => props.onStopTeam(team) }
              ]
            })
          }}
          title={`${team.temporary ? 'Temporäres Team' : 'Team'} „${team.name}“\n${lead?.teamRole === 'orchestrator' ? `Orchestrator: ${lead.name} – steuert die Mitglieder, nur mit ihm sprichst du; die Mitglieder kannst du beobachten` : `Leitung: ${lead?.name ?? '–'}`}\nKlick: alle im Raster · Strg+Klick: hinzufügen/entfernen · Rechtsklick: beenden`}
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
        {isOpen && (
          <div className="team-members">
            {members.map((a) => agentRow(a, `team:${team.id}`, ids, a.id === lead?.id))}
          </div>
        )}
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
          <button
            className="icon"
            title="Projekte alphanumerisch aufsteigend sortieren"
            disabled={projects.length < 2}
            onClick={() => props.onReorderProjects([...projects].sort(byName).map((p) => p.id))}
          >
            <SortIcon />
          </button>
          <button className="icon" title="Einstellungen" onClick={props.onOpenSettings}>
            <GearIcon />
          </button>
          <button className="icon" title="Projekt hinzufügen" onClick={props.onAddProject}>
            <PlusIcon />
          </button>
          <button
            className="icon"
            title="Projekte importieren: Ordner durchsuchen (z. B. ganzer Dev-Ordner, mehrere per Strg+Klick)"
            onClick={props.onImportProjects}
          >
            <FolderImportIcon />
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
          // Agent order comes from main (persisted, changeable via drag & drop)
          const projectAgents = agents.filter((a) => a.projectId === p.id)
          const projectTeams = teams
            .filter((t) => t.projectId === p.id)
            .sort((a, b) => a.createdAt - b.createdAt)
          const teamIds = new Set(projectTeams.map((t) => t.id))
          // Agents without a (known) team are listed below the teams
          const loose = projectAgents.filter((a) => !a.teamId || !teamIds.has(a.teamId))
          const looseIds = loose.map((a) => a.id)
          const isOpen = !collapsed.has(p.id)
          const attention = projectAgents.some((a) => a.status === 'needsInput')
          const d = dnd(
            'projects',
            p.id,
            projects.map((x) => x.id),
            props.onReorderProjects
          )
          return (
            <div key={p.id} className="tree-project">
              <div
                {...d}
                className={`row project-row ${selection?.kind === 'project' && selection.projectId === p.id ? 'selected' : ''} ${d.className}`}
                onClick={(e) => props.onSelectProject(p.id, e.ctrlKey || e.metaKey)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      ...startItems(p.id),
                      { label: 'Projekt', heading: true, action: () => {} },
                      ...(projectAgents.length > 1
                        ? [
                            {
                              // All at once: teams and agents without a team are separate groups
                              label: 'Agents nach Name sortieren',
                              action: () =>
                                props.onReorderAgents(
                                  [...projectAgents].sort(byName).map((a) => a.id)
                                )
                            }
                          ]
                        : []),
                      { label: 'Bearbeiten …', action: () => props.onEditProject(p) },
                      { label: 'Entfernen', danger: true, action: () => props.onRemoveProject(p) }
                    ]
                  })
                }}
                title={`${p.agentPath}\nStrg+Klick: alle Agents zum Raster hinzufügen/entfernen\nZiehen: Reihenfolge ändern`}
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
                    // With templates/teams: choice below the button, otherwise start directly
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
                      projectAgents.filter((a) => a.teamId === t.id)
                    )
                  )}
                  {loose.map((a) => agentRow(a, `project:${p.id}`, looseIds))}
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
