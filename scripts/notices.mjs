// Generates out/THIRD_PARTY_NOTICES.txt: license texts of all libraries that end up in the ZIP
// (MIT/Apache require shipping the notices). Runs at the end of `npm run build`;
// electron-builder puts the file next to DevHub.exe.
//
// Basis: runtime `dependencies` + the packages bundled by Vite (BUNDLED), each with all
// their dependencies. Electron/Chromium ship their own files (LICENSE.electron.txt,
// LICENSES.chromium.html). New library in renderer/main → add it to BUNDLED here.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
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
    console.error(`notices: package ${name} not found`)
    process.exit(1)
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  seen.set(name, { pkg, dir })
  queue.push(...Object.keys(pkg.dependencies ?? {}))
}

/** License and notice files of a package (LICENSE, LICENSE.md, NOTICE, ThirdPartyNotices.txt …) */
const legalFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice|thirdpartynotices)/i.test(f))
    .sort()

const sep = '='.repeat(78)
const parts = [
  'DevHub – Third-party notices',
  '',
  'DevHub includes the following open-source libraries. Their license texts are below.',
  'Electron and Chromium: see LICENSE.electron.txt and LICENSES.chromium.html.',
  'Downloaded at runtime (not included): whisper.cpp and speech models (MIT).',
  ''
]
const names = [...seen.keys()].sort()
for (const name of names) {
  const { pkg } = seen.get(name)
  parts.push(`- ${name} ${pkg.version} (${pkg.license ?? 'see below'})`)
}
for (const name of names) {
  const { pkg, dir } = seen.get(name)
  const files = legalFiles(dir)
  if (!files.length) {
    console.error(`notices: ${name} has no license file`)
    process.exit(1)
  }
  parts.push('', sep, `${name} ${pkg.version} – ${pkg.license ?? ''}`.trim(), sep)
  for (const f of files) {
    parts.push('', readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
  }
}

mkdirSync('out', { recursive: true })
// CRLF so Notepad on Windows shows the lines properly
writeFileSync(
  join('out', 'THIRD_PARTY_NOTICES.txt'),
  parts.join('\n').replace(/\n/g, '\r\n') + '\r\n'
)
console.log(`notices: ${names.length} packages → out/THIRD_PARTY_NOTICES.txt`)
