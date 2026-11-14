// New release – manual only: `npm run release -- <notes.md> [x.y.z]`
//
// 1. Version: patch +1 over package.json (or the given x.y.z, e.g. for 1.1.0)
// 2. Set package.json/-lock to the new version and build the ZIP (`npm run build:win`)
// 3. Commit "Version x.y.z" + tag vX.Y.Z, push both
// 4. Create the GitHub release for this tag (notes from the file) + upload the ZIP
//
// The notes file must contain the notes in every language of `NOTE_LANGUAGES`,
// each under its own heading (`## English`, `## Deutsch`); sub-headings use `###`.
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
  fail('Usage: npm run release -- <notes.md> [x.y.z]  (notes file missing)')
}
const notes = readFileSync(notesFile, 'utf8').trim()
if (!notes) fail('The notes file is empty')
// Release notes are bilingual: one `## <language>` section per language, each with content.
const NOTE_LANGUAGES = ['English', 'Deutsch']
const sections = new Map(
  notes
    .split(/^## +/m)
    .slice(1)
    .map((part) => [part.split('\n', 1)[0].trim(), part.slice(part.indexOf('\n') + 1).trim()])
)
for (const language of NOTE_LANGUAGES) {
  if (!sections.get(language)) {
    fail(
      `The notes need a non-empty section "## ${language}" (required: ${NOTE_LANGUAGES.map((l) => `## ${l}`).join(', ')})`
    )
  }
}

// --- Preconditions
if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Only from the main branch')
if (out('git status --porcelain')) fail('There are uncommitted changes – commit them first')
run('git fetch -q origin main --tags')
if (out('git rev-parse HEAD') !== out('git rev-parse origin/main')) {
  fail('main is not in sync with origin/main – push or pull first')
}

// --- Version
const current = JSON.parse(readFileSync('package.json', 'utf8')).version
const [maj, min, pat] = current.split('.').map(Number)
const version = wanted ?? `${maj}.${min}.${pat + 1}`
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Invalid version: ${version}`)
const tag = `v${version}`
if (out(`git tag -l ${tag}`)) fail(`Tag ${tag} already exists`)
console.log(`\nRelease ${current} → ${version}\n`)

// --- GitHub API
const cred = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n'
}).toString()
const token = /^password=(.*)$/m.exec(cred)?.[1]
if (!token) fail('No GitHub credentials stored with Git')
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'devhub-release-script'
}
const existing = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${tag}`, {
  headers
})
if (existing.ok) fail(`Release ${tag} already exists in ${RELEASE_REPO}`)

// --- Build (reset the version on failure)
run(`npm version ${version} --no-git-tag-version`)
try {
  run('npm run build:win')
} catch {
  run('git checkout -- package.json package-lock.json')
  fail('Build failed – version reset')
}
const zip = `dist/DevHub-${version}-win.zip`
if (!existsSync(zip)) {
  run('git checkout -- package.json package-lock.json')
  fail(`${zip} was not built – version reset`)
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
    `Creating the release failed: ${res.status} ${JSON.stringify(release)} – commit and tag ${tag} are already pushed; create the release on GitHub by hand and attach ${zip}`
  )
}
console.log(`\nRelease created: ${release.html_url}`)

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
    `Upload failed: ${up.status} ${JSON.stringify(asset)} – release ${tag} exists without the ZIP, please check`
  )
}
console.log(`Uploaded: ${asset.browser_download_url}`)
console.log(`\n✔ DevHub ${version} published`)
