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

/** whisper language code → "Deutsch", "Englisch" … (fallback: the code) */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['de'], { type: 'language' }).of(code) ?? code
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
  /** null = neuen Prompt anlegen */
  onEditPrompt: (p: PromptTemplate | null) => void
  onRemovePrompt: (p: PromptTemplate) => void
  engines: Engine[]
  /** null = neue Engine anlegen */
  onEditEngine: (e: Engine | null) => void
  onRemoveEngine: (e: Engine) => void
}

/** Zahl als Einstellung: Entwurf lokal, gespeichert beim Verlassen des Feldes */
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

/** Fernzugriff: Schalter, Port und die Adressen fürs Handy */
function RemoteSettings({
  settings,
  update
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}): React.JSX.Element {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { remoteEnabled, remotePort, remoteToken } = settings
  useEffect(() => {
    let cancelled = false
    // Kurz warten: der Server meldet einen belegten Port erst nach dem Start
    const t = setTimeout(() => window.api.remote.info().then((i) => !cancelled && setInfo(i)), 400)
    return () => {
      cancelled = true
      clearTimeout(t)
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
        Fernzugriff im lokalen Netz einschalten (z. B. fürs Handy)
      </label>
      <small className="muted">
        Zeigt die Agents mit Status und letzter Antwort, nimmt Anweisungen an und entscheidet
        Freigaben aus dem Eingang. Die Verbindung ist unverschlüsselt (HTTP) und nur durch den
        geheimen Teil der Adresse geschützt – nur in einem vertrauenswürdigen Netz bzw. über ein VPN
        nutzen. Windows fragt beim ersten Einschalten ggf. nach der Firewall-Freigabe.
      </small>
      {remoteEnabled && (
        <div className="form">
          <NumberSetting
            key={remotePort}
            label="Port"
            value={remotePort}
            help="1024–65535"
            onSave={(port) => update({ remotePort: port })}
          />
          {info?.error && <small className="error">{info.error}</small>}
          {info?.running && (
            <div>
              {info.urls.length === 0 && (
                <small className="muted">Keine Netzwerkadresse gefunden.</small>
              )}
              {info.urls.map((url) => (
                <div key={url} className="remote-url">
                  <code>{url}</code>
                  <button className="link" onClick={() => window.api.clipboard.writeText(url)}>
                    kopieren
                  </button>
                </div>
              ))}
              <button
                className="link"
                title="Erzeugt eine neue Adresse – bisherige Links funktionieren danach nicht mehr"
                onClick={() => change({ remoteToken: '' })}
              >
                Neue Adresse erzeugen
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

  const update = async (patch: Partial<Settings>): Promise<void> =>
    props.onSettingsChanged(await window.api.settings.update(patch))

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
      title="Einstellungen"
      onClose={close}
      width={600}
      footer={<button onClick={close}>Schließen</button>}
    >
      <section className="settings-section">
        <h3>Agent-Start</h3>
        <div className="form">
          <label>
            <span>Zusätzliche Start-Flags für alle Agents</span>
            <input
              className="mono"
              value={argsDraft}
              onChange={(e) => {
                setArgsDraft(e.target.value)
                setArgsSaveError(null)
              }}
              onBlur={saveArgs}
              placeholder="z. B. --permission-mode auto"
              spellCheck={false}
            />
          </label>
        </div>
        {argsError ? <p className="error small">{argsError}</p> : <AgentArgsHelp scope="global" />}
      </section>

      <section className="settings-section">
        <h3>Vordefinierte Agents</h3>
        {props.templates.length > 0 && (
          <div className="template-list">
            {props.templates.map((t) => (
              <div key={t.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{t.name}</span>
                  <span className="muted">
                    {' · '}
                    {t.model || 'Modell aus Start-Flags'}
                    {t.instructions ? ` · ${t.instructions}` : ''}
                  </span>
                </span>
                <button className="link" onClick={() => props.onEditTemplate(t)}>
                  Bearbeiten
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Vorlage „${t.name}“ löschen?`)) props.onRemoveTemplate(t)
                  }}
                >
                  Löschen
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditTemplate(null)}>Neuer vordefinierter Agent …</button>
        <p className="muted small">
          Benannte Agents mit eigenem Modell und eigenen Richtlinien. Start über den ▶-Button am
          Projekt oder per Sprache („Starte einen Entwickler für DevHub, der …“); laufende sprichst
          du mit ihrem Namen an.
        </p>
      </section>

      <section className="settings-section">
        <h3>Teams</h3>
        {props.teamTemplates.length > 0 && (
          <div className="template-list">
            {props.teamTemplates.map((t) => (
              <div key={t.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{t.name}</span>
                  <span className="muted">
                    {' · '}
                    {t.members
                      .map(
                        (m) => props.templates.find((x) => x.id === m.templateId)?.name ?? 'Agent'
                      )
                      .join(', ')}
                  </span>
                </span>
                <button className="link" onClick={() => props.onEditTeam(t)}>
                  Bearbeiten
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Team „${t.name}“ löschen?`)) props.onRemoveTeam(t)
                  }}
                >
                  Löschen
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditTeam(null)}>Neues Team …</button>
        <p className="muted small">
          Mehrere Agents, die zusammen für ein Projekt starten und sich Nachrichten schicken dürfen.
          Start über ▶ am Projekt oder per Sprache („Starte das Team Feature für DevHub“). Per
          Sprache geht auch ein temporäres Team: „Starte einen Entwickler und einen Reviewer als
          Team für DevHub, …“.
        </p>
      </section>

      <section className="settings-section">
        <h3>Prompt-Bibliothek</h3>
        {props.prompts.length > 0 && (
          <div className="template-list">
            {props.prompts.map((p) => (
              <div key={p.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{p.name}</span>
                  <span className="muted"> · {p.text}</span>
                </span>
                <button className="link" onClick={() => props.onEditPrompt(p)}>
                  Bearbeiten
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Prompt „${p.name}“ löschen?`)) props.onRemovePrompt(p)
                  }}
                >
                  Löschen
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditPrompt(null)}>Neuer Prompt …</button>
        <p className="muted small">
          Wiederverwendbare Anweisungen mit Platzhaltern. Senden: Rechtsklick auf einen Agent →
          „Auftrag / Prompt aus der Bibliothek“ oder per Sprache („Agent 2, Prompt Code-Review“).
        </p>
      </section>

      <section className="settings-section">
        <h3>Weitere Engines</h3>
        {props.engines.length > 0 && (
          <div className="template-list">
            {props.engines.map((e) => (
              <div key={e.id} className="template-item">
                <span className="template-info">
                  <span className="template-name">{e.name}</span>
                  <span className="muted"> · {e.command}</span>
                </span>
                <button className="link" onClick={() => props.onEditEngine(e)}>
                  Bearbeiten
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`Engine „${e.name}“ löschen?`)) props.onRemoveEngine(e)
                  }}
                >
                  Löschen
                </button>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => props.onEditEngine(null)}>Neue Engine …</button>
        <p className="muted small">
          Andere Coding-Agents als Claude Code (z. B. Codex CLI, Gemini CLI) als Terminal-Programm.
          Start über ▶ am Projekt. Ohne Claude-Hooks nur mit vereinfachtem Status.
        </p>
      </section>

      <section className="settings-section">
        <h3>Eingang und Benachrichtigungen</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.notifyOnWaiting}
            onChange={(e) => update({ notifyOnWaiting: e.target.checked })}
          />
          Windows-Benachrichtigung, wenn ein Agent wartet und DevHub im Hintergrund ist
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.permissionInbox}
            onChange={(e) => update({ permissionInbox: e.target.checked })}
          />
          Freigaben im Eingang entscheiden (statt im Terminal des Agents)
        </label>
        <small className="muted">
          Mit „Immer“ entsteht eine Regel fürs Projekt (Projekt bearbeiten → Freigabe-Regeln).
          Regeln gelten auch ohne diese Einstellung.
        </small>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.voiceReadback}
            onChange={(e) => update({ voiceReadback: e.target.checked })}
          />
          Fertige Agents: Kurzfassung der Antwort vorlesen
        </label>
        <small className="muted">
          Claude (Haiku) fasst die Antwort in ein bis zwei Sätzen zusammen; vorgelesen wird mit der
          Windows-Sprachausgabe.
        </small>
      </section>

      <section className="settings-section">
        <h3>Verbrauch</h3>
        <div className="form">
          <NumberSetting
            label="Kontext-Warnung ab (Tokens)"
            value={settings.contextWarnTokens}
            step={10000}
            help="Hinweis im Eingang, sobald die Unterhaltung eines Agents so groß ist. 0 = aus."
            onSave={(contextWarnTokens) => update({ contextWarnTokens })}
          />
          <NumberSetting
            label="Preis Eingabe (USD je Million Tokens)"
            value={settings.priceInput}
            step={0.5}
            help="Für die Kostenschätzung im Verlauf. 0 = keine Kostenanzeige (z. B. mit Abo)."
            onSave={(priceInput) => update({ priceInput })}
          />
          <NumberSetting
            label="Preis Ausgabe (USD je Million Tokens)"
            value={settings.priceOutput}
            step={0.5}
            help="Cache-Lesen wird mit 10 %, Cache-Schreiben mit 125 % des Eingabepreises gerechnet."
            onSave={(priceOutput) => update({ priceOutput })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3>Fernzugriff</h3>
        <RemoteSettings settings={settings} update={update} />
      </section>

      <section className="settings-section">
        <h3>Dateivorschau</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.showEditedFiles}
            onChange={(e) => update({ showEditedFiles: e.target.checked })}
          />
          Vom Agent bearbeitete Dateien rechts als Reiter anzeigen
        </label>
        <small className="muted">
          Geänderte Zeilen werden hervorgehoben. Stellen, die ein Agent gezielt zeigt, und Snippets
          erscheinen unabhängig davon.
        </small>
      </section>

      <section className="settings-section">
        <h3>Öffnen mit</h3>
        <ProgramSetting
          label="Projektdateien (Pfad 2)"
          value={settings.projectFileApp}
          placeholder="Windows-Standardprogramm der Dateiendung"
          help="Pfad zur .exe, z. B. Visual Studio oder Rider. Leer = Programm, das Windows für die Dateiendung verwendet."
          onSave={(projectFileApp) => update({ projectFileApp })}
        />
        <ProgramSetting
          label="Ordner (Pfad 3)"
          value={settings.folderApp}
          placeholder={props.vscodeInstalled ? 'VS Code' : 'Windows-Explorer'}
          help={`Pfad zur .exe, z. B. VS Code, Cursor oder ein anderer Editor. Leer = ${props.vscodeInstalled ? 'VS Code' : 'Windows-Explorer (VS Code ist nicht installiert)'}.`}
          onSave={(folderApp) => update({ folderApp })}
        />
        <small className="muted">Beides ist pro Projekt abweichend einstellbar.</small>
      </section>

      <section className="settings-section">
        <h3>Sprachmodell</h3>
        <VoiceModels status={voiceStatus} onChanged={props.onVoiceChanged} />
      </section>

      <section className="settings-section">
        <h3>Sprach-Anweisungen</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.voiceAutoSend}
            onChange={(e) => update({ voiceAutoSend: e.target.checked })}
          />
          Erkannten Text direkt abschicken (sonst nur ins Terminal eintragen)
        </label>
        <small className="muted">
          Pro Agent abweichend einstellbar: Rechtsklick auf den Agent in der Liste.
        </small>
        <div className="form">
          <label>
            <span>Gesprochene Sprache</span>
            <select
              value={settings.voiceFixedLanguage ?? ''}
              onChange={(e) => update({ voiceFixedLanguage: e.target.value || null })}
            >
              <option value="">Automatisch erkennen</option>
              {FIXED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  Immer {languageName(code)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {settings.voiceFixedLanguage ? (
          <small className="muted">
            Feste Sprache: am schnellsten und zuverlässigsten. Andere Sprachen werden dann
            allerdings falsch erkannt bzw. übersetzt.
          </small>
        ) : (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.voiceRememberLanguage}
              onChange={(e) => update({ voiceRememberLanguage: e.target.checked })}
            />
            Zuletzt erkannte Sprache merken und zuerst verwenden (schnellere Erkennung)
          </label>
        )}
        {!settings.voiceFixedLanguage && settings.voiceRememberLanguage && (
          <small className="muted">
            {canRememberLanguage(settings.voiceLanguage) ? (
              <>
                Gemerkt: <strong>{languageName(settings.voiceLanguage)}</strong> – wirkt das
                Ergebnis unsicher, wird die Sprache neu erkannt.{' '}
                <button className="link" onClick={() => update({ voiceLanguage: null })}>
                  Vergessen
                </button>
              </>
            ) : (
              'Noch keine Sprache gemerkt – wird bei der nächsten Aufnahme erkannt. Englisch wird nie gemerkt (whisper würde sonst andere Sprachen ins Englische übersetzen).'
            )}
          </small>
        )}
      </section>

      <section className="settings-section">
        <h3>Tastenkürzel</h3>
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
              <td>Sprach-Anweisung an den aktiven Agent (in der App)</td>
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
              <td>Sprachbefehl systemweit: Agent per Name ansprechen oder neuen Agent starten</td>
            </tr>
            <tr>
              <td>
                <HotkeyInput
                  value={settings.hotkeyEditor}
                  defaultValue={DEFAULT_HOTKEYS.editor}
                  onChange={(hotkeyEditor) => update({ hotkeyEditor })}
                />
              </td>
              <td>
                Anweisung für den aktiven Agent in einem Tab schreiben (mit Diktat und Bildern; in
                der App)
              </td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>Laufende Aufnahme abbrechen</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          Erneutes Drücken des Kürzels beendet die Aufnahme. Zum Ändern auf „Ändern“ klicken und die
          neue Tastenkombination drücken (mit Strg, Alt oder Win, oder eine F-Taste).
        </p>
      </section>
    </Modal>
  )
}

export default SettingsDialog
