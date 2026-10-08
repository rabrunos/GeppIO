import test from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('repository gate preserves protected defaults and the canonical Git authorization scope', t => {
  // Copy only project source into a disposable fixture; never edit actual client/global settings.
  const root = mkdtempSync(join(tmpdir(), 'geppio-policy-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of ['AGENTS.md', 'PROJECT_GUIDE.md', 'README.md', 'CHANGELOG.md', 'package.json',
    '.codex', '.agents', '.github', '.vscode', 'docs', 'tools', 'src', 'tests', 'sdk', 'examples']) {
    cpSync(path, join(root, path), { recursive: true })
  }
  const path = join(root, '.codex/config.toml'), original = readFileSync(path, 'utf8')
  function gate(config: string) {
    writeFileSync(path, config)
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/check-repo.ts'], {
      cwd: root, encoding: 'utf8', windowsHide: true
    })
    if (result.error) throw result.error
    return result
  }
  assert.equal(gate(original).status, 0)
  assert.equal(gate(original.replace('sandbox_mode = "workspace-write"', '  sandbox_mode = "workspace-write" # retained boundary')).status, 0)
  for (const [before, after, key] of [
    ['sandbox_mode = "workspace-write"', 'sandbox_mode = "danger-full-access"', '.sandbox_mode'],
    ['approval_policy = "on-request"', 'approval_policy = "never"', '.approval_policy'],
    ['approvals_reviewer = "auto_review"', 'approvals_reviewer = "user"', '.approvals_reviewer'],
    ['network_access = true', 'network_access = false', 'sandbox_workspace_write.network_access'],
    ['sandbox_mode = "workspace-write"', '# sandbox_mode = "workspace-write"', '.sandbox_mode'],
    ['[sandbox_workspace_write]', '[unrelated_table]', 'sandbox_workspace_write.network_access'],
    ['approval_policy = "on-request"', 'approval_policy = "on-request"\napproval_policy = "never"', '.approval_policy']
  ]) {
    const result = gate(original.replace(before!, after!))
    assert.equal(result.status, 1, key)
    assert(result.stderr.includes('Unexpected requested Codex default: ' + key), result.stderr)
  }
  // Old release evidence and the explicitly labelled historical name remain valid.
  assert.equal(gate(original).status, 0)
  assert.match(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), /retain rabrunos\/Geptor/)
  const policyPath = join(root, 'docs/.ai/TASK_POLICY.md'), policy = readFileSync(policyPath, 'utf8')
  for (const [before, after] of [
    ['## Standing Git authorization — `rabrunos/GeppIO` only', '## Standing Git authorization — `rabrunos/Geptor` only'],
    ['both origin fetch and push URLs identify `rabrunos/GeppIO`', 'both origin fetch and push URLs identify `another-owner/GeppIO`'],
    ['GitHub repository ID `1409287329`', 'GitHub repository ID `1409287330`']
  ]) {
    writeFileSync(policyPath, policy.replace(before!, after!))
    const result = gate(original)
    assert.equal(result.status, 1)
    assert(result.stderr.includes('Standing Git gate must name only the canonical repository and stable ID'), result.stderr)
  }
  writeFileSync(policyPath, policy)
  const guidePath = join(root, 'PROJECT_GUIDE.md'), guide = readFileSync(guidePath, 'utf8')
  writeFileSync(guidePath, guide.replaceAll('rabrunos/GeppIO', 'rabrunos/Geptor'))
  const outdated = gate(original)
  assert.equal(outdated.status, 1)
  assert(outdated.stderr.includes('Outdated active repository reference: PROJECT_GUIDE.md'), outdated.stderr)
  writeFileSync(guidePath, guide)
  assert.equal(gate(original).status, 0)
  // The profile and its schema must agree with the owner-selected project defaults.
  const profilePath = join(root, 'docs/.ai/project-profile.json')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as { execution_permissions: { safe_default: string } }
  const schema = JSON.parse(readFileSync(join(root, 'docs/.ai/schemas/project-profile.schema.json'), 'utf8')) as {
    properties: { execution_permissions: { properties: { safe_default: { const: string } } } }
  }
  assert.equal(profile.execution_permissions.safe_default, schema.properties.execution_permissions.properties.safe_default.const)
  profile.execution_permissions.safe_default = 'protected_manual'
  writeFileSync(profilePath, JSON.stringify(profile))
  const result = gate(original)
  assert.equal(result.status, 1)
  assert(result.stderr.includes('Unexpected safe execution default'))
  profile.execution_permissions.safe_default = 'protected_auto'
  writeFileSync(profilePath, JSON.stringify(profile))
  schema.properties.execution_permissions.properties.safe_default.const = 'protected_manual'
  writeFileSync(join(root, 'docs/.ai/schemas/project-profile.schema.json'), JSON.stringify(schema))
  const inconsistent = gate(original)
  assert.equal(inconsistent.status, 1)
  assert(inconsistent.stderr.includes('Profile schema and execution default differ'))
})
