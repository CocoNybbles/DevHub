import { useState } from 'react'
import type { Project } from '../../../shared/types'
import Modal from './Modal'
import { errorText } from '../lib/errors'
import { validateAgentArgs } from '../../../shared/agentArgs'
import AgentArgsHelp from './AgentArgsHelp'
import ProgramInput from './ProgramInput'

interface Props {
  project: Project | null
  /** Only for displaying the default program for folders (VS Code or Explorer) */
  vscodeInstalled: boolean
  /** Global programs from the settings, '' = default */
  globalProjectFileApp: string
  globalFolderApp: string
  onSaved: (p: Project) => void
  onClose: () => void
}

const folderName = (path: string): string =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() ?? ''

/** Create/edit a project with its three paths. */
function ProjectDialog({
  project,
  vscodeInstalled,
  globalProjectFileApp,
  globalFolderApp,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  const [name, setName] = useState(project?.name ?? '')
  const [agentPath, setAgentPath] = useState(project?.agentPath ?? '')
  const [projectFile, setProjectFile] = useState(project?.projectFile ?? '')
  const [projectFileApp, setProjectFileApp] = useState(project?.projectFileApp ?? '')
  const [folderPath, setFolderPath] = useState(project?.folderPath ?? '')
  const [folderApp, setFolderApp] = useState(project?.folderApp ?? '')
  const folderDefault = vscodeInstalled ? 'VS Code' : 'Windows-Explorer'
  const [agentArgs, setAgentArgs] = useState(project?.agentArgs ?? '')
  const argsError = validateAgentArgs(agentArgs)
  const [useWorktrees, setUseWorktrees] = useState(project?.useWorktrees ?? false)
  const [checks, setChecks] = useState(project?.checks ?? '')
  /** Befehle als Text: je Zeile „Name = Befehl“ */
  const [runText, setRunText] = useState(
    (project?.runCommands ?? []).map((c) => `${c.name} = ${c.command}`).join('\n')
  )
  const [previewUrl, setPreviewUrl] = useState(project?.previewUrl ?? '')
  const [rulesText, setRulesText] = useState((project?.permissionRules ?? []).join('\n'))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** Solution most recently filled in automatically (may be replaced when the folder changes). */
  const [autoFile, setAutoFile] = useState<string | null>(null)

  /** Looks for a .sln in the agent folder as long as no project file was set by hand. */
  const detectSolution = async (dir: string): Promise<void> => {
    if (!dir.trim() || (projectFile && projectFile !== autoFile)) return
    const found = await window.api.projects.findSolution(dir.trim()).catch(() => null)
    setProjectFile(found ?? '')
    setAutoFile(found)
  }

  const pickAgentPath = async (): Promise<void> => {
    const p = await window.api.projects.pickFolder(agentPath || undefined)
    if (!p) return
    setAgentPath(p)
    if (!name.trim()) setName(folderName(p))
    await detectSolution(p)
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
        projectFileApp: (projectFile.trim() && projectFileApp.trim()) || undefined,
        folderPath: folderPath.trim() || undefined,
        folderApp: (folderPath.trim() && folderApp.trim()) || undefined,
        agentArgs: agentArgs.trim() || undefined,
        useWorktrees,
        checks,
        runCommands: runText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const at = line.indexOf('=')
            return at < 0
              ? { name: line, command: '' }
              : { name: line.slice(0, at).trim(), command: line.slice(at + 1).trim() }
          }),
        previewUrl,
        permissionRules: rulesText.split('\n')
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
              onBlur={() => detectSolution(agentPath)}
              placeholder="C:\Dev\MeinProjekt"
            />
            <button onClick={pickAgentPath}>Durchsuchen …</button>
          </div>
        </label>

        <label>
          <span>2 · Projektdatei</span>
          <small className="muted">
            {autoFile && projectFile === autoFile
              ? 'Automatisch im Agent-Ordner gefunden.'
              : '.sln oder Projektdatei, z. B. zum Öffnen in Visual Studio oder Rider.'}
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
                if (p) {
                  setProjectFile(p)
                  setAutoFile(null)
                }
              }}
            >
              Durchsuchen …
            </button>
          </div>
        </label>

        {projectFile.trim() && (
          <label>
            <span>
              Öffnen mit <em>(optional)</em>
            </span>
            <small className="muted">
              {`Programm für die Projektdatei, z. B. Rider oder eine bestimmte Visual-Studio-Version. Leer = ${
                globalProjectFileApp ? 'Programm aus den Einstellungen' : 'Windows-Standardprogramm'
              }.`}
            </small>
            <ProgramInput
              value={projectFileApp}
              onChange={setProjectFileApp}
              placeholder={globalProjectFileApp || 'Windows-Standardprogramm'}
            />
          </label>
        )}

        <label>
          <span>3 · Ordner</span>
          <small className="muted">Ordner, der in einem Editor geöffnet wird, z. B. VS Code.</small>
          <div className="path-input">
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="optional"
            />
            <button
              disabled={!agentPath}
              title="Agent-Ordner übernehmen"
              onClick={() => setFolderPath(agentPath)}
            >
              = Pfad 1
            </button>
            <button
              onClick={async () => {
                const p = await window.api.projects.pickFolder(folderPath || agentPath || undefined)
                if (p) setFolderPath(p)
              }}
            >
              Durchsuchen …
            </button>
          </div>
        </label>

        {folderPath.trim() && (
          <label>
            <span>
              Öffnen mit <em>(optional)</em>
            </span>
            <small className="muted">
              {`Programm für den Ordner, z. B. Cursor oder ein anderer Editor. Leer = ${
                globalFolderApp ? 'Programm aus den Einstellungen' : folderDefault
              }.`}
            </small>
            <ProgramInput
              value={folderApp}
              onChange={setFolderApp}
              placeholder={globalFolderApp || folderDefault}
            />
          </label>
        )}

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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useWorktrees}
            onChange={(e) => setUseWorktrees(e.target.checked)}
          />
          Jeder Agent arbeitet in einem eigenen Git-Worktree (eigener Branch)
        </label>
        <small className="muted">
          Mehrere Agents stören sich so nicht gegenseitig; ihre Änderungen prüfst und führst du über
          „Änderungen prüfen“ zusammen. Braucht ein Git-Repository mit mindestens einem Commit.
          Nicht versionierte Dateien (z. B. node_modules, .env) fehlen im Worktree.
        </small>

        <label>
          <span>
            Prüfungen bei „Fertig“ <em>(optional)</em>
          </span>
          <textarea
            className="mono"
            rows={3}
            value={checks}
            onChange={(e) => setChecks(e.target.value)}
            placeholder={'npm run typecheck\nnpm run lint'}
            spellCheck={false}
          />
          <small className="muted">
            Ein Befehl je Zeile. Hat ein Agent Dateien geändert und meldet fertig, laufen sie in
            seinem Arbeitsverzeichnis; schlägt einer fehl, bekommt der Agent die Ausgabe und bessert
            nach (höchstens dreimal je Anweisung).
          </small>
        </label>

        <label>
          <span>
            Befehle zum Ausführen <em>(optional)</em>
          </span>
          <textarea
            className="mono"
            rows={3}
            value={runText}
            onChange={(e) => setRunText(e.target.value)}
            placeholder={'dev = npm run dev\ntest = npm test'}
            spellCheck={false}
          />
          <small className="muted">
            Je Zeile „Name = Befehl“. Start/Stopp und Ausgabe unter „Ausführen“ (Rechtsklick aufs
            Projekt); Agents können die Ausgabe lesen.
          </small>
        </label>

        <label>
          <span>
            Web-Vorschau <em>(optional)</em>
          </span>
          <input
            className="mono"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="http://localhost:5173"
            spellCheck={false}
          />
        </label>

        <label>
          <span>
            Freigabe-Regeln <em>(optional)</em>
          </span>
          <textarea
            className="mono"
            rows={3}
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            placeholder={'Bash:npm test\nBash:git status\nEdit'}
            spellCheck={false}
          />
          <small className="muted">
            Eine Regel je Zeile: Tool-Name (z. B. Edit) oder „Bash:Befehlsanfang“. Passende Aufrufe
            werden für Agents dieses Projekts ohne Nachfrage erlaubt; verkettete Befehle
            (&amp;&amp;, |, ; …) passen nie. „Immer“ im Eingang trägt hier Regeln ein.
          </small>
        </label>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default ProjectDialog
