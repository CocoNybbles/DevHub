import type { Settings, VoiceStatus } from '../../../shared/types'
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

  return (
    <Modal
      title="Einstellungen"
      onClose={props.onClose}
      width={600}
      footer={<button onClick={props.onClose}>Schließen</button>}
    >
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
