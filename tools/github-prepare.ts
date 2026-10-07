import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { repositoryName, repositoryFromOrigin, labelActions } from './github-plan.ts'
import type { Label } from './github-plan.ts'
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const repoIndex = args.indexOf('--repo')
const repo = repositoryName(repoIndex < 0 ? '' : args[repoIndex + 1] ?? '')
if (args.some((arg, index) => index !== repoIndex + 1 && !['--repo', '--apply'].includes(arg))) throw new Error('Unknown option')
const labels = JSON.parse(readFileSync('.github/labels.json', 'utf8')) as Label[]
const marker = 'foundation-materialization-0-1-0-alpha-1'
const title = '[0.1.0-alpha.1] Validate the local foundation'
function run(command: string, commandArgs: string[]): string {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, shell: false })
  if (result.error || result.status !== 0) throw new Error(`${command} failed. Stop; inspect the outcome before retrying. ${result.error?.message ?? result.stderr.trim()}`)
  return result.stdout.trim()
}
function issues(): { number: number; url: string; body: string }[] {
  const values = JSON.parse(run('gh', ['issue', 'list', '--repo', repo, '--state', 'all', '--search', marker + ' in:body', '--limit', '100', '--json', 'number,url,body'])) as { number: number; url: string; body: string }[]
  return values.filter(item => item.body.includes('<!-- ' + marker + ' -->'))
}
function remoteLabels(): Label[] {
  return (JSON.parse(run('gh', ['api', `repos/${repo}/labels`, '--paginate', '--slurp'])) as Label[][]).flat()
}
console.log(`Target repository: ${repo}`)
if (!apply) {
  console.log('DRY RUN — no commands sent to GitHub. Existing remote state has not been checked.')
  console.log(JSON.stringify({ labels, issue: { title, bodyFile: '.github/seed/foundation.md' }, willNot: ['create repository', 'push commits', 'close issues', 'change branch protection', 'publish release', 'delete unrelated labels'] }, null, 2))
  console.log('To explicitly authorize just these metadata writes, repeat with --apply after configuring the matching Git origin.')
} else {
  const origin = repositoryFromOrigin(run('git', ['remote', 'get-url', 'origin']))
  if (origin?.toLowerCase() !== repo.toLowerCase()) throw new Error('Requested repository does not match local origin')
  const verified = JSON.parse(run('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'])) as { nameWithOwner: string }
  if (verified.nameWithOwner.toLowerCase() !== repo.toLowerCase()) throw new Error('Remote identity mismatch')
  const existingIssues = issues()
  if (existingIssues.length > 1) throw new Error('Duplicate foundation markers found. Resolve before proceeding.')
  for (const change of labelActions(labels, remoteLabels())) {
    run('gh', ['label', change.action === 'create' ? 'create' : 'edit', change.label.name,
      '--repo', repo, '--color', change.label.color, '--description', change.label.description])
    console.log(`${change.action}: ${change.label.name}`)
  }
  if (labelActions(labels, remoteLabels()).length) throw new Error('Label verification failed; do not blindly retry')
  if (!existingIssues.length) {
    console.log(run('gh', ['issue', 'create', '--repo', repo, '--title', title,
      '--body-file', '.github/seed/foundation.md', '--label', 'type:task', '--label', 'status:needs-validation']))
  }
  const verifiedIssues = issues()
  if (verifiedIssues.length !== 1) throw new Error('Issue outcome not confirmed. Inspect GitHub before retrying.')
  console.log('Verified foundation Issue: ' + verifiedIssues[0]?.url)
  console.log('No commit, push, publication or Issue closure was performed.')
}
