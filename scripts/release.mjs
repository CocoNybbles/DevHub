// Build a new release and publish it on GitHub.
//
//   Manual:    npm run release -- <notes.md> [x.y.z]
//   Workflow:  node scripts/release.mjs --ci   (.github/workflows/release.yml, after merging a
//              PR labelled "release"; env: GITHUB_TOKEN, RELEASE_SHA, RELEASE_TITLE,
//              RELEASE_NOTES, RELEASE_PR)
//
// 1. Version: highest tag v* on GitHub, patch +1 (or the given x.y.z, e.g. for 1.1.0).
//    package.json in the repo is NOT authoritative – the version is only set for the build.
// 2. Build the ZIP (`npm run build:win`)
// 3. Create the GitHub release; this creates tag vX.Y.Z on exactly the built commit
//    (no commit on main needed – main is protected)
// 4. Upload the ZIP; if that fails, release and tag are removed again
//
// GitHub login: manually the one stored with Git (Git Credential Manager), in the workflow
// GITHUB_TOKEN. Never printed.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
import { execSync } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { basename } from 'path'

const ci = process.argv.includes('--ci')
const args = process.argv.slice(2).filter((a) => a !== '--ci')
const repo = process.env.GITHUB_REPOSITORY || 'CocoNybbles/DevHub'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const out = (cmd) => execSync(cmd).toString().trim()
const fail = (msg) => {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

// --- Inputs: commit, notes, requested version
let sha, notes, wanted
if (ci) {
  sha = process.env.RELEASE_SHA
  if (!sha) fail('RELEASE_SHA fehlt')
  if (out('git rev-parse HEAD') !== sha) fail(`Ausgecheckt ist nicht ${sha}`)
  const title = (process.env.RELEASE_TITLE ?? '').trim()
  const body = (process.env.RELEASE_NOTES ?? '').trim()
  const pr = process.env.RELEASE_PR
  notes = (body || title) + (pr ? `\n\n_Pull Request #${pr}_` : '')
  wanted = process.env.RELEASE_VERSION || undefined
} else {
  const [notesFile, version] = args
  if (!notesFile || !existsSync(notesFile)) {
    fail('Aufruf: npm run release -- <notizen.md> [x.y.z]  (Notizen-Datei fehlt)')
  }
  notes = readFileSync(notesFile, 'utf8').trim()
  wanted = version
  if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Nur vom Branch main aus')
  if (out('git status --porcelain')) fail('Es gibt nicht committete Änderungen – erst committen')
  run('git fetch -q origin main')
  sha = out('git rev-parse HEAD')
  if (sha !== out('git rev-parse origin/main')) {
    fail('main ist nicht auf dem Stand von origin/main – erst pushen bzw. pullen')
  }
}
if (!notes.trim()) fail('Die Release-Notizen sind leer')

// --- Version from the tags on GitHub
const parse = (v) => v.split('.').map(Number)
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}
const tags = out(`git ls-remote --tags origin "refs/tags/v*"`)
  .split('\n')
  .map((l) => /refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(l)?.[1])
  .filter(Boolean)
const latest = tags.reduce((a, b) => (newer(b, a) ? b : a), '0.0.0')
const [maj, min, pat] = parse(latest)
const version = wanted ?? `${maj}.${min}.${pat + 1}`
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Ungültige Version: ${version}`)
if (!newer(version, latest)) fail(`Version ${version} ist nicht neuer als v${latest}`)
const tag = `v${version}`
console.log(`\nRelease v${latest} → ${tag} (Commit ${sha.slice(0, 7)})\n`)

// --- GitHub API
let token = process.env.GITHUB_TOKEN
if (!ci) {
  const cred = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n\n'
  }).toString()
  token = /^password=(.*)$/m.exec(cred)?.[1]
}
if (!token) fail('Keine GitHub-Anmeldung vorhanden')
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'devhub-release-script'
}
const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers }
  })
if ((await api(`/releases/tags/${tag}`)).ok) fail(`Release ${tag} gibt es in ${repo} schon`)

// --- Build; always restore package.json/-lock afterwards (the version lives only in the tag)
const zip = `dist/DevHub-${version}-win.zip`
let built = true
try {
  run(`npm version ${version} --no-git-tag-version --allow-same-version`)
  // --publish never: otherwise electron-builder may publish on its own in CI (GITHUB_TOKEN is set)
  run('npm run build:win -- --publish never')
} catch {
  built = false
}
run('git checkout -- package.json package-lock.json') // before fail(): process.exit skips finally
if (!built) fail('Build fehlgeschlagen')
if (!existsSync(zip)) fail(`${zip} wurde nicht gebaut`)

// --- Publish (creates the tag on `sha`)
const res = await api('/releases', {
  method: 'POST',
  body: JSON.stringify({
    tag_name: tag,
    target_commitish: sha,
    name: `DevHub ${version}`,
    body: notes,
    make_latest: 'true'
  })
})
const release = await res.json()
if (!res.ok) fail(`Release anlegen: ${res.status} ${JSON.stringify(release)}`)
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
  // Don't leave a half-finished release behind – a rerun would otherwise fail with "already exists"
  await api(`/releases/${release.id}`, { method: 'DELETE' })
  await api(`/git/refs/tags/${tag}`, { method: 'DELETE' })
  fail(`Upload: ${up.status} ${JSON.stringify(asset)} – Release und Tag ${tag} wieder entfernt`)
}
console.log(`Hochgeladen: ${asset.browser_download_url}`)
console.log(`\n✔ DevHub ${version} veröffentlicht`)
