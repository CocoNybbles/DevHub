/**
 * Legt den Datenordner fest: alle Daten liegen neben der .exe im Ordner `data\`.
 * Muss vor allem anderen geladen werden (erster Import in `index.ts`), weil
 * `userData` vor `app.ready` und vor jedem `dataDir()`-Aufruf gesetzt sein muss.
 */
import { app, dialog } from 'electron'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/** Ordner, in dem die .exe liegt (portable: der echte Ort, nicht der Entpack-Ordner in %TEMP%). */
function exeDir(): string {
  if (!app.isPackaged) return app.getAppPath() // Entwicklung: Projektordner
  return process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
}

/** Übernimmt einmalig die Daten aus dem früheren Speicherort `%APPDATA%\DevHub`. */
function migrateFromAppData(target: string): void {
  if (existsSync(join(target, 'devhub-state.json'))) return
  const old = join(app.getPath('appData'), 'DevHub')
  if (!existsSync(join(old, 'devhub-state.json'))) return
  try {
    cpSync(join(old, 'devhub-state.json'), join(target, 'devhub-state.json'))
    if (existsSync(join(old, 'whisper'))) {
      cpSync(join(old, 'whisper'), join(target, 'whisper'), { recursive: true })
    }
  } catch (err) {
    console.error('Übernahme der alten Daten fehlgeschlagen:', err)
  }
}

/**
 * Entwicklung/Tests: `DEVHUB_DATA_DIR` = eigener Datenordner. Damit startet eine zweite Instanz
 * neben einer laufenden (die Ein-Instanz-Sperre hängt am Datenordner), ohne deren Zustand anzufassen.
 */
const override = process.env.DEVHUB_DATA_DIR?.trim()
const dir = override || join(exeDir(), 'data')
try {
  mkdirSync(dir, { recursive: true })
  const probe = join(dir, '.write-test')
  writeFileSync(probe, '')
  rmSync(probe)
} catch {
  dialog.showErrorBox(
    'DevHub',
    `DevHub speichert seine Daten neben der Programmdatei, hat aber keine Schreibrechte für:\n${dir}\n\n` +
      'Bitte DevHub in einen beschreibbaren Ordner verschieben (z. B. nicht unter „Programme“).'
  )
  app.exit(1)
}
if (!override) migrateFromAppData(dir)
app.setPath('userData', dir)
