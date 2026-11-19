import type { Agent, Project } from '../../../shared/types'
import { isTeamWorker, teamLead } from '../../../shared/types'
import type { Selection } from '../App'
import TerminalView from './TerminalView'
import { ClearIcon, CloseIcon, EditIcon, EyeIcon, LockIcon, MicIcon, PlayIcon } from './Icons'
import { focusTerminal, hasSnapshot } from '../lib/terminals'
import { formatAccelerator } from '../../../shared/hotkeys'
import { formatTokens } from '../lib/format'
import { useT } from '../lib/i18n'

/** Reported progress (`report_progress`), otherwise the agent's current step */
const activityText = (a: Agent): string =>
  a.progress
    ? `${a.progress.percent !== undefined ? `${Math.round(a.progress.percent)} % · ` : ''}${a.progress.message}`
    : (a.activity ?? '')

interface Props {
  selection: Selection
  projects: Project[]
  agents: Agent[]
  activeAgentId: string | null
  agentVoiceActive: boolean
  /** A voice recording is running for this agent (agent's microphone red) */
  recordingAgentId: string | null
  /** Shortcut for agent recording (accelerator) */
  agentHotkey: string
  onActivate: (agentId: string) => void
  onOpenAgent: (agentId: string) => void
  onStartAgent: (projectId: string) => void
  onStopAgent: (agent: Agent) => void
  /** Voice instruction to the active agent */
  onAgentVoice: () => void
  /** Voice instruction to exactly this agent (microphone in the agent header) */
  onAgentVoiceFor: (agentId: string) => void
  /** Send `/clear` to the agent (clear the conversation) */
  onClearAgent: (agentId: string) => void
  /** Click on a locked agent → switch to its editor tab */
  onOpenEditor: (agentId: string) => void
  /** Write an instruction in the editor tab (like the `editorHotkey` shortcut) */
  onEditPrompt: (agentId: string) => void
  editorHotkey: string
}

/**
 * Center: terminal of the selected agent, grid of all agents of a project
 * or a freely assembled grid (Ctrl+click, across projects).
 */
function CenterPane(props: Props): React.JSX.Element {
  const { selection, projects, agents } = props
  const t = useT()

  const voiceButton = (): React.JSX.Element => (
    <button
      className={`icon ${props.agentVoiceActive ? 'recording' : ''}`}
      title={t('center.voiceToActive', { hotkey: formatAccelerator(props.agentHotkey) })}
      onClick={props.onAgentVoice}
    >
      <MicIcon />
    </button>
  )

  if (selection?.kind === 'agent') {
    const agent = agents.find((a) => a.id === selection.agentId)
    if (agent) {
      const project = projects.find((p) => p.id === agent.projectId)
      return (
        <main className="pane center">
          <header className="pane-header">
            <span className="title">
              <span className={`dot ${agent.status}`} />
              {agent.name}
              <span className="muted"> · {project?.name}</span>
              {agent.worktree && (
                <span
                  className="muted"
                  title={t('center.worktreeTooltip', { path: agent.worktree.path })}
                >
                  {' '}
                  · {agent.worktree.branch}
                </span>
              )}
              {agent.usage && (
                <span className="muted" title={t('center.contextTooltip')}>
                  {' '}
                  · {t('center.contextSize', { tokens: formatTokens(agent.usage.context) })}
                </span>
              )}
              {agent.status === 'working' && activityText(agent) && (
                <span className="header-activity"> · {activityText(agent)}</span>
              )}
              {agent.editing && <LockedBadge onOpen={() => props.onOpenEditor(agent.id)} />}
            </span>
            <div className="header-actions">
              {!agent.editing && !isTeamWorker(agent) && (
                <button
                  className="icon"
                  title={t('center.editPromptTooltip', {
                    hotkey: formatAccelerator(props.editorHotkey)
                  })}
                  onClick={() => props.onEditPrompt(agent.id)}
                >
                  <EditIcon />
                </button>
              )}
              <AgentButtons {...props} agent={agent} />
            </div>
          </header>
          {agent.editing ? (
            <LockedTerminal agent={agent} onOpen={() => props.onOpenEditor(agent.id)} />
          ) : (
            <TerminalView agentId={agent.id} autoFocus />
          )}
        </main>
      )
    }
  }

  if (selection?.kind === 'agents') {
    const shown = selection.agentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => !!a)
    const projectCount = new Set(shown.map((a) => a.projectId)).size
    return (
      <main className="pane center">
        <header className="pane-header">
          <span className="title">
            {t('center.agentCount', { count: shown.length })}
            <span className="muted">
              {' '}
              · {t('center.projectCount', { count: projectCount })} · {t('center.gridHint')}
            </span>
          </span>
          <div className="header-actions">{props.activeAgentId && voiceButton()}</div>
        </header>
        <AgentGrid {...props} shown={shown} showProject={projectCount > 1} />
      </main>
    )
  }

  if (selection?.kind === 'project') {
    const project = projects.find((p) => p.id === selection.projectId)
    const projectAgents = agents.filter((a) => a.projectId === selection.projectId)

    return (
      <main className="pane center">
        <header className="pane-header">
          <span className="title">{project?.name}</span>
          <div className="header-actions">
            {props.activeAgentId && voiceButton()}
            <button
              className="icon"
              title={t('center.startNewAgent')}
              onClick={() => props.onStartAgent(selection.projectId)}
            >
              <PlayIcon size={12} />
            </button>
          </div>
        </header>

        {projectAgents.length === 0 ? (
          <div className="empty muted">
            <div>
              {t('center.noAgents')}
              <br />
              <button className="link" onClick={() => props.onStartAgent(selection.projectId)}>
                {t('center.startAgent')}
              </button>
            </div>
          </div>
        ) : (
          <AgentGrid {...props} shown={projectAgents} showProject={false} />
        )}
      </main>
    )
  }

  return (
    <main className="pane center">
      <header className="pane-header">
        <span>{t('center.terminal')}</span>
      </header>
      <div className="empty muted">
        {t('center.emptySelect')}
        <br />
        {t('center.emptyProjectHint')}
        <br />
        {t('center.emptyGridHint')}
      </div>
    </main>
  )
}

/** Grid of terminals; click activates a cell, double-click on the header opens the single view. */
function AgentGrid(props: Props & { shown: Agent[]; showProject: boolean }): React.JSX.Element {
  const { shown, projects } = props
  const t = useT()
  const cols = Math.ceil(Math.sqrt(shown.length || 1))
  const rows = Math.ceil((shown.length || 1) / cols)

  return (
    <div
      className="agent-grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
      }}
    >
      {shown.map((a) => (
        <section
          key={a.id}
          className={[
            'grid-cell',
            a.id === props.activeAgentId ? 'active' : '',
            a.status === 'needsInput' ? 'attention' : ''
          ].join(' ')}
          onMouseDown={() => {
            if (a.editing) return props.onOpenEditor(a.id)
            props.onActivate(a.id)
            focusTerminal(a.id)
          }}
        >
          <header
            className="cell-header"
            title={t('center.cellHeaderTooltip')}
            onDoubleClick={() => props.onOpenAgent(a.id)}
          >
            <span className={`dot ${a.status}`} />
            <span className="row-name">
              {a.name}
              {props.showProject && (
                <span className="muted"> · {projects.find((p) => p.id === a.projectId)?.name}</span>
              )}
              {a.status === 'needsInput' ? (
                <span className="row-sub">{a.statusMessage || t('center.waitingForInput')}</span>
              ) : (
                a.status === 'working' &&
                activityText(a) && <span className="row-sub info">{activityText(a)}</span>
              )}
            </span>
            {a.editing && <LockedBadge onOpen={() => props.onOpenEditor(a.id)} />}
            <AgentButtons {...props} agent={a} />
          </header>
          {a.editing ? (
            <LockedTerminal agent={a} onOpen={() => props.onOpenEditor(a.id)} />
          ) : (
            <TerminalView agentId={a.id} />
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * Agent whose instruction is currently being written in an editor tab: terminal stays visible
 * unchanged (input locked, notice in the header); clicking it switches to the tab.
 */
function LockedTerminal({
  agent,
  onOpen
}: {
  agent: Agent
  onOpen: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div
      className="locked-terminal"
      title={t('center.lockedTooltip', { name: agent.name })}
      // Capture: the terminal itself must not get the click (no selection, no focus)
      onMouseDownCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
    >
      {/* Snapshot at full width; the live terminal is mounted in the (narrower) editor tab */}
      <TerminalView agentId={agent.id} snapshot={hasSnapshot(agent.id)} />
      {/* Overlaid (does not shrink the terminal): dimmed + notice instead of the input field */}
      <div className="locked-overlay">
        <span className="locked-pill">
          <LockIcon size={12} /> {t('center.lockedNotice')}
          <span className="link">{t('center.toTab')}</span>
        </span>
      </div>
    </div>
  )
}

/**
 * Right side of the agent header: microphone · /clear · stop (in the grid the click does not activate the cell).
 * Team workers: no controls, only the "watching" notice.
 */
function AgentButtons(props: Props & { agent: Agent }): React.JSX.Element {
  const a = props.agent
  const t = useT()
  if (isTeamWorker(a)) {
    const lead = teamLead(props.agents, a.teamId!)
    return (
      <span
        className="watch-badge"
        title={lead ? t('center.watchTooltipNamed', { name: lead.name }) : t('center.watchTooltip')}
      >
        <EyeIcon size={12} /> {t('center.watching')}
      </span>
    )
  }
  const orchestrator = a.teamRole === 'orchestrator'
  return (
    <span className="agent-actions">
      <button
        className={`icon ${props.recordingAgentId === a.id ? 'recording' : ''}`}
        title={t('center.voiceToAgent', { name: a.name })}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => props.onAgentVoiceFor(a.id)}
      >
        <MicIcon />
      </button>
      <button
        className="icon"
        title={t('center.clearConversation', { name: a.name })}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => props.onClearAgent(a.id)}
      >
        <ClearIcon />
      </button>
      <button
        className="icon"
        title={orchestrator ? t('center.stopTeamTooltip') : t('center.stopAgentTooltip')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => props.onStopAgent(a)}
      >
        <CloseIcon />
      </button>
    </span>
  )
}

/** Notice in the header: instruction is being written in the editor tab (click → tab) */
function LockedBadge({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <button
      className="locked-badge"
      title={t('center.lockedBadgeTooltip')}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onOpen}
    >
      <LockIcon size={11} /> {t('center.lockedBadge')}
    </button>
  )
}

export default CenterPane
