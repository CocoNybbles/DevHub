import type { Agent, Project } from '../../../shared/types'
import { isTeamWorker, teamLead } from '../../../shared/types'
import type { Selection } from '../App'
import TerminalView from './TerminalView'
import { ClearIcon, CloseIcon, EditIcon, EyeIcon, LockIcon, MicIcon, PlayIcon } from './Icons'
import { focusTerminal, hasSnapshot } from '../lib/terminals'
import { formatAccelerator } from '../../../shared/hotkeys'

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

  const voiceButton = (title: string): React.JSX.Element => (
    <button
      className={`icon ${props.agentVoiceActive ? 'recording' : ''}`}
      title={`${title} (${formatAccelerator(props.agentHotkey)})`}
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
              {agent.editing && <LockedBadge onOpen={() => props.onOpenEditor(agent.id)} />}
            </span>
            <div className="header-actions">
              {!agent.editing && !isTeamWorker(agent) && (
                <button
                  className="icon"
                  title={`Anweisung in einem Tab schreiben – mit Bildern und Diktat (${formatAccelerator(props.editorHotkey)})`}
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
            {shown.length} Agents
            <span className="muted">
              {' '}
              · {projectCount === 1 ? '1 Projekt' : `${projectCount} Projekte`} · Strg+Klick links
              ändert die Auswahl
            </span>
          </span>
          <div className="header-actions">
            {props.activeAgentId && voiceButton('Sprach-Anweisung an den aktiven Agent')}
          </div>
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
            {props.activeAgentId && voiceButton('Sprach-Anweisung an den aktiven Agent')}
            <button
              className="icon"
              title="Neuen Agent starten"
              onClick={() => props.onStartAgent(selection.projectId)}
            >
              <PlayIcon size={12} />
            </button>
          </div>
        </header>

        {projectAgents.length === 0 ? (
          <div className="empty muted">
            <div>
              Keine Agents in diesem Projekt.
              <br />
              <button className="link" onClick={() => props.onStartAgent(selection.projectId)}>
                Agent starten
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
        <span>Terminal</span>
      </header>
      <div className="empty muted">
        Projekt oder Agent links auswählen.
        <br />
        Projekt anklicken zeigt alle Agents im Raster.
        <br />
        Strg+Klick auf Agents/Projekte stellt ein eigenes Raster zusammen.
      </div>
    </main>
  )
}

/** Grid of terminals; click activates a cell, double-click on the header opens the single view. */
function AgentGrid(props: Props & { shown: Agent[]; showProject: boolean }): React.JSX.Element {
  const { shown, projects } = props
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
            title="Doppelklick: Einzelansicht"
            onDoubleClick={() => props.onOpenAgent(a.id)}
          >
            <span className={`dot ${a.status}`} />
            <span className="row-name">
              {a.name}
              {props.showProject && (
                <span className="muted"> · {projects.find((p) => p.id === a.projectId)?.name}</span>
              )}
              {a.status === 'needsInput' && (
                <span className="row-sub">{a.statusMessage || 'Wartet auf Eingabe'}</span>
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
  return (
    <div
      className="locked-terminal"
      title={`${agent.name} ist gesperrt – Klick wechselt zum Editor-Tab`}
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
          <LockIcon size={12} /> Eingabe gesperrt – die Anweisung wird im Tab geschrieben
          <span className="link">Zum Tab</span>
        </span>
      </div>
    </div>
  )
}

/**
 * Right side of the agent header: microphone · /clear · stop (in the grid the click does not activate the cell).
 * Team workers: no controls, only the "beobachten" (observe) notice.
 */
function AgentButtons(props: Props & { agent: Agent }): React.JSX.Element {
  const a = props.agent
  if (isTeamWorker(a)) {
    const lead = teamLead(props.agents, a.teamId!)
    return (
      <span
        className="watch-badge"
        title={`Teammitglied – nur beobachten. Anweisungen gehen an ${lead?.name ?? 'den Orchestrator'}.`}
      >
        <EyeIcon size={12} /> beobachten
      </span>
    )
  }
  const orchestrator = a.teamRole === 'orchestrator'
  return (
    <span className="agent-actions">
      <button
        className={`icon ${props.recordingAgentId === a.id ? 'recording' : ''}`}
        title={`Sprach-Anweisung an ${a.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => props.onAgentVoiceFor(a.id)}
      >
        <MicIcon />
      </button>
      <button
        className="icon"
        title={`Unterhaltung von ${a.name} leeren (/clear)`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => props.onClearAgent(a.id)}
      >
        <ClearIcon />
      </button>
      <button
        className="icon"
        title={orchestrator ? 'Team beenden (Orchestrator und alle Mitglieder)' : 'Agent beenden'}
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
  return (
    <button
      className="locked-badge"
      title="Gesperrt, bis der Editor-Tab geschlossen wird – Klick wechselt dorthin"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onOpen}
    >
      <LockIcon size={11} /> im Tab
    </button>
  )
}

export default CenterPane
