// New release – manual only: `npm run release -- <notes.md> [x.y.z]`
//
// 1. Version: patch +1 over package.json (or the given x.y.z, e.g. for 1.1.0)
// 2. Set package.json/-lock to the new version and build the ZIP (`npm run build:win`)
// 3. Commit "Version x.y.z" + tag vX.Y.Z, push both
// 4. Create the GitHub release for this tag (notes from the file) + upload the ZIP
//
// GitHub login: the one stored with Git (Git Credential Manager), never printed.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
import { execSync } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { basename } from 'path'

const RELEASE_REPO = 'CocoNybbles/DevHub'

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd).toString().trim()
const fail = (msg) => {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

const [notesFile, wanted] = process.argv.slice(2)
if (!notesFile || !existsSync(notesFile)) {
  fail('Aufruf: npm run release -- <notizen.md> [x.y.z]  (Notizen-Datei fehlt)')
}
const notes = readFileSync(notesFile, 'utf8').trim()
if (!notes) fail('Die Notizen-Datei ist leer')

// --- Preconditions
if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Nur vom Branch main aus')
if (out('git status --porcelain')) fail('Es gibt nicht committete Änderungen – erst committen')
run('git fetch -q origin main --tags')
if (out('git rev-parse HEAD') !== out('git rev-parse origin/main')) {
  fail('main ist nicht auf dem Stand von origin/main – erst pushen bzw. pullen')
}

// --- Version
const current = JSON.parse(readFileSync('package.json', 'utf8')).version
const [maj, min, pat] = current.split('.').map(Number)
const version = wanted ?? `${maj}.${min}.${pat + 1}`
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Ungültige Version: ${version}`)
const tag = `v${version}`
if (out(`git tag -l ${tag}`)) fail(`Tag ${tag} gibt es schon`)
console.log(`\nRelease ${current} → ${version}\n`)

// --- GitHub-API
const cred = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n'
}).toString()
const token = /^password=(.*)$/m.exec(cred)?.[1]
if (!token) fail('Keine GitHub-Anmeldung bei Git gespeichert')
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'devhub-release-script'
}
const existing = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${tag}`, {
  headers
})
if (existing.ok) fail(`Release ${tag} gibt es in ${RELEASE_REPO} schon`)

// --- Build (reset the version on failure)
run(`npm version ${version} --no-git-tag-version`)
try {
  run('npm run build:win')
} catch {
  run('git checkout -- package.json package-lock.json')
  fail('Build fehlgeschlagen – Version zurückgesetzt')
}
const zip = `dist/DevHub-${version}-win.zip`
if (!existsSync(zip)) {
  run('git checkout -- package.json package-lock.json')
  fail(`${zip} wurde nicht gebaut – Version zurückgesetzt`)
}

// --- Record the version: commit + tag (the release points to exactly this state)
run('git add package.json package-lock.json')
run(`git commit -q -m "Version ${version}"`)
run(`git tag ${tag}`)
run(`git push -q origin main ${tag}`)

// --- Publish
const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    tag_name: tag,
    name: `DevHub ${version}`,
    body: notes,
    make_latest: 'true'
  })
})
const release = await res.json()
if (!res.ok) {
  fail(
    `Release anlegen: ${res.status} ${JSON.stringify(release)} – Commit und Tag ${tag} sind schon gepusht; Release auf GitHub von Hand anlegen und ${zip} anhängen`
  )
}
console.log(`\nRelease angelegt: ${release.html_url}`)

const up = await fetch(
  `${release.upload_url.replace(/\{.*\}$/, '')}?name=${encodeURIComponent(basename(zip))}`,
  {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/zip',
      'Content-Length': String(statSync(zip).size)
    },
    body: readFileSync(zip)
  }
)
const asset = await up.json()
if (!up.ok) {
  fail(
    `Upload: ${up.status} ${JSON.stringify(asset)} – Release ${tag} existiert ohne ZIP, bitte prüfen`
  )
}
console.log(`Hochgeladen: ${asset.browser_download_url}`)
console.log(`\n✔ DevHub ${version} veröffentlicht`)
