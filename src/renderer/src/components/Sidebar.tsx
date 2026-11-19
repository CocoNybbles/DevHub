import { useState } from 'react'
import type {
  Agent,
  AgentTemplate,
  Engine,
  Project,
  Team,
  TeamTemplate
} from '../../../shared/types'
import { isTeamWorker, teamLead } from '../../../shared/types'
import type { Selection } from '../App'
import { formatAccelerator } from '../../../shared/hotkeys'
import { getLocale, type TranslationKey } from '../../../shared/i18n'
import { useT } from '../lib/i18n'
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
  a.name.localeCompare(b.name, getLocale(), { numeric: true, sensitivity: 'base' })

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
  /** More engines (terminal programs other than Claude Code) → choice when starting */
  engines: Engine[]
  onStartEngine: (projectId: string, engineId: string) => void
  /** Inbox (permission requests, waiting agents, notices) – placed below the project list */
  inbox: React.ReactNode
  /** projectId: board of this project, otherwise of the selected one */
  onOpenTasks: (projectId?: string) => void
  onOpenHistory: () => void
  onOpenReport: () => void
  onOpenRun: (projectId: string) => void
  /** Review changes: the project's main folder or the agent's working directory */
  onReview: (projectId: string, agentId?: string) => void
  /** Append an instruction / send a prompt from the library */
  onQueue: (agentId: string) => void
  onFork: (agentId: string) => void
  /** An agent's usage for the tooltip */
  usageText: (agent: Agent) => string
  /** Number of open tasks (shown on the button) */
  openTaskCount: number
}

/** Keys only – translated where the label is rendered (the language can change at runtime) */
const STATUS_LABEL: Record<Agent['status'], TranslationKey> = {
  starting: 'sidebar.statusStarting',
  working: 'sidebar.statusWorking',
  idle: 'sidebar.statusIdle',
  needsInput: 'sidebar.statusNeedsInput'
}

/** Left column: registered projects, their teams and agents. */
function Sidebar(props: Props): React.JSX.Element {
  const { projects, agents, teams, selection } = props
  const t = useT()
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
    { label: t('sidebar.startAgent'), action: () => props.onStartAgent(projectId) },
    ...props.templates.map((tpl) => ({
      label: tpl.model
        ? t('sidebar.startNamedWithModel', { name: tpl.name, model: tpl.model })
        : t('sidebar.startNamed', { name: tpl.name }),
      action: () => props.onStartAgent(projectId, tpl.id)
    })),
    ...(props.teamTemplates.length
      ? [{ label: t('common.teams'), heading: true, action: () => {} }]
      : []),
    ...props.teamTemplates.map((tpl) => ({
      label: t('sidebar.startTeam', { name: tpl.name, members: tpl.members.length }),
      action: () => props.onStartTeam(projectId, tpl.id)
    })),
    ...(props.engines.length
      ? [{ label: t('sidebar.moreEngines'), heading: true, action: () => {} }]
      : []),
    ...props.engines.map((e) => ({
      label: t('sidebar.startNamed', { name: e.name }),
      action: () => props.onStartEngine(projectId, e.id)
    }))
  ]
  const hasStartChoice =
    props.templates.length > 0 || props.teamTemplates.length > 0 || props.engines.length > 0

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
    const hotkey = formatAccelerator(props.editorHotkey)
    const usage = props.usageText(a)
    // Tooltip: one line per fact, the usage hint last
    const tooltip = [
      `${t(STATUS_LABEL[a.status])}${a.statusMessage ? ` – ${a.statusMessage}` : ''}`,
      a.activity,
      a.worktree && t('sidebar.tooltipWorktree', { branch: a.worktree.branch }),
      usage,
      a.queue?.length && t('sidebar.tooltipQueue', { count: a.queue.length }),
      a.model && t('sidebar.tooltipModel', { model: a.model }),
      orchestrator ? t('sidebar.tooltipOrchestrator') : lead && t('sidebar.tooltipLead'),
      t(worker ? 'sidebar.workerHint' : 'sidebar.agentHint')
    ]
      .filter(Boolean)
      .join('\n')
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
              { label: t('common.rename'), action: () => setRenaming(a.id) },
              {
                label: a.editing
                  ? t('sidebar.toEditorTab')
                  : t('sidebar.menuWriteInTab', { hotkey }),
                action: () => props.onEditPrompt(a.id)
              },
              {
                label: a.queue?.length
                  ? t('sidebar.menuQueueMore', { count: a.queue.length })
                  : t('sidebar.menuQueue'),
                action: () => props.onQueue(a.id)
              },
              {
                label: t('sidebar.menuReview'),
                action: () => props.onReview(a.projectId, a.id)
              },
              ...(!a.teamId && !a.engineId
                ? [{ label: t('sidebar.menuFork'), action: () => props.onFork(a.id) }]
                : []),
              {
                label: orchestrator ? t('sidebar.menuStopTeam') : t('sidebar.menuStop'),
                danger: true,
                action: () => props.onStopAgent(a)
              },
              { label: t('sidebar.menuVoiceHeading'), heading: true, action: () => {} },
              voice(
                props.globalVoiceAutoSend
                  ? t('sidebar.menuVoiceGlobalSend')
                  : t('sidebar.menuVoiceGlobalInsert'),
                undefined
              ),
              voice(t('sidebar.menuVoiceAutoSend'), true),
              voice(t('sidebar.menuVoiceInsertOnly'), false)
            ]
          })
        }}
        title={tooltip}
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
              <span className="team-tag">{t('common.orchestrator')}</span>
            ) : (
              lead && <span className="team-tag">{t('sidebar.leadTag')}</span>
            )}
            {worker && (
              <span className="watch-tag" title={t('sidebar.watchOnly')}>
                <EyeIcon size={11} />
              </span>
            )}
            {a.editing && (
              <span className="team-tag" title={t('sidebar.editingTagTooltip')}>
                <EditIcon size={10} /> {t('sidebar.editingTag')}
              </span>
            )}
            {a.worktree && (
              <span
                className="team-tag"
                title={t('sidebar.worktreeTagTooltip', { branch: a.worktree.branch })}
              >
                {t('sidebar.worktreeTag')}
              </span>
            )}
            {!!a.queue?.length && (
              <span className="team-tag" title={t('sidebar.queueTagTooltip')}>
                +{a.queue.length}
              </span>
            )}
            {a.status === 'needsInput' && a.statusMessage ? (
              <span className="row-sub">{a.statusMessage}</span>
            ) : (
              // Working: reported progress, otherwise the current step
              a.status === 'working' &&
              (a.progress || a.activity) && (
                <span className="row-sub info">
                  {a.progress
                    ? `${a.progress.percent !== undefined ? `${Math.round(a.progress.percent)} % · ` : ''}${a.progress.message}`
                    : a.activity}
                </span>
              )
            )}
          </span>
        )}
        {!worker && (
          <span className="agent-actions">
            <button
              className="icon row-btn"
              title={
                a.editing ? t('sidebar.toEditorTab') : t('sidebar.editPromptTooltip', { hotkey })
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
              title={t('sidebar.voiceToAgent', { name: a.name })}
              onClick={(e) => {
                e.stopPropagation()
                props.onAgentVoiceFor(a.id)
              }}
            >
              <MicIcon size={12} />
            </button>
            <button
              className="icon row-btn"
              title={t('sidebar.clearConversation', { name: a.name })}
              onClick={(e) => {
                e.stopPropagation()
                props.onClearAgent(a.id)
              }}
            >
              <ClearIcon size={12} />
            </button>
            <button
              className="icon stop-agent"
              title={orchestrator ? t('sidebar.stopTeamTooltip') : t('sidebar.stopAgentTooltip')}
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
                {
                  label: t('sidebar.menuShowInGrid'),
                  action: () => props.onSelectTeam(team, false)
                },
                {
                  label: t('sidebar.menuSortMembers'),
                  action: () => props.onReorderAgents([...members].sort(byName).map((a) => a.id))
                },
                {
                  label: t('sidebar.menuStopTeam'),
                  danger: true,
                  action: () => props.onStopTeam(team)
                }
              ]
            })
          }}
          title={[
            t(team.temporary ? 'sidebar.teamTitleTemporary' : 'sidebar.teamTitle', {
              name: team.name
            }),
            lead?.teamRole === 'orchestrator'
              ? t('sidebar.teamOrchestratorLine', { name: lead.name })
              : t('sidebar.teamLeadLine', { name: lead?.name ?? '–' }),
            t('sidebar.teamClickHint')
          ].join('\n')}
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
            {team.temporary && <span className="team-tag">{t('sidebar.temporaryTag')}</span>}
          </span>
          {!isOpen && attention && (
            <span className="dot needsInput" title={t('sidebar.agentWaiting')} />
          )}
          <span className="count">{members.length}</span>
          <button
            className="icon stop-agent"
            title={t('sidebar.menuStopTeam')}
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
        <span>{t('common.projects')}</span>
        <div className="header-actions">
          <button
            className={`icon ${props.globalVoiceActive ? 'recording' : ''}`}
            title={t('sidebar.globalVoiceTooltip', {
              hotkey: formatAccelerator(props.globalHotkey)
            })}
            onClick={props.onGlobalVoice}
          >
            <MicIcon />
          </button>
          <button
            className="icon"
            title={t('sidebar.sortProjects')}
            disabled={projects.length < 2}
            onClick={() => props.onReorderProjects([...projects].sort(byName).map((p) => p.id))}
          >
            <SortIcon />
          </button>
          <button className="icon" title={t('common.settings')} onClick={props.onOpenSettings}>
            <GearIcon />
          </button>
          <button className="icon" title={t('sidebar.addProject')} onClick={props.onAddProject}>
            <PlusIcon />
          </button>
          <button
            className="icon"
            title={t('sidebar.importProjects')}
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
              {t('sidebar.noProjects')}
              <br />
              <button className="link" onClick={props.onAddProject}>
                {t('sidebar.addProject')}
              </button>
            </div>
          </div>
        )}

        {projects.map((p) => {
          // Agent order comes from main (persisted, changeable via drag & drop)
          const projectAgents = agents.filter((a) => a.projectId === p.id)
          const projectTeams = teams
            .filter((team) => team.projectId === p.id)
            .sort((a, b) => a.createdAt - b.createdAt)
          const teamIds = new Set(projectTeams.map((team) => team.id))
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
                      { label: t('common.project'), heading: true, action: () => {} },
                      { label: t('sidebar.menuTasks'), action: () => props.onOpenTasks(p.id) },
                      { label: t('sidebar.menuReview'), action: () => props.onReview(p.id) },
                      { label: t('sidebar.menuRun'), action: () => props.onOpenRun(p.id) },
                      ...(projectAgents.length > 1
                        ? [
                            {
                              // All at once: teams and agents without a team are separate groups
                              label: t('sidebar.menuSortAgents'),
                              action: () =>
                                props.onReorderAgents(
                                  [...projectAgents].sort(byName).map((a) => a.id)
                                )
                            }
                          ]
                        : []),
                      { label: t('sidebar.menuEdit'), action: () => props.onEditProject(p) },
                      {
                        label: t('common.remove'),
                        danger: true,
                        action: () => props.onRemoveProject(p)
                      }
                    ]
                  })
                }}
                title={`${p.agentPath}\n${t('sidebar.projectHint')}`}
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
                  <span className="dot needsInput" title={t('sidebar.agentWaiting')} />
                )}
                {projectAgents.length > 0 && <span className="count">{projectAgents.length}</span>}
                <span className="row-actions">
                  {p.projectFile && (
                    <button
                      className="icon"
                      title={t('sidebar.openProjectFile', {
                        file: p.projectFile,
                        program: programLabel(
                          p.projectFileApp || props.globalProjectFileApp,
                          t('sidebar.windowsDefaultProgram')
                        )
                      })}
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
                      title={t('sidebar.openFolder', {
                        folder: p.folderPath,
                        program: programLabel(
                          p.folderApp || props.globalFolderApp,
                          props.vscodeInstalled ? 'VS Code' : t('sidebar.windowsExplorer')
                        )
                      })}
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
                    hasStartChoice ? t('sidebar.startChoiceTooltip') : t('sidebar.startNewAgent')
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
                  {projectTeams.map((team) =>
                    teamGroup(
                      team,
                      projectAgents.filter((a) => a.teamId === team.id)
                    )
                  )}
                  {loose.map((a) => agentRow(a, `project:${p.id}`, looseIds))}
                </>
              )}
            </div>
          )
        })}
      </div>

      {props.inbox}

      <footer className="sidebar-footer">
        <button title={t('sidebar.tasksTooltip')} onClick={() => props.onOpenTasks()}>
          {t('common.tasks')}
          {props.openTaskCount > 0 && <span className="count">{props.openTaskCount}</span>}
        </button>
        <button title={t('sidebar.historyTooltip')} onClick={props.onOpenHistory}>
          {t('sidebar.history')}
        </button>
        <button title={t('sidebar.reportTooltip')} onClick={props.onOpenReport}>
          {t('sidebar.report')}
        </button>
      </footer>

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
