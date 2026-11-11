import { useState } from 'react'
import type { Project, ScannedProject } from '../../../shared/types'
import { validateAgentArgs } from '../../../shared/agentArgs'
import { errorText } from '../lib/errors'
import AgentArgsHelp from './AgentArgsHelp'
import Modal from './Modal'

interface Props {
  onClose: () => void
  /** Nach dem Import: neu angelegte Projekte */
  onImported: (projects: Project[]) => void
}

interface Row extends ScannedProject {
  checked: boolean
}

/**
 * Projekte importieren: einen oder mehrere Ordner wählen (Strg+Klick), z. B. einen ganzen
 * „Dev“-Ordner. Er wird nach Projekten durchsucht (Git, .sln, package.json … – auch in
 * Unterordnern), die Projektdatei wird jeweils automatisch gesucht. Start-Flags gelten für alle.
 */
function ImportProjectsDialog({ onClose, onImported }: Props): React.JSX.Element {
  const [rows, setRows] = useState<Row[]>([])
  const [roots, setRoots] = useState<string[]>([])
  const [agentArgs, setAgentArgs] = useState('')
  const [busy, setBusy] = useState<'scan' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const argsError = validateAgentArgs(agentArgs)

  const pick = async (): Promise<void> => {
    const dirs = await window.api.projects.pickFolders()
    if (!dirs.length) return
    setBusy('scan')
    setError(null)
    try {
      const found = await window.api.projects.scan(dirs)
      setRoots((r) => [...new Set([...r, ...dirs])])
      // Zu bisherigen Treffern hinzufügen (gleicher Pfad nur einmal)
      setRows((prev) => {
        const known = new Set(prev.map((r) => r.path.toLowerCase()))
        const added = found
          .filter((f) => !known.has(f.path.toLowerCase()))
          .map((f) => ({ ...f, checked: !f.registered }))
        return [...prev, ...added]
      })
      if (!found.length) setError('In den gewählten Ordnern wurden keine Projekte gefunden.')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const update = (path: string, patch: Partial<Row>): void =>
    setRows((rs) => rs.map((r) => (r.path === path ? { ...r, ...patch } : r)))

  const selectable = rows.filter((r) => !r.registered)
  const chosen = selectable.filter((r) => r.checked)
  const allChecked = selectable.length > 0 && chosen.length === selectable.length

  const save = async (): Promise<void> => {
    setBusy('save')
    setError(null)
    const saved: Project[] = []
    const failed: string[] = []
    for (const r of chosen) {
      try {
        saved.push(
          await window.api.projects.save({
            name: r.name.trim() || r.path,
            agentPath: r.path,
            projectFile: r.projectFile ?? undefined,
            folderPath: r.path,
            agentArgs: agentArgs.trim() || undefined
          })
        )
      } catch (e) {
        failed.push(`${r.name}: ${errorText(e)}`)
      }
    }
    setBusy(null)
    if (failed.length) {
      // Erfolgreiche nicht erneut anbieten
      const ok = new Set(saved.map((p) => p.agentPath))
      setRows((rs) =>
        rs.map((r) => (ok.has(r.path) ? { ...r, registered: true, checked: false } : r))
      )
      setError(`Nicht hinzugefügt:\n${failed.join('\n')}`)
      if (saved.length) onImported(saved)
      return
    }
    onImported(saved)
    onClose()
  }

  return (
    <Modal
      title="Projekte importieren"
      onClose={onClose}
      width={760}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            onClick={save}
            disabled={busy !== null || chosen.length === 0 || !!argsError}
          >
            {chosen.length === 1 ? '1 Projekt hinzufügen' : `${chosen.length} Projekte hinzufügen`}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="import-pick">
          <button onClick={pick} disabled={busy !== null}>
            {rows.length ? 'Weitere Ordner auswählen …' : 'Ordner auswählen …'}
          </button>
          <small className="muted">
            Ein Ordner mit mehreren Projekten (z. B. „C:\Dev“) oder einzelne Projektordner – mit
            Strg+Klick mehrere. Gesucht wird nach Git, .sln, .csproj, package.json, pyproject.toml
            u. a., auch in Unterordnern; die Projektdatei (.sln) wird automatisch gesucht.
          </small>
        </div>

        {busy === 'scan' && <p className="muted">Durchsuche Ordner …</p>}

        {rows.length > 0 && (
          <div className="import-list">
            <label className="checkbox import-all">
              <input
                type="checkbox"
                checked={allChecked}
                disabled={!selectable.length}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r) => (r.registered ? r : { ...r, checked: e.target.checked }))
                  )
                }
              />
              {rows.length} gefunden in {roots.length === 1 ? roots[0] : `${roots.length} Ordnern`}
            </label>
            {rows.map((r) => (
              <div key={r.path} className={`import-row ${r.registered ? 'registered' : ''}`}>
                <input
                  type="checkbox"
                  checked={r.checked}
                  disabled={r.registered}
                  onChange={(e) => update(r.path, { checked: e.target.checked })}
                />
                <input
                  className="import-name"
                  value={r.name}
                  disabled={r.registered}
                  onChange={(e) => update(r.path, { name: e.target.value })}
                  title="Name des Projekts"
                />
                <span className="import-info">
                  <span className="import-path" title={r.path}>
                    {r.path}
                  </span>
                  <small className="muted">
                    <span className="team-tag">{r.marker}</span>{' '}
                    {r.registered
                      ? 'bereits registriert'
                      : r.projectFile
                        ? `Projektdatei: ${r.projectFile.split(/[\\/]/).pop()}`
                        : 'keine Projektdatei gefunden'}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}

        <label>
          <span>
            Start-Flags für alle <em>(optional)</em>
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

        {error && <p className="error import-error">{error}</p>}
      </div>
    </Modal>
  )
}

export default ImportProjectsDialog
