import { useState } from 'react'
import type { Project, ScannedProject } from '../../../shared/types'
import { validateAgentArgs } from '../../../shared/agentArgs'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import AgentArgsHelp from './AgentArgsHelp'
import Modal from './Modal'

interface Props {
  onClose: () => void
  /** After the import: newly created projects */
  onImported: (projects: Project[]) => void
}

interface Row extends ScannedProject {
  checked: boolean
}

/**
 * Import projects: pick one or more folders (Ctrl+click), e.g. a whole "Dev" folder.
 * It is scanned for projects (Git, .sln, package.json … – also in subfolders), and the
 * project file is looked up automatically for each. Start flags apply to all of them.
 */
function ImportProjectsDialog({ onClose, onImported }: Props): React.JSX.Element {
  const t = useT()
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
      // Add to previous results (same path only once)
      setRows((prev) => {
        const known = new Set(prev.map((r) => r.path.toLowerCase()))
        const added = found
          .filter((f) => !known.has(f.path.toLowerCase()))
          .map((f) => ({ ...f, checked: !f.registered }))
        return [...prev, ...added]
      })
      if (!found.length) setError(t('project.importNoneFound'))
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
      // Don't offer successful ones again
      const ok = new Set(saved.map((p) => p.agentPath))
      setRows((rs) =>
        rs.map((r) => (ok.has(r.path) ? { ...r, registered: true, checked: false } : r))
      )
      setError(t('project.importNotAdded', { list: failed.join('\n') }))
      if (saved.length) onImported(saved)
      return
    }
    onImported(saved)
    onClose()
  }

  return (
    <Modal
      title={t('project.importTitle')}
      onClose={onClose}
      width={760}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={save}
            disabled={busy !== null || chosen.length === 0 || !!argsError}
          >
            {t('project.importAdd', { count: chosen.length })}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="import-pick">
          <button onClick={pick} disabled={busy !== null}>
            {rows.length ? t('project.importPickMoreFolders') : t('project.importPickFolders')}
          </button>
          <small className="muted">{t('project.importPickHint')}</small>
        </div>

        {busy === 'scan' && <p className="muted">{t('project.importScanning')}</p>}

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
              {roots.length === 1
                ? t('project.importFoundInFolder', { count: rows.length, folder: roots[0] })
                : t('project.importFoundInFolders', { count: rows.length, folders: roots.length })}
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
                  title={t('project.importNameTooltip')}
                />
                <span className="import-info">
                  <span className="import-path" title={r.path}>
                    {r.path}
                  </span>
                  <small className="muted">
                    <span className="team-tag">{r.marker}</span>{' '}
                    {r.registered
                      ? t('project.importAlreadyRegistered')
                      : r.projectFile
                        ? t('project.importProjectFile', {
                            file: r.projectFile.split(/[\\/]/).pop() ?? ''
                          })
                        : t('project.importNoProjectFile')}
                  </small>
                </span>
              </div>
            ))}
          </div>
        )}

        <label>
          <span>
            {t('project.importStartFlagsLabel')} <em>{t('project.optionalTag')}</em>
          </span>
          <input
            className="mono"
            value={agentArgs}
            onChange={(e) => setAgentArgs(e.target.value)}
            placeholder={t('project.startFlagsPlaceholder')}
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
