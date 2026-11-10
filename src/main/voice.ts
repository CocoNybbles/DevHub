import { execFile } from 'child_process'
import { createWriteStream, existsSync, renameSync, rmSync, unlinkSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { once } from 'events'
import { constants, cpus, setPriority, tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  DownloadProgress,
  TranscribeResult,
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

/**
 * Mindest-Durchschnittswahrscheinlichkeit der Tokens, damit ein Ergebnis mit der gemerkten
 * Sprache akzeptiert wird. Gemessen: passende Sprache ≈ 0,8–0,95, falsche oft ≈ 0,5.
 */
const MIN_CONFIDENCE = 0.6
/** Spätestens jede n-te Aufnahme läuft mit automatischer Spracherkennung. */
const AUTO_DETECT_EVERY = 5
let sinceAutoDetect = 0

interface WhisperResult {
  text: string
  language: string
  confidence: number
}

/**
 * WAV (16 kHz, mono, 16 bit) → Text.
 * Mit `voiceRememberLanguage` wird zuerst die zuletzt erkannte Sprache vorgegeben (spart die
 * Spracherkennung, ≈ halbe Laufzeit). Ist das Ergebnis leer oder unsicher, folgt ein Durchlauf
 * mit automatischer Erkennung, dessen Sprache dann gespeichert wird.
 */
export async function transcribe(wav: ArrayBuffer): Promise<TranscribeResult> {
  const status = voiceStatus()
  if (!status.activeModel) throw new Error('Sprachsteuerung ist noch nicht eingerichtet')
  const model = modelPath(status.activeModel)
  const { voiceRememberLanguage, voiceLanguage } = getState().settings

  const file = join(tmpdir(), `devhub-voice-${randomUUID()}.wav`)
  await writeFile(file, Buffer.from(wav))
  try {
    // Jede n-te Aufnahme trotzdem automatisch erkennen: Bei gemerktem „en“ übersetzt whisper
    // andere Sprachen unauffällig ins Englische, das würde die Konfidenz-Prüfung nicht bemerken.
    const verify = ++sinceAutoDetect >= AUTO_DETECT_EVERY
    if (voiceRememberLanguage && voiceLanguage && !verify) {
      const r = await runWhisper(model, file, voiceLanguage)
      if (r.text && r.confidence >= MIN_CONFIDENCE) {
        return { text: r.text, language: r.language, remembered: true }
      }
      debug(`gemerkte Sprache ${voiceLanguage} unsicher (p=${r.confidence.toFixed(2)}) → auto`)
    }
    const r = await runWhisper(model, file, 'auto')
    sinceAutoDetect = 0
    if (voiceRememberLanguage && r.text && r.language && r.language !== voiceLanguage) {
      updateState((s) => (s.settings.voiceLanguage = r.language))
    }
    return { text: r.text, language: r.language, remembered: false }
  } finally {
    rmSync(file, { force: true })
  }
}

async function runWhisper(model: string, wav: string, language: string): Promise<WhisperResult> {
  const outBase = wav.replace(/\.wav$/i, '')
  // Höchstens die Hälfte der Kerne, damit App und Agents flüssig bleiben
  const threads = String(Math.max(1, Math.min(8, Math.floor(cpus().length / 2))))
  const t0 = Date.now()
  await run(
    engineExe(),
    [
      '-m',
      model,
      '-f',
      wav,
      '-l',
      language,
      '-t',
      threads,
      '-nt', // keine Zeitstempel
      '-np', // keine Statusausgaben
      '-ojf', // JSON mit Sprache und Token-Wahrscheinlichkeiten
      '-of',
      outBase
    ],
    { lowPriority: true }
  )
  const jsonFile = `${outBase}.json`
  try {
    const json = JSON.parse(await readFile(jsonFile, 'utf8')) as WhisperJson
    const segments = json.transcription ?? []
    const text = segments
      .map((s) => s.text)
      .join(' ')
      .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SOUND)[^\]]*\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    // Sondertokens wie [_BEG_] / [_TT_…] zählen nicht
    const tokens = segments.flatMap((s) => s.tokens ?? []).filter((t) => !t.text.startsWith('[_'))
    const confidence = tokens.length ? tokens.reduce((n, t) => n + t.p, 0) / tokens.length : 0
    const result = { text, language: json.result?.language ?? '', confidence }
    debug(
      `whisper -l ${language}: ${Date.now() - t0} ms, Sprache ${result.language}, p=${confidence.toFixed(2)}`
    )
    return result
  } finally {
    rmSync(jsonFile, { force: true })
  }
}

interface WhisperJson {
  result?: { language?: string }
  transcription?: { text: string; tokens?: { text: string; p: number }[] }[]
}

function debug(msg: string): void {
  if (process.env.DEVHUB_DEBUG) console.log('[DevHub] Sprache:', msg)
}

// -----------------------------------------------------------------------------

/**
 * Startet ein Programm asynchron. lowPriority: Prozesspriorität „niedriger als normal“,
 * damit rechenintensive Arbeit (whisper) die App und das System nicht ausbremst.
 */
function run(
  file: string,
  args: string[],
  { timeout = 180_000, lowPriority = false } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { windowsHide: true, timeout, maxBuffer: 10_000_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}\n${stderr}`.trim()))
        else resolve(stdout.toString())
      }
    )
    if (lowPriority && child.pid) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // nicht kritisch
      }
    }
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
