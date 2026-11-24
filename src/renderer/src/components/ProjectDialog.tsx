import { useState } from 'react'
import type { Project } from '../../../shared/types'
import Modal from './Modal'
import { errorText } from '../lib/errors'
import { validateAgentArgs } from '../../../shared/agentArgs'
import { useT } from '../lib/i18n'
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
  const t = useT()
  const [name, setName] = useState(project?.name ?? '')
  const [agentPath, setAgentPath] = useState(project?.agentPath ?? '')
  const [projectFile, setProjectFile] = useState(project?.projectFile ?? '')
  const [projectFileApp, setProjectFileApp] = useState(project?.projectFileApp ?? '')
  const [folderPath, setFolderPath] = useState(project?.folderPath ?? '')
  const [folderApp, setFolderApp] = useState(project?.folderApp ?? '')
  const folderDefault = vscodeInstalled ? 'VS Code' : t('project.windowsExplorer')
  const [agentArgs, setAgentArgs] = useState(project?.agentArgs ?? '')
  const argsError = validateAgentArgs(agentArgs)
  const [useWorktrees, setUseWorktrees] = useState(project?.useWorktrees ?? false)
  const [checks, setChecks] = useState(project?.checks ?? '')
  /** Commands as text: one "name = command" per line */
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
      title={project ? t('project.editTitle') : t('project.addTitle')}
      onClose={onClose}
      width={600}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="primary"
            onClick={save}
            disabled={saving || !agentPath.trim() || !!argsError}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>{t('common.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={agentPath ? folderName(agentPath) : t('project.namePlaceholder')}
            autoFocus
          />
        </label>

        <label>
          <span>
            {t('project.agentFolderLabel')} <em>{t('project.requiredTag')}</em>
          </span>
          <small className="muted">{t('project.agentFolderHint')}</small>
          <div className="path-input">
            <input
              value={agentPath}
              onChange={(e) => setAgentPath(e.target.value)}
              onBlur={() => detectSolution(agentPath)}
              placeholder={t('project.agentFolderPlaceholder')}
            />
            <button onClick={pickAgentPath}>{t('common.browse')}</button>
          </div>
        </label>

        <label>
          <span>{t('project.projectFileLabel')}</span>
          <small className="muted">
            {autoFile && projectFile === autoFile
              ? t('project.projectFileFoundHint')
              : t('project.projectFileHint')}
          </small>
          <div className="path-input">
            <input
              value={projectFile}
              onChange={(e) => setProjectFile(e.target.value)}
              placeholder={t('common.optional')}
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
              {t('common.browse')}
            </button>
          </div>
        </label>

        {projectFile.trim() && (
          <label>
            <span>
              {t('project.openWithLabel')} <em>{t('project.optionalTag')}</em>
            </span>
            <small className="muted">
              {globalProjectFileApp
                ? t('project.projectFileAppHintSettings')
                : t('project.projectFileAppHintDefault')}
            </small>
            <ProgramInput
              value={projectFileApp}
              onChange={setProjectFileApp}
              placeholder={globalProjectFileApp || t('project.windowsDefaultProgram')}
            />
          </label>
        )}

        <label>
          <span>{t('project.folderLabel')}</span>
          <small className="muted">{t('project.folderHint')}</small>
          <div className="path-input">
            <input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder={t('common.optional')}
            />
            <button
              disabled={!agentPath}
              title={t('project.useAgentFolderTooltip')}
              onClick={() => setFolderPath(agentPath)}
            >
              {t('project.useAgentFolder')}
            </button>
            <button
              onClick={async () => {
                const p = await window.api.projects.pickFolder(folderPath || agentPath || undefined)
                if (p) setFolderPath(p)
              }}
            >
              {t('common.browse')}
            </button>
          </div>
        </label>

        {folderPath.trim() && (
          <label>
            <span>
              {t('project.openWithLabel')} <em>{t('project.optionalTag')}</em>
            </span>
            <small className="muted">
              {globalFolderApp
                ? t('project.folderAppHintSettings')
                : t('project.folderAppHintDefault', { program: folderDefault })}
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
            {t('project.startFlagsLabel')} <em>{t('project.optionalTag')}</em>
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={useWorktrees}
            onChange={(e) => setUseWorktrees(e.target.checked)}
          />
          {t('project.useWorktrees')}
        </label>
        <small className="muted">{t('project.useWorktreesHint')}</small>

        <label>
          <span>
            {t('project.checksLabel')} <em>{t('project.optionalTag')}</em>
          </span>
          <textarea
            className="mono"
            rows={3}
            value={checks}
            onChange={(e) => setChecks(e.target.value)}
            placeholder={'npm run typecheck\nnpm run lint'}
            spellCheck={false}
          />
          <small className="muted">{t('project.checksHint')}</small>
        </label>

        <label>
          <span>
            {t('project.runCommandsLabel')} <em>{t('project.optionalTag')}</em>
          </span>
          <textarea
            className="mono"
            rows={3}
            value={runText}
            onChange={(e) => setRunText(e.target.value)}
            placeholder={'dev = npm run dev\ntest = npm test'}
            spellCheck={false}
          />
          <small className="muted">{t('project.runCommandsHint')}</small>
        </label>

        <label>
          <span>
            {t('project.previewLabel')} <em>{t('project.optionalTag')}</em>
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
            {t('project.permissionRulesLabel')} <em>{t('project.optionalTag')}</em>
          </span>
          <textarea
            className="mono"
            rows={3}
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            placeholder={'Bash:npm test\nBash:git status\nEdit'}
            spellCheck={false}
          />
          <small className="muted">{t('project.permissionRulesHint')}</small>
        </label>

        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export default ProjectDialog
