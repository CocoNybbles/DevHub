// Build a new release and publish it on GitHub.
//
//   Manual:    npm run release -- [notes.md] [x.y.z] [--dry-run]
//   Workflow:  node scripts/release.mjs --ci   (.github/workflows/release.yml, after merging a
//              PR labelled "release"; env: GITHUB_TOKEN, GITHUB_READ_TOKEN, RELEASE_SHA,
//              RELEASE_PR)
//
// Release notes = all PRs merged into main since the last tag (title + full description;
// release PR first; label "no-changelog" hides a PR), below the optional notes file. --dry-run only prints version and notes.
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

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'))
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const ci = flags.includes('--ci')
const dryRun = flags.includes('--dry-run')
const repo = process.env.GITHUB_REPOSITORY || 'CocoNybbles/DevHub'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const out = (cmd) => execSync(cmd).toString().trim()
const fail = (msg) => {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

// --- Inputs: commit, optional intro text, requested version, release PR
let sha, intro, wanted, releasePr
if (ci) {
  sha = process.env.RELEASE_SHA
  if (!sha) fail('RELEASE_SHA is missing')
  if (out('git rev-parse HEAD') !== sha) fail(`Checked out commit is not ${sha}`)
  wanted = process.env.RELEASE_VERSION || undefined
  releasePr = Number(process.env.RELEASE_PR) || undefined
} else {
  // Arguments in any order: a notes file (optional, goes above the PR list) and/or x.y.z
  wanted = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))
  const notesFile = args.find((a) => a !== wanted)
  if (notesFile) {
    if (!existsSync(notesFile)) fail(`Notes file ${notesFile} does not exist`)
    intro = readFileSync(notesFile, 'utf8').trim()
  }
  if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Only from the main branch')
  if (!dryRun && out('git status --porcelain')) {
    fail('There are uncommitted changes – commit them first')
  }
  run('git fetch -q origin main')
  sha = out('git rev-parse HEAD')
  if (sha !== out('git rev-parse origin/main')) {
    fail('main is not in sync with origin/main – push or pull first')
  }
}

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
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Invalid version: ${version}`)
if (!newer(version, latest)) fail(`Version ${version} is not newer than v${latest}`)
const tag = `v${version}`
console.log(`\nRelease v${latest} → ${tag} (commit ${sha.slice(0, 7)})\n`)

// --- GitHub API
let token = process.env.GITHUB_TOKEN
if (!ci) {
  const cred = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n\n'
  }).toString()
  token = /^password=(.*)$/m.exec(cred)?.[1]
}
if (!token) fail('No GitHub credentials available')
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
if ((await api(`/releases/tags/${tag}`)).ok) fail(`Release ${tag} already exists in ${repo}`)

// --- Release notes: every PR merged into main since the last release, with its full description.
// Read with GITHUB_READ_TOKEN if set (workflow: github.token with pull-requests: read – the
// fine-grained RELEASE_TOKEN only has Contents permission).
const readHeaders = process.env.GITHUB_READ_TOKEN
  ? { ...headers, Authorization: `Bearer ${process.env.GITHUB_READ_TOKEN}` }
  : headers
const read = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers: readHeaders })
  if (!r.ok) fail(`GitHub ${path}: ${r.status} ${await r.text()}`)
  return r.json()
}
const prs = new Map()
if (latest !== '0.0.0') {
  // Commits since the last tag → their PRs (works for merge, squash and rebase merges)
  for (let page = 1; ; page++) {
    const cmp = await read(`/compare/v${latest}...${sha}?per_page=100&page=${page}`)
    for (const c of cmp.commits) {
      for (const pr of await read(`/commits/${c.sha}/pulls`)) {
        if (pr.merged_at && pr.base.ref === 'main') prs.set(pr.number, pr)
      }
    }
    if (cmp.commits.length < 100) break
  }
}
if (releasePr && !prs.has(releasePr)) prs.set(releasePr, await read(`/pulls/${releasePr}`))
// PRs labelled "no-changelog" are left out of the notes (their code is still in the release)
const hidden = (pr) => pr.labels.some((l) => l.name === 'no-changelog')
for (const pr of prs.values()) {
  if (hidden(pr)) console.log(`Not in the changelog (no-changelog): #${pr.number} ${pr.title}`)
}
// Release PR first, then the others newest first
const ordered = [...prs.values()]
  .filter((pr) => !hidden(pr))
  .sort(
    (a, b) =>
      (b.number === releasePr) - (a.number === releasePr) ||
      Date.parse(b.merged_at) - Date.parse(a.merged_at)
  )
const clean = (body) =>
  (body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/^🤖 Generated with \[Claude Code\].*$/gm, '') // attribution line, not for testers
    .trim()
const sections = ordered.map((pr) => {
  const body = clean(pr.body)
  return `### ${pr.title} (#${pr.number})` + (body ? `\n\n${body}` : '')
})
const notes = [intro, ...sections].filter(Boolean).join('\n\n')
if (!notes.trim()) {
  const skipped = [...prs.values()].filter(hidden).map((pr) => `#${pr.number}`)
  fail(
    'No release notes: no PRs for the changelog since the last release' +
      (skipped.length ? ` (hidden: ${skipped.join(', ')})` : '')
  )
}
console.log(`Release notes (${ordered.length} PRs):\n\n${notes}\n`)
if (dryRun) {
  console.log('--dry-run: nothing built, nothing published')
  process.exit(0)
}

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
if (!built) fail('Build failed')
if (!existsSync(zip)) fail(`${zip} was not built`)

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
if (!res.ok) fail(`Creating the release failed: ${res.status} ${JSON.stringify(release)}`)
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
  // Don't leave a half-finished release behind – a rerun would otherwise fail with "already exists"
  await api(`/releases/${release.id}`, { method: 'DELETE' })
  await api(`/git/refs/tags/${tag}`, { method: 'DELETE' })
  fail(
    `Upload failed: ${up.status} ${JSON.stringify(asset)} – release and tag ${tag} removed again`
  )
}
console.log(`Uploaded: ${asset.browser_download_url}`)
console.log(`\n✔ DevHub ${version} published`)
