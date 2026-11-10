import type { Agent, Project } from '../../../shared/types'
import type { Selection } from '../App'
import TerminalView from './TerminalView'
import { CloseIcon, MicIcon, PlayIcon } from './Icons'
import { focusTerminal } from '../lib/terminals'
import { formatAccelerator } from '../../../shared/hotkeys'

interface Props {
  selection: Selection
  projects: Project[]
  agents: Agent[]
  activeAgentId: string | null
  agentVoiceActive: boolean
  /** Kürzel für die Agent-Aufnahme (Accelerator) */
  agentHotkey: string
  onActivate: (agentId: string) => void
  onOpenAgent: (agentId: string) => void
  onStartAgent: (projectId: string) => void
  onStopAgent: (agent: Agent) => void
  onAgentVoice: () => void
}

/** Mitte: Terminal des ausgewählten Agents bzw. Raster aller Agents eines Projekts. */
function CenterPane(props: Props): React.JSX.Element {
  const { selection, projects, agents } = props

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
            </span>
            <div className="header-actions">
              <button
                className={`icon ${props.agentVoiceActive ? 'recording' : ''}`}
                title={`Sprach-Anweisung an diesen Agent (${formatAccelerator(props.agentHotkey)})`}
                onClick={props.onAgentVoice}
              >
                <MicIcon />
              </button>
              <button
                className="icon"
                title="Agent beenden"
                onClick={() => props.onStopAgent(agent)}
              >
                <CloseIcon />
              </button>
            </div>
          </header>
          <TerminalView agentId={agent.id} autoFocus />
        </main>
      )
    }
  }

  if (selection?.kind === 'project') {
    const project = projects.find((p) => p.id === selection.projectId)
    const projectAgents = agents.filter((a) => a.projectId === selection.projectId)
    const cols = Math.ceil(Math.sqrt(projectAgents.length || 1))
    const rows = Math.ceil((projectAgents.length || 1) / cols)

    return (
      <main className="pane center">
        <header className="pane-header">
          <span className="title">{project?.name}</span>
          <div className="header-actions">
            {props.activeAgentId && (
              <button
                className={`icon ${props.agentVoiceActive ? 'recording' : ''}`}
                title={`Sprach-Anweisung an den aktiven Agent (${formatAccelerator(props.agentHotkey)})`}
                onClick={props.onAgentVoice}
              >
                <MicIcon />
              </button>
            )}
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
          <div
            className="agent-grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
            }}
          >
            {projectAgents.map((a) => (
              <section
                key={a.id}
                className={[
                  'grid-cell',
                  a.id === props.activeAgentId ? 'active' : '',
                  a.status === 'needsInput' ? 'attention' : ''
                ].join(' ')}
                onMouseDown={() => {
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
                  <span className="row-name">{a.name}</span>
                  <button
                    className="icon"
                    title="Agent beenden"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => props.onStopAgent(a)}
                  >
                    <CloseIcon />
                  </button>
                </header>
                <TerminalView agentId={a.id} />
              </section>
            ))}
          </div>
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
      </div>
    </main>
  )
}

export default CenterPane
