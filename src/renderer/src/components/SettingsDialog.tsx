import { useEffect, useState } from 'react'
import type {
  AgentTemplate,
  Engine,
  PromptTemplate,
  RemoteInfo,
  Settings,
  TeamTemplate,
  VoiceStatus
} from '../../../shared/types'
import { validateAgentArgs } from '../../../shared/agentArgs'
import { errorText } from '../lib/errors'
import AgentArgsHelp from './AgentArgsHelp'
import { DEFAULT_HOTKEYS } from '../../../shared/hotkeys'
import HotkeyInput from './HotkeyInput'
import Modal from './Modal'
import ProgramInput from './ProgramInput'
import VoiceModels from './VoiceModels'
import { canRememberLanguage, FIXED_LANGUAGES } from '../../../shared/voiceLanguage'
import { getLocale, LANGUAGE_CODES, LANGUAGES, type LanguageSetting } from '../../../shared/i18n'
import { syncLanguage, useT } from '../lib/i18n'

/** whisper language code → name in the interface language, e.g. "German" (fallback: the code) */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

interface Props {
  settings: Settings
  voiceStatus: VoiceStatus
  /** For displaying the default program for folders */
  vscodeInstalled: boolean
  templates: AgentTemplate[]
  /** null = create a new template */
  onEditTemplate: (t: AgentTemplate | null) => void
  onRemoveTemplate: (t: AgentTemplate) => void
  teamTemplates: TeamTemplate[]
  /** null = create a new team */
  onEditTeam: (t: TeamTemplate | null) => void
  onRemoveTeam: (t: TeamTemplate) => void
  onSettingsChanged: (s: Settings) => void
  onVoiceChanged: () => void
  onClose: () => void
  prompts: PromptTemplate[]
  /** null = create a new prompt */
  onEditPrompt: (p: PromptTemplate | null) => void
  onRemovePrompt: (p: PromptTemplate) => void
  engines: Engine[]
  /** null = create a new engine */
  onEditEngine: (e: Engine | null) => void
  onRemoveEngine: (e: Engine) => void
}

/** Number as a setting: draft kept locally, saved when leaving the field */
function NumberSetting(p: {
  label: string
  value: number
  help: string
  step?: number
  onSave: (value: number) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(p.value))
  const [error, setError] = useState<string | null>(null)
  return (
    <label>
      <span>{p.label}</span>
      <input
        type="number"
        min={0}
        step={p.step ?? 1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onBlur={() => {
          const n = Number(draft.replace(',', '.'))
          if (n === p.value) return
          p.onSave(n).catch((e) => setError(errorText(e)))
        }}
      />
      {error ? <small className="error">{error}</small> : <small className="muted">{p.help}</small>}
    </label>
  )
}

/** Remote access: switch, port and the addresses for the phone */
function RemoteSettings({
  settings,
  update
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}): React.JSX.Element {
  const t = useT()
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { remoteEnabled, remotePort, remoteToken } = settings
  useEffect(() => {
    let cancelled = false
    // Wait briefly: the server reports a port in use only after starting
    const timer = setTimeout(
      () => window.api.remote.info().then((i) => !cancelled && setInfo(i)),
      400
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [remoteEnabled, remotePort, remoteToken])
  const change = (patch: Partial<Settings>): void => {
    setError(null)
    update(patch).catch((e) => setError(errorText(e)))
  }
  return (
    <>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={remoteEnabled}
          onChange={(e) => change({ remoteEnabled: e.target.checked })}
        />
        {t('settings.remoteEnable')}
      </label>
      <small className="muted">{t('settings.remoteHelp')}</small>
      {remoteEnabled && (
        <div className="form">
          <NumberSetting
            key={remotePort}
            label={t('settings.remotePort')}
            value={remotePort}
            help="1024–65535"
            onSave={(port) => update({ remotePort: port })}
          />
          {info?.error && <small className="error">{info.error}</small>}
          {info?.running && (
            <div>
              {info.urls.length === 0 && (
                <small className="muted">{t('settings.remoteNoAddress')}</small>
              )}
              {info.urls.map((url) => (
                <div key={url} className="remote-url">
                  <code>{url}</code>
                  <button className="link" onClick={() => window.api.clipboard.writeText(url)}>
                    {t('settings.remoteCopy')}
                  </button>
                </div>
              ))}
              <button
                className="link"
                title={t('settings.remoteNewAddressTooltip')}
                onClick={() => change({ remoteToken: '' })}
              >
                {t('settings.remoteNewAddress')}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <small className="error">{error}</small>}
    </>
  )
}

/**
 * Program path as a setting: draft kept locally, saved when leaving the field or after
 * picking/resetting. The main process rejects invalid paths → error, old value stays.
 */
function ProgramSetting(p: {
  label: string
  value: string
  placeholder: string
  help: string
  onSave: (value: string) => Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState(p.value)
  const [error, setError] = useState<string | null>(null)
  const save = async (value: string): Promise<void> => {
    if (value.trim() === p.value) return
    try {
      await p.onSave(value)
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div className="form">
      <label>
        <span>{p.label}</span>
        <ProgramInput
          value={draft}
          onChange={(v) => {
            setDraft(v)
            setError(null)
          }}
          onCommit={save}
          placeholder={p.placeholder}
        />
        {error ? (
          <small className="error">{error}</small>
        ) : (
          <small className="muted">{p.help}</small>
        )}
      </label>
    </div>
  )
}

function SettingsDialog(props: Props): React.JSX.Element {
  const { settings, voiceStatus } = props
  const t = useT()

  const update = async (patch: Partial<Settings>): Promise<void> =>
    props.onSettingsChanged(await window.api.settings.update(patch))

  // Interface language: saved right away; the whole UI switches without a restart
  const changeLanguage = async (language: LanguageSetting): Promise<void> => {
    const next = await window.api.settings.update({ language })
    syncLanguage(next.language)
    props.onSettingsChanged(next)
  }

  // Start flags: draft kept locally, saved when leaving the field or closing
  const [argsDraft, setArgsDraft] = useState(settings.agentArgs)
  const [argsSaveError, setArgsSaveError] = useState<string | null>(null)
  const argsError = validateAgentArgs(argsDraft) ?? argsSaveError
  const saveArgs = async (): Promise<boolean> => {
    if (validateAgentArgs(argsDraft)) return false
    if (argsDraft.trim() === settings.agentArgs) return true
    try {
      await update({ agentArgs: argsDraft })
      return true
    } catch (e) {
      setArgsSaveError(errorText(e))
      return false
    }
  }
  // Invalid values are not saved (dialog closes anyway, old value stays)
  const close = async (): Promise<void> => {
    await saveArgs()
    props.onClose()
  }

  return (
    <Modal
      title={t('common.settings')}
      onClose={close}
      width={600}
      footer={<button onClick={close}>{t('common.close')}</button>}
    >
      <section className="settings-section">
        <h3>🌐 {t('settings.languageTitle')}</h3>
        <div className="form">
          <label>
            <span>{t('settings.languageLabel')}</span>
            <select
              value={settings.language}
              onChange={(e) => changeLanguage(e.target.value as LanguageSetting)}
            >
              <option value="system">{t('settings.languageSystem')}</option>
              {LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGES[code].name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settings.agentStartTitle')}</h3>
        <div className="form">
          <label>
            <span>{t('settings.agentArgsLabel')}</span>
            <input
              className="mono"
              value={argsDraft}
              onChange={(e) => {
                setArgsDraft(e.target.value)
                setArgsSaveError(null)
              }}
              onBlur={saveArgs}
              placeholder={t('settings.agentArgsPlaceholder')}
              spellCheck={false}
            />
          </label>
        </div>
        {argsError ? <p className="error small">{argsError}</p> : <AgentArgsHelp scope="global" />}
      </section>

      <section className="settings-section">
        <h3>{t('settings.templatesTitle')}</h3>
        {props.templates.length > 0 && (
          <div className="template-list">
            {props.templates.map((tpl) => (
              <div key={tpl.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{tpl.name}</span>
                  <span className="muted">
                    {' · '}
                    {tpl.model || t('settings.templateModelFromFlags')}
                    {tpl.instructions ? ` · ${tpl.instructions}` : ''}
                  </span>
                </span>
                <button className="link" onClick={() => props.onEditTemplate(tpl)}>
                  {t('common.edit')}
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(t('settings.confirmDeleteTemplate', { name: tpl.name })))
                      props.onRemoveTemplate(tpl)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditTemplate(null)}>{t('settings.newTemplate')}</button>
        <p className="muted small">{t('settings.templatesHelp')}</p>
      </section>

      <section className="settings-section">
        <h3>{t('common.teams')}</h3>
        {props.teamTemplates.length > 0 && (
          <div className="template-list">
            {props.teamTemplates.map((team) => (
              <div key={team.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{team.name}</span>
                  <span className="muted">
                    {' · '}
                    {team.members
                      .map(
                        (m) =>
                          props.templates.find((x) => x.id === m.templateId)?.name ??
                          t('common.agent')
                      )
                      .join(', ')}
                  </span>
                </span>
                <button className="link" onClick={() => props.onEditTeam(team)}>
                  {t('common.edit')}
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(t('settings.confirmDeleteTeam', { name: team.name })))
                      props.onRemoveTeam(team)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditTeam(null)}>{t('settings.newTeam')}</button>
        <p className="muted small">{t('settings.teamsHelp')}</p>
      </section>

      <section className="settings-section">
        <h3>{t('settings.promptsTitle')}</h3>
        {props.prompts.length > 0 && (
          <div className="template-list">
            {props.prompts.map((p) => (
              <div key={p.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{p.name}</span>
                  <span className="muted"> · {p.text}</span>
                </span>
                <button className="link" onClick={() => props.onEditPrompt(p)}>
                  {t('common.edit')}
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(t('settings.confirmDeletePrompt', { name: p.name })))
                      props.onRemovePrompt(p)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditPrompt(null)}>{t('settings.newPrompt')}</button>
        <p className="muted small">{t('settings.promptsHelp')}</p>
      </section>

      <section className="settings-section">
        <h3>{t('settings.enginesTitle')}</h3>
        {props.engines.length > 0 && (
          <div className="template-list">
            {props.engines.map((e) => (
              <div key={e.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{e.name}</span>
                  <span className="muted"> · {e.command}</span>
                </span>
                <button className="link" onClick={() => props.onEditEngine(e)}>
                  {t('common.edit')}
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(t('settings.confirmDeleteEngine', { name: e.name })))
                      props.onRemoveEngine(e)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditEngine(null)}>{t('settings.newEngine')}</button>
        <p className="muted small">{t('settings.enginesHelp')}</p>
      </section>

      <section className="settings-section">
        <h3>{t('settings.inboxTitle')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.notifyOnWaiting}
            onChange={(e) => update({ notifyOnWaiting: e.target.checked })}
          />
          {t('settings.notifyOnWaiting')}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.permissionInbox}
            onChange={(e) => update({ permissionInbox: e.target.checked })}
          />
          {t('settings.permissionInbox')}
        </label>
        <small className="muted">{t('settings.permissionInboxHelp')}</small>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.voiceReadback}
            onChange={(e) => update({ voiceReadback: e.target.checked })}
          />
          {t('settings.voiceReadback')}
        </label>
        <small className="muted">{t('settings.voiceReadbackHelp')}</small>
      </section>

      <section className="settings-section">
        <h3>{t('settings.usageTitle')}</h3>
        <div className="form">
          <NumberSetting
            label={t('settings.contextWarnLabel')}
            value={settings.contextWarnTokens}
            step={10000}
            help={t('settings.contextWarnHelp')}
            onSave={(contextWarnTokens) => update({ contextWarnTokens })}
          />
          <NumberSetting
            label={t('settings.priceInputLabel')}
            value={settings.priceInput}
            step={0.5}
            help={t('settings.priceInputHelp')}
            onSave={(priceInput) => update({ priceInput })}
          />
          <NumberSetting
            label={t('settings.priceOutputLabel')}
            value={settings.priceOutput}
            step={0.5}
            help={t('settings.priceOutputHelp')}
            onSave={(priceOutput) => update({ priceOutput })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settings.remoteTitle')}</h3>
        <RemoteSettings settings={settings} update={update} />
      </section>

      <section className="settings-section">
        <h3>{t('settings.filePreviewTitle')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.showEditedFiles}
            onChange={(e) => update({ showEditedFiles: e.target.checked })}
          />
          {t('settings.showEditedFiles')}
        </label>
        <small className="muted">{t('settings.showEditedFilesHelp')}</small>
      </section>

      <section className="settings-section">
        <h3>{t('settings.openWithTitle')}</h3>
        <ProgramSetting
          label={t('settings.projectFileAppLabel')}
          value={settings.projectFileApp}
          placeholder={t('settings.projectFileAppPlaceholder')}
          help={t('settings.projectFileAppHelp')}
          onSave={(projectFileApp) => update({ projectFileApp })}
        />
        <ProgramSetting
          label={t('settings.folderAppLabel')}
          value={settings.folderApp}
          placeholder={props.vscodeInstalled ? 'VS Code' : t('settings.windowsExplorer')}
          help={
            props.vscodeInstalled
              ? t('settings.folderAppHelpVscode')
              : t('settings.folderAppHelpExplorer')
          }
          onSave={(folderApp) => update({ folderApp })}
        />
        <small className="muted">{t('settings.openWithPerProject')}</small>
      </section>

      <section className="settings-section">
        <h3>{t('settings.voiceModelTitle')}</h3>
        <VoiceModels status={voiceStatus} onChanged={props.onVoiceChanged} />
      </section>

      <section className="settings-section">
        <h3>{t('settings.voiceTitle')}</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.voiceAutoSend}
            onChange={(e) => update({ voiceAutoSend: e.target.checked })}
          />
          {t('settings.voiceAutoSend')}
        </label>
        <small className="muted">{t('settings.voiceAutoSendHelp')}</small>
        <div className="form">
          <label>
            <span>{t('settings.spokenLanguageLabel')}</span>
            <select
              value={settings.voiceFixedLanguage ?? ''}
              onChange={(e) => update({ voiceFixedLanguage: e.target.value || null })}
            >
              <option value="">{t('settings.spokenLanguageAuto')}</option>
              {FIXED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {t('settings.spokenLanguageAlways', { language: languageName(code) })}
                </option>
              ))}
            </select>
          </label>
        </div>
        {settings.voiceFixedLanguage ? (
          <small className="muted">{t('settings.spokenLanguageFixedHelp')}</small>
        ) : (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.voiceRememberLanguage}
              onChange={(e) => update({ voiceRememberLanguage: e.target.checked })}
            />
            {t('settings.voiceRememberLanguage')}
          </label>
        )}
        {!settings.voiceFixedLanguage && settings.voiceRememberLanguage && (
          <small className="muted">
            {canRememberLanguage(settings.voiceLanguage) ? (
              <>
                {t('settings.rememberedBefore')}
                <strong>{languageName(settings.voiceLanguage)}</strong>
                {t('settings.rememberedAfter')}{' '}
                <button className="link" onClick={() => update({ voiceLanguage: null })}>
                  {t('settings.rememberedForget')}
                </button>
              </>
            ) : (
              t('settings.rememberedNone')
            )}
          </small>
        )}
      </section>

      <section className="settings-section">
        <h3>{t('settings.hotkeysTitle')}</h3>
        <table className="hotkeys">
          <tbody>
            <tr>
              <td>
                <HotkeyInput
                  value={settings.hotkeyAgentVoice}
                  defaultValue={DEFAULT_HOTKEYS.agentVoice}
                  onChange={(hotkeyAgentVoice) => update({ hotkeyAgentVoice })}
                />
              </td>
              <td>{t('settings.hotkeyAgentVoice')}</td>
            </tr>
            <tr>
              <td>
                <HotkeyInput
                  global
                  value={settings.hotkeyGlobalVoice}
                  defaultValue={DEFAULT_HOTKEYS.globalVoice}
                  onChange={(hotkeyGlobalVoice) => update({ hotkeyGlobalVoice })}
                />
              </td>
              <td>{t('settings.hotkeyGlobalVoice')}</td>
            </tr>
            <tr>
              <td>
                <HotkeyInput
                  value={settings.hotkeyEditor}
                  defaultValue={DEFAULT_HOTKEYS.editor}
                  onChange={(hotkeyEditor) => update({ hotkeyEditor })}
                />
              </td>
              <td>{t('settings.hotkeyEditor')}</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>{t('settings.hotkeyCancelRecording')}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">{t('settings.hotkeysHelp')}</p>
      </section>
    </Modal>
  )
}

export default SettingsDialog
