import { useState } from 'react'
import type { Engine, PromptTemplate } from '../../../shared/types'
import { placeholdersOf } from '../lib/format'
import { errorText } from '../lib/errors'
import { useT } from '../lib/i18n'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

/** Create/edit a prompt of the library */
export function PromptDialog({
  prompt,
  onSaved,
  onClose
}: {
  prompt: PromptTemplate | null
  onSaved: () => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(prompt?.name ?? '')
  const [text, setText] = useState(prompt?.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const names = placeholdersOf(text)

  const save = async (): Promise<void> => {
    try {
      await window.api.prompts.save({ id: prompt?.id, name, text })
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title={prompt ? t('library.promptTitleEdit') : t('library.promptTitleNew')}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!name.trim() || !text.trim()} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>{t('common.name')}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('library.promptNamePlaceholder')}
            maxLength={60}
          />
          <small className="muted">{t('library.promptNameHelp')}</small>
        </label>
        <label>
          <span>{t('library.promptTextLabel')}</span>
          <DictationTextarea
            value={text}
            onChange={setText}
            minHeight={160}
            placeholder={t('library.promptTextPlaceholder')}
          />
          <small className="muted">
            {names.length
              ? t('library.promptPlaceholdersFound', { names: names.join(', ') })
              : t('library.promptPlaceholdersHelp')}
          </small>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

/** Create/edit another engine (terminal program other than Claude Code) */
export function EngineDialog({
  engine,
  onSaved,
  onClose
}: {
  engine: Engine | null
  onSaved: () => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(engine?.name ?? '')
  const [command, setCommand] = useState(engine?.command ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    try {
      await window.api.engines.save({ id: engine?.id, name, command })
      onSaved()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title={engine ? t('library.engineTitleEdit') : t('library.engineTitleNew')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!name.trim() || !command.trim()} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>{t('common.name')}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('library.engineNamePlaceholder')}
            maxLength={40}
          />
          <small className="muted">{t('library.engineNameHelp')}</small>
        </label>
        <label>
          <span>{t('library.engineCommandLabel')}</span>
          <input
            className="mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={t('library.engineCommandPlaceholder')}
            spellCheck={false}
          />
          <small className="muted">{t('library.engineCommandHelp')}</small>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}
