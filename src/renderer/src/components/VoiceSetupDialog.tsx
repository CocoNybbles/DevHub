import type { VoiceStatus } from '../../../shared/types'
import { useT } from '../lib/i18n'
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
  const t = useT()
  return (
    <Modal
      title={t('voiceUi.setupTitle')}
      onClose={onClose}
      footer={<button onClick={onClose}>{t('voiceUi.setupLater')}</button>}
    >
      <p>{t('voiceUi.setupIntro')}</p>
      <p className="muted small">
        {t('voiceUi.setupHintBefore')}
        <em>{t('common.settings')}</em>
        {t('voiceUi.setupHintAfter')}
      </p>
      <VoiceModels status={status} onChanged={onChanged} onDownloaded={onReady} />
    </Modal>
  )
}

export default VoiceSetupDialog
