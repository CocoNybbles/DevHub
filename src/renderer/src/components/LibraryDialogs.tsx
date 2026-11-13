import { useState } from 'react'
import type { Engine, PromptTemplate } from '../../../shared/types'
import { placeholdersOf } from '../lib/format'
import { errorText } from '../lib/errors'
import DictationTextarea from './DictationTextarea'
import Modal from './Modal'

/** Prompt der Bibliothek anlegen/bearbeiten */
export function PromptDialog({
  prompt,
  onSaved,
  onClose
}: {
  prompt: PromptTemplate | null
  onSaved: () => void
  onClose: () => void
}): React.JSX.Element {
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
      title={prompt ? 'Prompt bearbeiten' : 'Neuer Prompt'}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!name.trim() || !text.trim()} onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Code-Review"
            maxLength={60}
          />
          <small className="muted">
            Unter diesem Namen wählst du ihn aus – auch per Sprache („Agent 2, Prompt Code-Review“).
          </small>
        </label>
        <label>
          <span>Anweisung</span>
          <DictationTextarea
            value={text}
            onChange={setText}
            minHeight={160}
            placeholder={'z. B. Prüfe {{Datei}} auf Fehler und schlage Verbesserungen vor.'}
          />
          <small className="muted">
            {names.length
              ? `Platzhalter, die beim Senden abgefragt werden: ${names.join(', ')}`
              : 'Platzhalter in doppelten geschweiften Klammern, z. B. {{Datei}}, werden beim Senden abgefragt.'}
          </small>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}

/** Weitere Engine (anderes Terminal-Programm als Claude Code) anlegen/bearbeiten */
export function EngineDialog({
  engine,
  onSaved,
  onClose
}: {
  engine: Engine | null
  onSaved: () => void
  onClose: () => void
}): React.JSX.Element {
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
      title={engine ? 'Engine bearbeiten' : 'Neue Engine'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!name.trim() || !command.trim()} onClick={save}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Codex"
            maxLength={40}
          />
          <small className="muted">So heißen die gestarteten Agents („Codex“, „Codex 2“ …).</small>
        </label>
        <label>
          <span>Befehl</span>
          <input
            className="mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="z. B. codex   oder   gemini"
            spellCheck={false}
          />
          <small className="muted">
            Läuft als Terminal-Programm im Agent-Ordner (bzw. Worktree). Ohne Claude-Hooks gibt es
            für diese Agents keinen genauen Status, keine Datei-Reiter, Prüfungen oder Freigaben –
            Terminal, Raster, Sprach-Anweisungen, Aufträge und das Prüfen der Änderungen
            funktionieren.
          </small>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  )
}
