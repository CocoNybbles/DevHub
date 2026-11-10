import { useState } from 'react'
import type { Settings, VoiceStatus } from '../../../shared/types'
import { validateAgentArgs } from '../../../shared/agentArgs'
import { errorText } from '../lib/errors'
import AgentArgsHelp from './AgentArgsHelp'
import { DEFAULT_HOTKEYS } from '../../../shared/hotkeys'
import HotkeyInput from './HotkeyInput'
import Modal from './Modal'
import VoiceModels from './VoiceModels'

interface Props {
  settings: Settings
  voiceStatus: VoiceStatus
  onSettingsChanged: (s: Settings) => void
  onVoiceChanged: () => void
  onClose: () => void
}

function SettingsDialog(props: Props): React.JSX.Element {
  const { settings, voiceStatus } = props

  const update = async (patch: Partial<Settings>): Promise<void> =>
    props.onSettingsChanged(await window.api.settings.update(patch))

  // Start-Flags: Entwurf lokal, gespeichert beim Verlassen des Feldes bzw. Schließen
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
  // Ungültige Flags werden nicht gespeichert (Dialog schließt trotzdem, alter Wert bleibt)
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
