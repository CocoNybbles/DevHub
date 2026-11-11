import type { Agent, Project } from '../../../shared/types'
import type { Selection } from '../App'
import TerminalView from './TerminalView'
import { CloseIcon, EditIcon, LockIcon, MicIcon, PlayIcon } from './Icons'
import { focusTerminal, hasSnapshot } from '../lib/terminals'
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
  /** Gesperrten Agent anklicken → zu seinem Editor-Tab wechseln */
  onOpenEditor: (agentId: string) => void
  /** Anweisung im Editor-Tab schreiben (wie das Kürzel `editorHotkey`) */
  onEditPrompt: (agentId: string) => void
  editorHotkey: string
}

/**
 * Mitte: Terminal des ausgewählten Agents, Raster aller Agents eines Projekts
 * oder frei zusammengestelltes Raster (Strg+Klick, projektübergreifend).
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
              {!agent.editing && (
                <button
                  className="icon"
                  title={`Anweisung in einem Tab schreiben – mit Bildern und Diktat (${formatAccelerator(props.editorHotkey)})`}
                  onClick={() => props.onEditPrompt(agent.id)}
                >
                  <EditIcon />
                </button>
              )}
              {voiceButton('Sprach-Anweisung an diesen Agent')}
              <button
                className="icon"
                title="Agent beenden"
                onClick={() => props.onStopAgent(agent)}
              >
                <CloseIcon />
              </button>
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

/** Raster aus Terminals; Klick aktiviert eine Zelle, Doppelklick auf den Kopf öffnet die Einzelansicht. */
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
            <button
              className="icon"
              title="Agent beenden"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => props.onStopAgent(a)}
            >
              <CloseIcon />
            </button>
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
 * Agent, dessen Anweisung gerade in einem Editor-Tab geschrieben wird: Terminal unverändert
 * sichtbar (Eingaben gesperrt, Hinweis steht im Kopf); ein Klick darauf wechselt zum Tab.
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
      // Capture: das Terminal selbst soll den Klick nicht bekommen (keine Auswahl, kein Fokus)
      onMouseDownCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpen()
      }}
    >
      {/* Standbild in voller Breite; das live-Terminal hängt im (schmaleren) Editor-Tab */}
      <TerminalView agentId={agent.id} snapshot={hasSnapshot(agent.id)} />
      {/* Darübergelegt (verkleinert das Terminal nicht): abgedunkelt + Hinweis statt Eingabefeld */}
      <div className="locked-overlay">
        <span className="locked-pill">
          <LockIcon size={12} /> Eingabe gesperrt – die Anweisung wird im Tab geschrieben
          <span className="link">Zum Tab</span>
        </span>
      </div>
    </div>
  )
}

/** Hinweis im Kopf: Anweisung wird im Editor-Tab geschrieben (Klick → Tab) */
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
