import type { VoiceStatus } from '../../../shared/types'
import Modal from './Modal'
import VoiceModels from './VoiceModels'

interface Props {
  status: VoiceStatus
  onChanged: () => void
  onReady: () => void
  onClose: () => void
}

/** Appears on the first attempt to use voice control while no model is installed. */
function VoiceSetupDialog({ status, onChanged, onReady, onClose }: Props): React.JSX.Element {
  return (
    <Modal
      title="Sprachsteuerung einrichten"
      onClose={onClose}
      footer={<button onClick={onClose}>Später</button>}
    >
      <p>
        Für die Sprachsteuerung muss zuerst ein Sprachmodell heruntergeladen werden. Die Erkennung
        läuft danach komplett lokal und offline, Deutsch und Englisch werden automatisch erkannt.
      </p>
      <p className="muted small">
        Wähle ein Modell. Das Modell lässt sich später unter <em>Einstellungen</em> wechseln oder
        löschen.
      </p>
      <VoiceModels status={status} onChanged={onChanged} onDownloaded={onReady} />
    </Modal>
  )
}

export default VoiceSetupDialog
