// Erzeugt out/THIRD_PARTY_NOTICES.txt: Lizenztexte aller Bibliotheken, die im ZIP landen
// (MIT/Apache verlangen, die Hinweise mit auszuliefern). Läuft am Ende von `npm run build`;
// electron-builder legt die Datei neben DevHub.exe.
//
// Grundlage: Laufzeit-`dependencies` + die von Vite gebündelten Pakete (BUNDLED), jeweils mit
// allen Abhängigkeiten. Electron/Chromium bringen eigene Dateien mit (LICENSE.electron.txt,
// LICENSES.chromium.html). Neue Bibliothek im Renderer/Main → hier in BUNDLED eintragen.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- reines JS-Skript */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const BUNDLED = ['react', 'react-dom', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor']

const root = JSON.parse(readFileSync('package.json', 'utf8'))
const queue = [...Object.keys(root.dependencies ?? {}), ...BUNDLED]
const seen = new Map()

const pkgDir = (name) => join('node_modules', name)
while (queue.length) {
  const name = queue.shift()
  if (seen.has(name)) continue
  const dir = pkgDir(name)
  if (!existsSync(join(dir, 'package.json'))) {
    console.error(`notices: Paket ${name} nicht gefunden`)
    process.exit(1)
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  seen.set(name, { pkg, dir })
  queue.push(...Object.keys(pkg.dependencies ?? {}))
}

/** Lizenz- und Hinweisdateien eines Pakets (LICENSE, LICENSE.md, NOTICE, ThirdPartyNotices.txt …) */
const legalFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice|thirdpartynotices)/i.test(f))
    .sort()

const sep = '='.repeat(78)
const parts = [
  'DevHub – Hinweise zu Drittanbieter-Software / Third-party notices',
  '',
  'DevHub enthält die folgenden Open-Source-Bibliotheken. Ihre Lizenztexte stehen unten.',
  'Electron und Chromium: siehe LICENSE.electron.txt und LICENSES.chromium.html.',
  'Zur Laufzeit nachgeladen (nicht enthalten): whisper.cpp und Sprachmodelle (MIT).',
  ''
]
const names = [...seen.keys()].sort()
for (const name of names) {
  const { pkg } = seen.get(name)
  parts.push(`- ${name} ${pkg.version} (${pkg.license ?? 'siehe unten'})`)
}
for (const name of names) {
  const { pkg, dir } = seen.get(name)
  const files = legalFiles(dir)
  if (!files.length) {
    console.error(`notices: ${name} hat keine Lizenzdatei`)
    process.exit(1)
  }
  parts.push('', sep, `${name} ${pkg.version} – ${pkg.license ?? ''}`.trim(), sep)
  for (const f of files) {
    parts.push('', readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
  }
}

mkdirSync('out', { recursive: true })
// CRLF, damit Notepad unter Windows die Zeilen sauber zeigt
writeFileSync(
  join('out', 'THIRD_PARTY_NOTICES.txt'),
  parts.join('\n').replace(/\n/g, '\r\n') + '\r\n'
)
console.log(`notices: ${names.length} Pakete → out/THIRD_PARTY_NOTICES.txt`)
