import { execFile } from 'child_process'
import { createWriteStream, existsSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { once } from 'events'
import { cpus, tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  DownloadProgress,
  VoiceStatus,
  WhisperModelId,
  WhisperModelInfo
} from '../shared/types'
import { dataDir, getState, updateState } from './store'

/**
 * Sprache → Text mit whisper.cpp (lokal, offline).
 * Engine und Modell werden NICHT mitgeliefert, sondern beim ersten Nutzen
 * nach %APPDATA%/DevHub/whisper/ heruntergeladen.
 */

/** Feste Version für reproduzierbare Downloads. */
const ENGINE_URL =
  'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'

const MODELS: Record<WhisperModelId, Omit<WhisperModelInfo, 'installed'> & { file: string }> = {
  base: {
    id: 'base',
    label: 'Base',
    file: 'ggml-base-q5_1.bin',
    sizeMB: 60,
    description: 'Sehr schnell, brauchbare Erkennung'
  },
  small: {
    id: 'small',
    label: 'Small (empfohlen)',
    file: 'ggml-small-q5_1.bin',
    sizeMB: 190,
    description: 'Gute Erkennung, auch bei Fachbegriffen'
  },
  'large-v3-turbo': {
    id: 'large-v3-turbo',
    label: 'Large v3 Turbo',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    sizeMB: 550,
    description: 'Sehr gute Erkennung, braucht einen stärkeren Rechner'
  }
}

const engineDir = (): string => dataDir('whisper', 'engine')
const engineExe = (): string => join(engineDir(), 'Release', 'whisper-cli.exe')
const modelPath = (id: WhisperModelId): string =>
  join(dataDir('whisper', 'models'), MODELS[id].file)

export function voiceStatus(): VoiceStatus {
  const models = Object.values(MODELS).map(({ id, label, sizeMB, description }) => ({
    id,
    label,
    sizeMB,
    description,
    installed: existsSync(modelPath(id))
  }))
  const configured = getState().settings.voiceModel
  const active =
    configured && existsSync(modelPath(configured))
      ? configured
      : (models.find((m) => m.installed)?.id ?? null)
  const engineInstalled = existsSync(engineExe())
  return { engineInstalled, models, activeModel: engineInstalled ? active : null }
}

let downloading = false

/** Lädt (falls nötig) die Engine und das gewählte Modell und aktiviert das Modell. */
export async function downloadVoice(
  model: WhisperModelId,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
  if (!MODELS[model]) throw new Error('Unbekanntes Modell')
  if (downloading) throw new Error('Es läuft bereits ein Download')
  downloading = true
  try {
    if (!existsSync(engineExe())) {
      const zip = join(engineDir(), 'whisper.zip')
      await downloadFile(ENGINE_URL, zip, (r, t) =>
        onProgress({ phase: 'engine', receivedBytes: r, totalBytes: t })
      )
      await run('C:\\Windows\\System32\\tar.exe', ['-xf', zip, '-C', engineDir()])
      unlinkSync(zip)
      if (!existsSync(engineExe())) throw new Error('whisper-cli.exe fehlt im Archiv')
    }
    if (!existsSync(modelPath(model))) {
      await downloadFile(MODEL_BASE_URL + MODELS[model].file, modelPath(model), (r, t) =>
        onProgress({ phase: 'model', receivedBytes: r, totalBytes: t })
      )
    }
    updateState((s) => (s.settings.voiceModel = model))
    onProgress({ phase: 'done', receivedBytes: 0, totalBytes: 0 })
  } catch (e) {
    onProgress({ phase: 'error', receivedBytes: 0, totalBytes: 0, message: String(e) })
    throw e
  } finally {
    downloading = false
  }
}

export function deleteModel(model: WhisperModelId): void {
  rmSync(modelPath(model), { force: true })
  if (getState().settings.voiceModel === model) {
    updateState((s) => (s.settings.voiceModel = voiceStatus().activeModel))
  }
}

/** WAV (16 kHz, mono, 16 bit) → Text. Sprache wird automatisch erkannt. */
export async function transcribe(wav: ArrayBuffer): Promise<string> {
  const status = voiceStatus()
  if (!status.activeModel) throw new Error('Sprachsteuerung ist noch nicht eingerichtet')

  const file = join(tmpdir(), `devhub-voice-${randomUUID()}.wav`)
  writeFileSync(file, Buffer.from(wav))
  try {
    const threads = String(Math.max(1, Math.min(8, cpus().length - 1)))
    const out = await run(engineExe(), [
      '-m',
      modelPath(status.activeModel),
      '-f',
      file,
      '-l',
      'auto',
      '-t',
      threads,
      '-nt', // keine Zeitstempel
      '-np' // nur das Ergebnis ausgeben
    ])
    return out
      .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SOUND)[^\]]*\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  } finally {
    rmSync(file, { force: true })
  }
}

// -----------------------------------------------------------------------------

function run(file: string, args: string[], timeout = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout, maxBuffer: 10_000_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}\n${stderr}`.trim()))
        else resolve(stdout.toString())
      }
    )
  })
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const part = dest + '.part'
  const out = createWriteStream(part)
  let received = 0
  let lastReport = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length
      if (!out.write(chunk)) await once(out, 'drain')
      if (Date.now() - lastReport > 200) {
        lastReport = Date.now()
        onProgress(received, total)
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve()))
    )
  } catch (e) {
    out.destroy()
    rmSync(part, { force: true })
    throw e
  }
  if (total && received !== total) {
    rmSync(part, { force: true })
    throw new Error('Download unvollständig')
  }
  onProgress(received, total)
  renameSync(part, dest)
}
