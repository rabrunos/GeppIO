/** Offline repository checks. Runtime, remote identity and manual acceptance require separate evidence. */
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, relative, dirname, join } from 'node:path'

const root = process.cwd()
const errors: string[] = []
function text(path: string): string { return readFileSync(join(root, path), 'utf8') }
function requireFile(path: string) { if (!existsSync(join(root, path))) errors.push('Missing required file: ' + path) }
function check(condition: boolean, message: string) { if (!condition) errors.push(message) }
interface Profile {
  schema: string; project: { name: string }; validation: { required_files: string[]; canonical_capabilities: string[] }
  workflow: {
    tracking: string; primary_environment: string; optional_assistants: string[]; handoff: string
    implementation_harnesses: string[]; consumption_preset: string; collaboration: string
  }
  versioning: {
    canonical_source: string; value_path: string; history_source: string
    target_version_in_commit: boolean; target_version_in_report_h1: boolean
    source_delivery_requires_new_target: boolean; intermediate_deliveries_within_contract: boolean
  }
  execution_permissions: { safe_default: string }; console: { enabled: boolean }
  distribution: { mode: string; targets: unknown[] }; services: unknown[]; skills: string[]; roles: string[]
}
interface Package { name: string; version: string; scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }
const pkg = JSON.parse(text('package.json')) as Package
const profile = JSON.parse(text('docs/.ai/project-profile.json')) as Profile
check(profile.schema === 'geppio/project-profile/v5', 'Unexpected project profile schema')
check(profile.project.name === pkg.name, 'Profile and package identity differ')
check(/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/.test(pkg.version), 'Expected semver project version')
check(profile.versioning.canonical_source === 'package.json' && profile.versioning.value_path === '/version', 'Version must have one package.json source')
check(profile.versioning.source_delivery_requires_new_target === true, 'Each delivered application-source batch must advance its target')
check(profile.versioning.intermediate_deliveries_within_contract === true, 'A contract may span multiple versioned deliveries')
check(profile.versioning.target_version_in_commit === true && profile.versioning.target_version_in_report_h1 === true,
  'Implementation commits and reports must preserve the assigned target')
const releases = [...text(profile.versioning.history_source).matchAll(/^## \[([^\]]+)\]/gm)].map(match => match[1])
check(releases[0] === pkg.version && new Set(releases).size === releases.length,
  'Canonical version must head the changelog, and each release must be unique')
check(profile.workflow.tracking === 'github_issues', 'Executable work must use GitHub Issues')
check(profile.workflow.handoff === 'optional', 'Work must not require a separate assistant handoff')
check(profile.execution_permissions.safe_default === 'protected_auto', 'Unexpected safe execution default')
// Active repository references are scoped separately from immutable release/provenance records.
// This source gate does not verify a live Git remote or grant commit/push authorization.
const canonicalRepository = 'rabrunos/GeppIO'
for (const path of ['PROJECT_GUIDE.md', 'AGENTS.md', 'README.md', 'docs/.ai/TASK_POLICY.md',
  'docs/.ai/orchestration.md', 'docs/.ai/project-profile.json', 'docs/development/github.md',
  'docs/development/renaming.md', 'src/geppio/src/shared/identity.ts']) {
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
  properties: {
    schema: { const: string }; skills: { const: string[] }; roles: { const: string[] }
    workflow: {
      properties: Record<keyof Profile['workflow'], { const?: string | string[]; enum?: string[]; items?: { enum: string[] }; uniqueItems?: boolean }>
      required: string[]; additionalProperties: boolean
    }
    execution_permissions: { properties: { safe_default: { const: string } } }
    versioning: { properties: {
      source_delivery_requires_new_target: { const: boolean }; intermediate_deliveries_within_contract: { const: boolean }
      target_version_in_commit: { const: boolean }; target_version_in_report_h1: { const: boolean }
    } }
  }
}
check(profileSchema.properties.schema.const === profile.schema, 'Project profile and schema revision differ')
check(profileSchema.properties.versioning.properties.intermediate_deliveries_within_contract.const === profile.versioning.intermediate_deliveries_within_contract,
  'Profile schema and contract delivery policy differ')
check(profileSchema.properties.versioning.properties.source_delivery_requires_new_target.const === profile.versioning.source_delivery_requires_new_target,
  'Profile schema and source-delivery version policy differ')
check(profileSchema.properties.execution_permissions.properties.safe_default.const === profile.execution_permissions.safe_default,
  'Profile schema and execution default differ')
for (const key of ['target_version_in_commit', 'target_version_in_report_h1'] as const) {
  check(profileSchema.properties.versioning.properties[key].const === profile.versioning[key],
    'Profile schema and delivery target policy differ: ' + key)
}
// Validate the small workflow contract, not a live client or the full JSON Schema vocabulary.
const workflowSchema = profileSchema.properties.workflow
for (const key of workflowSchema.required) check(Object.hasOwn(profile.workflow, key), 'Missing workflow setting: ' + key)
check(workflowSchema.additionalProperties === false, 'Workflow schema must reject unknown settings')
for (const key of Object.keys(profile.workflow)) {
  const rule = workflowSchema.properties[key as keyof Profile['workflow']]
  if (!rule) { errors.push('Unknown workflow setting: ' + key); continue }
  const value = profile.workflow[key as keyof Profile['workflow']]
  if (Object.hasOwn(rule, 'const')) check(JSON.stringify(value) === JSON.stringify(rule.const), 'Profile schema and workflow differ: ' + key)
  if (rule.enum) check(typeof value === 'string' && rule.enum.includes(value), 'Invalid workflow setting: ' + key)
  if (rule.items) check(Array.isArray(value) && value.every(item => rule.items!.enum.includes(item))
    && (!rule.uniqueItems || new Set(value).size === value.length), 'Invalid workflow setting: ' + key)
}
check(!profile.console.enabled, 'No project console was requested')
check(profile.services.length === 0 && profile.distribution.mode === 'none' && profile.distribution.targets.length === 0, 'This foundation must not silently provision/publish')
for (const path of profile.validation.required_files) requireFile(path)
for (const name of profile.validation.canonical_capabilities) check(typeof pkg.scripts[name] === 'string', 'Missing canonical command: ' + name)
const workspaceNames = new Set<string>()
for (const dir of readdirSync('src', { withFileTypes: true })) {
  const path = join('src', dir.name, 'package.json')
  if (dir.isDirectory() && existsSync(path)) workspaceNames.add((JSON.parse(text(path)) as Package).name)
}
for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const pinned = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/.test(version)
  check(pinned || (version === 'workspace:*' && workspaceNames.has(name)), 'Dependency needs an explicit pin or local workspace: ' + name)
}
for (const script of Object.values(pkg.scripts)) for (const match of script.matchAll(/\btools\/([\w.-]+\.ts)\b/g)) requireFile('tools/' + match[1])
for (const category of ['skills', 'roles'] as const) {
  const expected = profileSchema.properties[category].const
  check(expected.length > 0
    && new Set(expected).size === expected.length
    && JSON.stringify(profile[category]) === JSON.stringify(expected), 'Unexpected project ' + category)
}
const skillRoot = '.agents/skills'
const discoveredSkills = readdirSync(skillRoot).filter(dir => existsSync(join(skillRoot, dir, 'SKILL.md')))
check(discoveredSkills.sort().join() === [...profile.skills].sort().join(), 'Skill discovery and project inventory differ')
for (const skill of profile.skills) {
  if (!/^[a-z]+(?:-[a-z]+)+$/.test(skill)) { errors.push('Invalid skill name'); continue }
  const path = join(skillRoot, skill, 'SKILL.md')
  requireFile(path)
  if (existsSync(path)) {
    const frontmatter = /^---\r?\nname: ([\w-]+)\r?\ndescription: (.+)\r?\n---\r?\n/.exec(text(path))
    check(frontmatter?.[1] === skill && Boolean(frontmatter[2]?.trim()), 'Invalid skill frontmatter: ' + skill)
  }
}
const roleRoot = '.codex/agents'
check(readdirSync(roleRoot).filter(name => name.endsWith('.toml')).sort().join()
  === profile.roles.map(name => name + '.toml').sort().join(), 'Role discovery and project inventory differ')
for (const role of profile.roles) {
  if (!/^[a-z]+(?:-[a-z]+)+$/.test(role)) { errors.push('Invalid role name'); continue }
  const path = join(roleRoot, role + '.toml')
  requireFile(path)
  if (!existsSync(path)) continue
  // Repository convention: two simple strings and one multiline assignment, no role-level overrides.
  const definition = /^name = "([\w-]+)"\r?\ndescription = "([^"\r\n]+)"\r?\ndeveloper_instructions = """\r?\n([^"]+)"""\s*$/.exec(text(path))
  check(definition?.[1] === role && Boolean(definition[3]?.trim()), 'Invalid project role definition: ' + role)
}
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
  'agents.enabled': 'true', 'agents.max_concurrent_threads_per_session': '2', '.approval_policy': '"on-request"',
  '.sandbox_mode': '"workspace-write"', '.approvals_reviewer': '"auto_review"',
  'sandbox_workspace_write.network_access': 'true'
})) {
  const values = settings.get(key)
  check(values?.length === 1 && values[0] === expected, 'Unexpected requested Codex default: ' + key)
}
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
check(workflow.includes('--frozen-lockfile') && workflow.includes('run: pnpm test:ci:${{ matrix.group }}')
  && existsSync('tests/ci-plan.test.ts'), 'CI needs a real lock and the coverage-verified built desktop groups')
check(!workflow.includes('pull_request_target'), 'Do not execute untrusted PR code with elevated target context')
const excluded = new Set(['node_modules', '.pnpm-store', '.git', '.local', 'out', 'dist'])
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
if (errors.length) {
  console.error(errors.map(error => 'FAIL  ' + error).join('\n')); process.exitCode = 1
} else console.log(`PASS  Materialized source checks: ${files.length} files, version ${pkg.version}, links, selected policies and commands. Effective agent settings/runtime behavior were not tested by this check.`)
