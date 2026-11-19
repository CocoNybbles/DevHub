import { useEffect, useState } from 'react'
import type { DownloadProgress, VoiceStatus, WhisperModelId } from '../../../shared/types'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'

interface Props {
  status: VoiceStatus
  /** Reload after download/delete/activate */
  onChanged: () => void
  /** Called after a successful download */
  onDownloaded?: (model: WhisperModelId) => void
}

const ENGINE_MB = 9

/** Model selection + download with progress; used in the setup dialog and in the settings. */
function VoiceModels({ status, onChanged, onDownloaded }: Props): React.JSX.Element {
  const t = useT()
  const [selected, setSelected] = useState<WhisperModelId>(status.activeModel ?? 'small')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = progress !== null && progress.phase !== 'done' && progress.phase !== 'error'

  useEffect(() => window.api.voice.onProgress(setProgress), [])

  const model = status.models.find((m) => m.id === selected)!
  const needsEngine = !status.engineInstalled
  const downloadMB = (model.installed ? 0 : model.sizeMB) + (needsEngine ? ENGINE_MB : 0)

  const download = async (): Promise<void> => {
    setError(null)
    setProgress({ phase: needsEngine ? 'engine' : 'model', receivedBytes: 0, totalBytes: 0 })
    try {
      await window.api.voice.download(selected)
      onChanged()
      onDownloaded?.(selected)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const activate = async (): Promise<void> => {
    await window.api.settings.update({ voiceModel: selected })
    onChanged()
  }

  const remove = async (id: WhisperModelId): Promise<void> => {
    if (!confirm(t('voiceUi.confirmDeleteModel'))) return
    await window.api.voice.deleteModel(id)
    onChanged()
  }

  const pct =
    progress && progress.totalBytes
      ? Math.round((progress.receivedBytes / progress.totalBytes) * 100)
      : 0

  return (
    <div className="voice-models">
      {status.models.map((m) => (
        <label key={m.id} className={`model-option ${selected === m.id ? 'selected' : ''}`}>
          <input
            type="radio"
            name="model"
            checked={selected === m.id}
            disabled={busy}
            onChange={() => setSelected(m.id)}
          />
          <span className="model-text">
            <strong>{m.label}</strong>
            <span className="muted"> · ~{m.sizeMB} MB</span>
            <br />
            <small className="muted">{m.description}</small>
          </span>
          <span className="model-state">
            {m.installed && status.activeModel === m.id && (
              <span className="badge ok">{t('voiceUi.modelActive')}</span>
            )}
            {m.installed && status.activeModel !== m.id && (
              <span className="badge">{t('voiceUi.modelInstalled')}</span>
            )}
            {m.installed && !busy && (
              <button className="link danger" onClick={(e) => (e.preventDefault(), remove(m.id))}>
                {t('voiceUi.modelDelete')}
              </button>
            )}
          </span>
        </label>
      ))}

      {busy && progress && (
        <div className="progress">
          <div className="progress-label">
            {progress.phase === 'engine' ? t('voiceUi.loadingEngine') : t('voiceUi.loadingModel')}
            <span>
              {(progress.receivedBytes / 1e6).toFixed(0)} / {(progress.totalBytes / 1e6).toFixed(0)}{' '}
              MB
            </span>
          </div>
          <div className="progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="voice-actions">
        {model.installed && status.engineInstalled ? (
          <button
            className="primary"
            disabled={busy || status.activeModel === selected}
            onClick={activate}
          >
            {status.activeModel === selected ? t('voiceUi.activeButton') : t('voiceUi.useModel')}
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={download}>
            {busy ? t('voiceUi.downloading') : t('voiceUi.download', { size: downloadMB })}
          </button>
        )}
      </div>
    </div>
  )
}

export default VoiceModels
