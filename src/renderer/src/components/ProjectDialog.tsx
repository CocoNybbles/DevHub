import { useState } from 'react'
import type { Project } from '../../../shared/types'
import Modal from './Modal'
import { errorText } from '../lib/errors'
import { validateAgentArgs } from '../../../shared/agentArgs'
import AgentArgsHelp from './AgentArgsHelp'

interface Props {
  project: Project | null
  vscodeInstalled: boolean
  onSaved: (p: Project) => void
  onClose: () => void
}

const folderName = (path: string): string =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? ''

/** Projekt anlegen/bearbeiten mit den drei Pfaden. */
function ProjectDialog({ project, vscodeInstalled, onSaved, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState(project?.name ?? '')
  const [agentPath, setAgentPath] = useState(project?.agentPath ?? '')
  const [projectFile, setProjectFile] = useState(project?.projectFile ?? '')
  const [vscodePath, setVscodePath] = useState(project?.vscodePath ?? '')
  const [agentArgs, setAgentArgs] = useState(project?.agentArgs ?? '')
  const argsError = validateAgentArgs(agentArgs)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const pickAgentPath = async (): Promise<void> => {
    const p = await window.api.projects.pickFolder(agentPath || undefined)
    if (!p) return
    setAgentPath(p)
    if (!name.trim()) setName(folderName(p))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const saved = await window.api.projects.save({
        id: project?.id,
        name: name.trim() || folderName(agentPath),
        agentPath: agentPath.trim(),
        projectFile: projectFile.trim() || undefined,
        vscodePath: vscodeInstalled ? vscodePath.trim() || undefined : undefined,
        agentArgs: agentArgs.trim() || undefined
      })
      onSaved(saved)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={project ? 'Projekt bearbeiten' : 'Projekt hinzufügen'}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !agentPath.trim() || !!argsError}
          >
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={agentPath ? folderName(agentPath) : 'z. B. MeinProjekt'}
            autoFocus
          />
        </label>

        <label>
          <span>
            1 · Agent-Ordner <em>(Pflicht)</em>
          </span>
          <small className="muted">Hier werden Claude und andere KI-Coding-Agents gestartet.</small>
          <div className="path-input">
            <input
              value={agentPath}
              onChange={(e) => setAgentPath(e.target.value)}
              placeholder="C:\Dev\MeinProjekt"
            />
            <button onClick={pickAgentPath}>Durchsuchen …</button>
          </div>
        </label>

        <label>
          <span>2 · Projektdatei</span>
          <small className="muted">
            .sln oder Projektdatei, z. B. zum Öffnen in Visual Studio.
          </small>
          <div className="path-input">
            <input
              value={projectFile}
              onChange={(e) => setProjectFile(e.target.value)}
              placeholder="optional"
            />
            <button
              onClick={async () => {
                const p = await window.api.projects.pickProjectFile(
                  projectFile || agentPath || undefined
                )
                if (p) setProjectFile(p)
              }}
            >
              Durchsuchen …
            </button>
          </div>
        </label>

        <label className={vscodeInstalled ? '' : 'disabled'}>
          <span>3 · VS-Code-Ordner</span>
          <small className="muted">
            {vscodeInstalled
              ? 'Ordner, der in VS Code geöffnet wird.'
              : 'Nicht verfügbar – VS Code ist nicht installiert.'}
          </small>
          <div className="path-input">
            <input
              value={vscodePath}
              onChange={(e) => setVscodePath(e.target.value)}
              placeholder="optional"
              disabled={!vscodeInstalled}
            />
            <button
              disabled={!vscodeInstalled || !agentPath}
              title="Agent-Ordner übernehmen"
              onClick={() => setVscodePath(agentPath)}
            >
              = Pfad 1
            </button>
            <button
              disabled={!vscodeInstalled}
              onClick={async () => {
                const p = await window.api.projects.pickFolder(vscodePath || agentPath || undefined)
                if (p) setVscodePath(p)
              }}
            >
              Durchsuchen …
            </button>
          </div>
        </label>

        <label>
          <span>
            Start-Flags <em>(optional)</em>
          </span>
          <input
            className="mono"
            value={agentArgs}
            onChange={(e) => setAgentArgs(e.target.value)}
            placeholder="z. B. --permission-mode plan"
            spellCheck={false}
          />
          {argsError ? (
            <small className="error">{argsError}</small>
          ) : (
            <AgentArgsHelp scope="project" />
          )}
        </label>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default ProjectDialog
