import { useState } from 'react'
import type { Agent, Project } from '../../../shared/types'
import type { Selection } from '../App'
import { formatAccelerator } from '../../../shared/hotkeys'
import ContextMenu, { MenuState } from './ContextMenu'
import {
  ChevronIcon,
  CloseIcon,
  CodeIcon,
  GearIcon,
  MicIcon,
  PlayIcon,
  PlusIcon,
  VsIcon
} from './Icons'

interface Props {
  projects: Project[]
  agents: Agent[]
  selection: Selection
  vscodeInstalled: boolean
  globalVoiceActive: boolean
  /** Kürzel für globale Sprachbefehle (Accelerator) */
  globalHotkey: string
  onSelectProject: (id: string) => void
  onSelectAgent: (id: string) => void
  onStartAgent: (projectId: string) => void
  onStopAgent: (agent: Agent) => void
  onRenameAgent: (id: string, name: string) => void
  onAddProject: () => void
  onEditProject: (p: Project) => void
  onRemoveProject: (p: Project) => void
  onOpenProjectFile: (p: Project) => void
  onOpenVSCode: (p: Project) => void
  onGlobalVoice: () => void
  onOpenSettings: () => void
}

const STATUS_LABEL: Record<Agent['status'], string> = {
  starting: 'Startet …',
  working: 'Arbeitet',
  idle: 'Bereit',
  needsInput: 'Wartet auf Eingabe'
}

/** Linke Spalte: registrierte Projekte und ihre Agents. */
function Sidebar(props: Props): React.JSX.Element {
  const { projects, agents, selection } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <aside className="pane sidebar">
      <header className="pane-header">
        <span>Projekte</span>
        <div className="header-actions">
          <button
            className={`icon ${props.globalVoiceActive ? 'recording' : ''}`}
            title={`Sprachbefehl: Agent per Name ansprechen oder neuen Agent starten (${formatAccelerator(props.globalHotkey)})`}
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
          const isOpen = !collapsed.has(p.id)
          const attention = projectAgents.some((a) => a.status === 'needsInput')
          return (
            <div key={p.id} className="tree-project">
              <div
                className={`row project-row ${selection?.kind === 'project' && selection.projectId === p.id ? 'selected' : ''}`}
                onClick={() => props.onSelectProject(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: 'Agent starten', action: () => props.onStartAgent(p.id) },
                      { label: 'Bearbeiten …', action: () => props.onEditProject(p) },
                      { label: 'Entfernen', danger: true, action: () => props.onRemoveProject(p) }
                    ]
                  })
                }}
                title={p.agentPath}
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
                      title={`Projektdatei öffnen: ${p.projectFile}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onOpenProjectFile(p)
                      }}
                    >
                      <VsIcon />
                    </button>
                  )}
                  {p.vscodePath && props.vscodeInstalled && (
                    <button
                      className="icon"
                      title={`In VS Code öffnen: ${p.vscodePath}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onOpenVSCode(p)
                      }}
                    >
                      <CodeIcon />
                    </button>
                  )}
                </span>
                <button
                  className="icon start-agent"
                  title="Neuen Agent starten"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onStartAgent(p.id)
                  }}
                >
                  <PlayIcon size={12} />
                </button>
              </div>

              {isOpen &&
                projectAgents.map((a) => (
                  <div
                    key={a.id}
                    className={[
                      'row agent-row',
                      a.status === 'needsInput' ? 'attention' : '',
                      selection?.kind === 'agent' && selection.agentId === a.id ? 'selected' : ''
                    ].join(' ')}
                    onClick={() => props.onSelectAgent(a.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setRenaming(a.id)
                    }}
                    title={`${STATUS_LABEL[a.status]}${a.statusMessage ? ` – ${a.statusMessage}` : ''}\nRechtsklick: umbenennen`}
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
                ))}
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
