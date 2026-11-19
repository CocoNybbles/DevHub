/**
 * Sets the data folder: all data lives next to the .exe in the `data\` folder.
 * Must be loaded before anything else (first import in `index.ts`), because
 * `userData` has to be set before `app.ready` and before any `dataDir()` call.
 */
import { app, dialog } from 'electron'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { t } from '../shared/i18n'

/** Folder containing the .exe (portable: the real location, not the extraction folder in %TEMP%). */
function exeDir(): string {
  if (!app.isPackaged) return app.getAppPath() // development: project folder
  return process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath)
}

/** One-time migration of the data from the former location `%APPDATA%\DevHub`. */
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
    console.error('[DevHub] Migrating the old data failed:', err)
  }
}

/**
 * Development/tests: `DEVHUB_DATA_DIR` = a separate data folder. This lets a second instance start
 * next to a running one (the single-instance lock is tied to the data folder) without touching its state.
 */
const override = process.env.DEVHUB_DATA_DIR?.trim()
const dir = override || join(exeDir(), 'data')
try {
  mkdirSync(dir, { recursive: true })
  const probe = join(dir, '.write-test')
  writeFileSync(probe, '')
  rmSync(probe)
} catch {
  // The saved language is not loaded yet: this text uses the system language
  dialog.showErrorBox('DevHub', t('main.dataDirNotWritable', { dir }))
  app.exit(1)
}
if (!override) migrateFromAppData(dir)
app.setPath('userData', dir)
