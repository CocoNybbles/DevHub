// Release workflow, first job: which PR did the push to main come from, and is it labelled
// "release"? Writes `pr=<number>` to $GITHUB_OUTPUT if so, otherwise `pr=` (no release).
//
//   env: GITHUB_TOKEN (pull-requests: read), GITHUB_REPOSITORY, RELEASE_SHA, GITHUB_OUTPUT
//
// The PR is found via GET /commits/<sha>/pulls: its merge_commit_sha is the pushed commit for
// merge, squash and rebase merges. A direct push without a PR never releases.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JS script */
import { appendFileSync } from 'fs'

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, RELEASE_SHA: sha } = process.env
if (!token || !repo || !sha) {
  console.error('GITHUB_TOKEN, GITHUB_REPOSITORY and RELEASE_SHA are required')
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const findPr = async () => {
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/pulls`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devhub-release-script'
    }
  })
  if (!res.ok) throw new Error(`GET /commits/${sha}/pulls: ${res.status}`)
  const prs = await res.json()
  return prs.find((pr) => pr.merged_at && pr.base.ref === 'main' && pr.merge_commit_sha === sha)
}

// The association between commit and PR can lag a few seconds behind the push
let pr
for (let i = 1; i <= 5 && !pr; i++) {
  try {
    pr = await findPr()
  } catch (err) {
    console.warn(err.message)
  }
  if (!pr && i < 5) await sleep(5000 * i)
}

const release = !!pr && pr.labels.some((l) => l.name === 'release')
console.log(
  !pr
    ? `No merged PR for ${sha} – no release`
    : release
      ? `PR #${pr.number} is labelled "release"`
      : `PR #${pr.number} is not labelled "release" – no release`
)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `pr=${release ? pr.number : ''}\n`)
}
