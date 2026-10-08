/** Dependency-free materialization checks. This is not a runtime/security certification. */
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, relative, dirname, join } from 'node:path'

const root = process.cwd()
const errors: string[] = []
function text(path: string): string { return readFileSync(join(root, path), 'utf8') }
function requireFile(path: string) { if (!existsSync(join(root, path))) errors.push('Missing required file: ' + path) }
function check(condition: boolean, message: string) { if (!condition) errors.push(message) }
interface Profile {
  schema: string; project: { name: string }; validation: { required_files: string[]; canonical_capabilities: string[] }
  workflow: { tracking: string; primary_orchestrator: string; implementation_harnesses: string[] }
  versioning: { canonical_source: string; value_path: string; history_source: string }
  execution_permissions: { safe_default: string }; console: { enabled: boolean }
  distribution: { mode: string; targets: unknown[] }; services: unknown[]; skills: string[]
}
interface Package { name: string; version: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }
const pkg = JSON.parse(text('package.json')) as Package
const profile = JSON.parse(text('docs/.ai/project-profile.json')) as Profile
check(profile.schema === 'project-profile/v3', 'Unexpected normalized profile schema')
check(profile.project.name === pkg.name, 'Profile and package identity differ')
check(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/.test(pkg.version), 'Expected semver project version')
check(profile.versioning.canonical_source === 'package.json' && profile.versioning.value_path === '/version', 'Version must have one package.json source')
check(text(profile.versioning.history_source).includes('## [' + pkg.version + ']'), 'Canonical changelog needs the integrated version')
check(profile.workflow.tracking === 'github_issues' && profile.workflow.primary_orchestrator === 'chatgpt', 'Selected work tracking/orchestration missing')
check(profile.workflow.implementation_harnesses.length === 1 && profile.workflow.implementation_harnesses[0] === 'codex', 'Only the selected Codex harness belongs in this project')
check(profile.execution_permissions.safe_default === 'protected_auto', 'Unexpected safe execution default')
// Active repository references are scoped separately from immutable release/provenance records.
// This source gate does not verify a live Git remote or grant commit/push authorization.
const canonicalRepository = 'rabrunos/GeppIO'
for (const path of ['PROJECT_GUIDE.md', 'AGENTS.md', 'README.md', 'docs/.ai/TASK_POLICY.md',
  'docs/.ai/orchestration.md', 'docs/.ai/project-profile.json', 'docs/development/github.md',
  'docs/development/renaming.md', 'src/shared/identity.ts']) {
  const source = text(path)
  check(source.includes(canonicalRepository), 'Missing canonical repository reference: ' + path)
  for (const line of source.split(/\r?\n/)) {
    if (/rabrunos\/geptor\b/i.test(line)) check(line.startsWith('Historical repository name:'), 'Outdated active repository reference: ' + path)
  }
}
const taskPolicy = text('docs/.ai/TASK_POLICY.md')
check(taskPolicy.includes('## Standing Git authorization — `' + canonicalRepository + '` only')
  && taskPolicy.includes('approved `' + canonicalRepository + '` Issue')
  && taskPolicy.includes('both origin fetch and push URLs identify `' + canonicalRepository + '`')
  && taskPolicy.includes('GitHub repository ID `1409287329`'), 'Standing Git gate must name only the canonical repository and stable ID')
check(text('AGENTS.md').includes('For approved Issues in `' + canonicalRepository + '`'), 'Agent Git gate must name the canonical repository')
const profileSchema = JSON.parse(text('docs/.ai/schemas/project-profile.schema.json')) as {
  properties: { execution_permissions: { properties: { safe_default: { const: string } } } }
}
check(profileSchema.properties.execution_permissions.properties.safe_default.const === profile.execution_permissions.safe_default,
  'Profile schema and execution default differ')
check(!profile.console.enabled, 'No project console was requested')
check(profile.services.length === 0 && profile.distribution.mode === 'none' && profile.distribution.targets.length === 0, 'This foundation must not silently provision/publish')
for (const path of profile.validation.required_files) requireFile(path)
for (const name of profile.validation.canonical_capabilities) check(typeof pkg.scripts[name] === 'string', 'Missing canonical command: ' + name)
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) check(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/.test(version), 'Dependency needs an explicit pin: ' + name)
for (const script of Object.values(pkg.scripts)) for (const match of script.matchAll(/\btools\/([\w.-]+\.ts)\b/g)) requireFile('tools/' + match[1])
for (const skill of profile.skills) {
  const path = `.agents/skills/${skill}/SKILL.md`; requireFile(path)
  if (existsSync(path)) check(text(path).startsWith('---\nname: ' + skill + '\n'), 'Invalid skill frontmatter: ' + skill)
}
for (const path of ['docs/.human/bootstrap', '.claude', 'CLAUDE.md', 'project-console', 'VERSION', '.github/workflows/bootcrate-validate.yml']) check(!existsSync(path), 'Unselected/upstream material was retained: ' + path)
const config = text('.codex/config.toml')
// Inspect active flat defaults in their section, not comments or matching values in another table.
// This bounded source check is not a general TOML parser or proof of effective client permissions.
const settings = new Map<string, string[]>()
let section = ''
for (const line of config.split(/\r?\n/)) {
  const table = /^\s*\[([\w.]+)\]\s*(?:#.*)?$/.exec(line)
  if (table) { section = table[1]!; continue }
  const assignment = /^\s*(\w+)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(line)
  if (!assignment) continue
  const key = section + '.' + assignment[1]
  settings.set(key, [...(settings.get(key) ?? []), assignment[2]!])
}
for (const [key, expected] of Object.entries({
  '.model_reasoning_effort': '"high"', '.approval_policy': '"on-request"',
  '.sandbox_mode': '"workspace-write"', '.approvals_reviewer': '"auto_review"',
  'sandbox_workspace_write.network_access': 'true'
})) {
  const values = settings.get(key)
  check(values?.length === 1 && values[0] === expected, 'Unexpected requested Codex default: ' + key)
}
check(text('.codex/agents/scout.toml').includes('sandbox_mode = "read-only"'), 'Scout must request read-only execution')
check(!config.includes('api_key'), 'Do not place credentials in the Codex config')
const labels = JSON.parse(text('.github/labels.json')) as { name: string; color: string; description: string }[]
check(labels.length > 0 && new Set(labels.map(label => label.name)).size === labels.length, 'Labels must be non-empty and unique')
for (const label of labels) check(/^[a-fA-F0-9]{6}$/.test(label.color) && typeof label.description === 'string', 'Invalid label metadata: ' + label.name)
const forms = readdirSync('.github/ISSUE_TEMPLATE').filter(name => name !== 'config.yml')
for (const file of forms) {
  const body = text('.github/ISSUE_TEMPLATE/' + file)
  for (const match of body.matchAll(/labels: \["([^"]+)"\]/g)) check(labels.some(label => label.name === match[1]), 'Form label not declared: ' + match[1])
}
const workflow = text('.github/workflows/checks.yml')
check(workflow.includes('contents: read') && workflow.includes('persist-credentials: false'), 'CI must keep read-only permissions and avoid persisting credentials')
for (const match of workflow.matchAll(/uses:\s*([^\s#]+)/g)) check(/@[a-f0-9]{40}$/.test(match[1] ?? ''), 'External CI action is not commit-pinned: ' + match[1])
check(workflow.includes('--frozen-lockfile') && workflow.includes('pnpm test:desktop'), 'CI needs a real lock and built desktop validation')
check(!workflow.includes('pull_request_target'), 'Do not execute untrusted PR code with elevated target context')
const excluded = new Set(['node_modules', '.git', '.local', 'out', 'dist'])
function walk(dir: string): string[] {
  return readdirSync(dir).filter(name => !excluded.has(name)).flatMap(name => {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) { errors.push('Symbolic link excluded from source validation: ' + relative(root, path)); return [] }
    return stat.isDirectory() ? walk(path) : [path]
  })
}
const files = walk(root)
for (const file of files.filter(path => path.endsWith('.md'))) {
  const body = readFileSync(file, 'utf8')
  for (const match of body.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? ''
    if (!target || target.startsWith('#') || /^[a-zA-Z][\w+.-]*:/.test(target)) continue
    const withoutAnchor = target.split('#')[0]?.split('?')[0] ?? ''
    let decoded: string
    try { decoded = decodeURIComponent(withoutAnchor) } catch { errors.push('Invalid link encoding: ' + relative(root, file)); continue }
    check(existsSync(resolve(dirname(file), decoded)), `Broken local link: ${relative(root, file)} -> ${target}`)
  }
}
if (!existsSync('pnpm-lock.yaml')) console.log('NOTE: lockfile awaits the first real local dependency install; CI will require it.')
if (errors.length) {
  console.error(errors.map(error => 'FAIL  ' + error).join('\n')); process.exitCode = 1
} else console.log(`PASS  Materialized source checks: ${files.length} files, version ${pkg.version}, links, selected policies and commands. Effective agent settings/runtime behavior were not tested by this check.`)
