import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { PluginStore, inspectPackage } from '../src/main/plugins.ts'
import { PACKAGE_DOMAIN, PACKAGE_LIMITS, PACKAGE_MAGIC, readPackageSnapshot, verifyPluginPackage } from '../src/main/plugin-package.ts'
import { PLUGIN_TRUST } from '../src/main/plugin-trust.ts'
import { signPluginPackage, publicIdentity } from '../tools/plugin-package.ts'

const id = 'geppio.workspace-essentials', { privateKey } = generateKeyPairSync('ed25519')
const trust = [{ ...publicIdentity(privateKey), pluginId: id, publisher: 'Disposable test publisher', revoked: false }] as const
const source = resolve('.local/plugin-packages/workspace-essentials')
before(() => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/build-plugins.ts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'geppio-plugin-package-')), managed = join(root, 'plugins'), path = join(root, 'input.gpp')
  const pkg = await inspectPackage(source), bytes = signPluginPackage(pkg, privateKey)
  await writeFile(path, bytes)
  return { root, managed, path, pkg, bytes, store: new PluginStore(managed, trust), clean: () => rm(root, { recursive: true, force: true }) }
}
const yes = async () => true, current = () => true
function raw(entries: unknown, metadata: unknown = { keyId: trust[0].keyId, pluginId: id }): Buffer {
  const meta = Buffer.from(JSON.stringify(metadata)), payload = Buffer.from(JSON.stringify(entries)), header = Buffer.alloc(20)
  PACKAGE_MAGIC.copy(header); header.writeUInt32BE(1, 8); header.writeUInt32BE(meta.length, 12); header.writeUInt32BE(payload.length, 16)
  const body = Buffer.concat([header, meta, payload])
  return Buffer.concat([body, sign(null, Buffer.concat([PACKAGE_DOMAIN, body]), privateKey)])
}

test('independently built payload signs reproducibly; production rejects temporary trust', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(f.bytes, signPluginPackage(await inspectPackage(source), privateKey))
    assert.equal(verifyPluginPackage(f.bytes, trust).manifest.apiVersion, 2)
    assert.equal(PLUGIN_TRUST.length, 1)
    const official = PLUGIN_TRUST[0]!, publicKey = createPublicKey(official.publicKey)
    assert.equal(publicKey.asymmetricKeyType, 'ed25519')
    assert.equal(createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'), 'afce9e671489882fa41e1dbed7b1c7280b96d06fbe1f6635f3c62c4ceff7bb04')
    assert.equal(official.keyId, 'afce9e671489882fa41e1dbed7b1c7280b96d06fbe1f6635f3c62c4ceff7bb04')
    assert.equal(official.pluginId, id); assert.equal(official.revoked, false)
    assert.notEqual(official.keyId, trust[0].keyId, 'Temporary keys never become production trust roots')
    assert.throws(() => verifyPluginPackage(f.bytes), /desconhecido/)
    await assert.rejects(new PluginStore(join(f.root, 'production')).installSigned(f.path, yes, current), /desconhecido/)
    // Exercise the real CLI with private material in a disposable external directory, never checkout.
    const keyPath = join(f.root, 'test-key.pem'), output = join(f.root, 'cli.gpp')
    await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/plugin-package.ts', source, output, '--key-file', keyPath], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr); assert.ok(!result.stdout.includes('PRIVATE KEY'))
    assert.deepEqual(await readFile(output), f.bytes)
  } finally { await f.clean() }
})

test('framing, metadata, signature, scope, revoked and unknown keys fail closed', async () => {
  const f = await fixture()
  try {
    for (const at of [0, 8, 12, 16, 25, f.bytes.length - 65, f.bytes.length - 1]) {
      const bytes = Buffer.from(f.bytes); bytes[at] = bytes[at]! ^ 1
      assert.throws(() => verifyPluginPackage(bytes, trust), String(at))
    }
    for (const bytes of [f.bytes.subarray(1), Buffer.concat([f.bytes, Buffer.from('x')]), Buffer.alloc(PACKAGE_LIMITS.bytes + 1)]) assert.throws(() => verifyPluginPackage(bytes, trust))
    assert.throws(() => verifyPluginPackage(f.bytes, [{ ...trust[0], revoked: true }]), /revogado/)
    assert.throws(() => verifyPluginPackage(f.bytes, [{ ...trust[0], pluginId: 'different.scope' } as never]), /escopo/)
    assert.throws(() => verifyPluginPackage(raw([], { keyId: '0'.repeat(64), pluginId: id }), trust), /desconhecido/)
    for (const metadata of [{ keyId: trust[0].keyId, pluginId: 'other.plugin' }, { keyId: trust[0].keyId, pluginId: id, publicKey: trust[0].publicKey }]) assert.throws(() => verifyPluginPackage(raw([], metadata), trust))
    await writeFile(f.path, Buffer.alloc(PACKAGE_LIMITS.bytes + 1)); await assert.rejects(readPackageSnapshot(f.path), /3 MiB/)
    await assert.rejects(readPackageSnapshot(f.root), /regular/)
  } finally { await f.clean() }
})

test('authenticated entry set rejects unsafe paths, non-files, Windows aliases, prefix conflicts and missing entry', async () => {
  const f = await fixture()
  try {
    const entries = [...f.pkg.files].map(([path, bytes]) => ({ path, type: 'file', content: Buffer.from(bytes).toString('base64') }))
    for (const path of ['../evil.js', '/evil.js', 'C:/evil.js', 'nested\\evil.js', 'nul.js', 'entry.js.', 'entry.js:ads', 'a//b.js', 'a/'.repeat(10) + 'b.js']) assert.throws(() => verifyPluginPackage(raw([...entries, { path, type: 'file', content: '' }]), trust), path)
    for (const extra of [entries[0], { ...entries[0], path: 'ENTRY.JS' }, { path: 'entry.js/x.js', type: 'file', content: '' }, { path: 'other.js', type: 'symlink', content: 'entry.js' }, { path: 'other.js', type: 'directory', content: '' }, { path: 'other.js', type: 'file', content: '***' }, { path: 'other.js', type: 'file', content: 'eA' }]) assert.throws(() => verifyPluginPackage(raw([...entries, extra]), trust))
    assert.throws(() => verifyPluginPackage(raw([...entries, { path: 'Dir/a.js', type: 'file', content: '' }, { path: 'dir/b.js', type: 'file', content: '' }]), trust))
    assert.throws(() => verifyPluginPackage(raw(entries.filter(entry => entry.path !== f.pkg.manifest.entry)), trust), /entrada/)
    assert.throws(() => verifyPluginPackage(raw(entries.filter(entry => entry.path !== 'plugin.json')), trust), /plugin.json/)
    const wrongManifest = { ...f.pkg.manifest, id: 'other.plugin' }
    assert.throws(() => verifyPluginPackage(raw(entries.map(entry => entry.path === 'plugin.json' ? { ...entry, content: Buffer.from(JSON.stringify(wrongManifest)).toString('base64') } : entry)), trust), /escopo/)
    assert.throws(() => verifyPluginPackage(raw(Array.from({ length: 65 }, (_, i) => ({ path: `a${i}.js`, type: 'file', content: '' }))), trust))
  } finally { await f.clean() }
})

test('fresh install is disabled; cancellation, denial and expired owner do not install; source changes cannot replace preview', async () => {
  const f = await fixture()
  try {
    assert.equal(await f.store.installSigned(f.path, async preview => { assert.equal(preview.adoption, false); return false }, current), null)
    assert.equal(await f.store.installSigned(f.path, yes, () => false), null)
    assert.deepEqual((await f.store.list()).plugins, [])
    let owner = true
    assert.equal(await f.store.installSigned(f.path, async () => { owner = false; return true }, () => owner), null)
    const installed = (await f.store.installSigned(f.path, async preview => {
      assert.equal(preview.publisher, trust[0].publisher); assert.equal(preview.id, id)
      await writeFile(f.path, 'changed after preview'); return true
    }, current))!.plugins[0]!
    assert.equal(installed.enabled, false)
    const url = `geppio://app/plugins/${id}/${installed.revision}/entry.js`
    assert.equal(f.store.asset(url), null)
    await f.store.setEnabled(id, true); assert.ok(f.store.asset(url))
    const restart = new PluginStore(f.managed, trust); assert.equal(restart.asset(url), null)
    assert.equal((await restart.list()).plugins[0]!.revision, installed.revision); assert.ok(restart.asset(url))
  } finally { await f.clean() }
})

for (const enabled of [false, true]) test(`alpha.33 folder adoption preserves UUID, enabled=${enabled}, exact confirmed API 2 data and restart`, async () => {
  const f = await fixture()
  try {
    const old = (await f.store.install(source)).plugins[0]!
    if (enabled) await f.store.setEnabled(id, true)
    // Confirm an ordinary document before adoption using the existing installation-bound broker.
    if (!enabled) await f.store.setEnabled(id, true)
    const token = await f.store.beginData(12, id, old.revision)
    const data = await f.store.dataOperation(12, token, 'write', 0, { schemaVersion: 1, value: { retained: 'confirmed', recovery: [1, 2] } })
    if (!enabled) await f.store.setEnabled(id, false)
    const dataPath = join(f.root, 'plugin-data', old.revision + '.json'), before = await readFile(dataPath)
    const adopted = (await f.store.installSigned(f.path, async preview => { assert.equal(preview.adoption, true); return true }, current))!.plugins[0]!
    assert.deepEqual(adopted, { ...old, enabled, source: 'signed' })
    assert.deepEqual(await readFile(dataPath), before)
    assert.ok((await readdir(join(f.managed, 'packages'))).includes(id), 'Legacy recovery bytes retained')
    const restarted = new PluginStore(f.managed, trust)
    assert.deepEqual((await restarted.list()).plugins[0], adopted)
    await restarted.setEnabled(id, true)
    const resumed = await restarted.beginData(12, id, old.revision)
    assert.deepEqual(await restarted.dataOperation(12, resumed, 'read'), data)
    await assert.rejects(restarted.beginData(12, id, '00000000-0000-0000-0000-000000000000'))
    await assert.rejects(restarted.dataOperation(13, resumed, 'read'))
    await restarted.setEnabled(id, false); await assert.rejects(restarted.dataOperation(12, resumed, 'read'))
    await restarted.setEnabled(id, true); const active = await restarted.beginData(12, id, old.revision)
    restarted.revokeOwner(12); await assert.rejects(restarted.dataOperation(12, active, 'read'))
    await restarted.remove(id)
    assert.deepEqual(await readdir(join(f.managed, 'signed')), [], 'Uninstall removes signed code artifacts, retaining only confirmed data')
    assert.deepEqual(await readFile(dataPath), before)
    const fresh = (await restarted.installSigned(f.path, yes, current))!.plugins[0]!
    assert.notEqual(fresh.revision, old.revision)
    await restarted.setEnabled(id, true); const freshToken = await restarted.beginData(12, id, fresh.revision)
    assert.equal((await restarted.dataOperation(12, freshToken, 'read')).document, null)
  } finally { await f.clean() }
})

test('conflicts and changes during confirmation preserve the actual legacy installation and state', async () => {
  const f = await fixture()
  try {
    await f.store.install(source)
    const statePath = join(f.managed, 'state.json'), previous = await readFile(statePath)
    const entry = join(f.managed, 'packages', id, 'entry.js'), original = await readFile(entry)
    await writeFile(entry, 'changed')
    await assert.rejects(f.store.installSigned(f.path, yes, current), /difere/)
    await writeFile(entry, original)
    await assert.rejects(f.store.installSigned(f.path, async () => { await writeFile(entry, 'changed during preview'); return true }, current), /difere/)
    assert.deepEqual(await readFile(statePath), previous)
    await writeFile(entry, original)
    await assert.rejects(f.store.installSigned(f.path, async () => { await writeFile(statePath, JSON.stringify({ schemaVersion: 1, plugins: {} })); return true }, current), /Estado mudou/)
    await writeFile(statePath, previous)
    await f.store.installSigned(f.path, yes, current)
    await assert.rejects(f.store.installSigned(f.path, yes, current), /conflitante/)
    await assert.rejects(f.store.install(source), /ID/)
  } finally { await f.clean() }
})

test('signed snapshot missing/tampered/substituted/revoked stays recoverable; no legacy fallback or first asset', async () => {
  const f = await fixture()
  try {
    const installed = (await f.store.install(source)).plugins[0]!
    await f.store.setEnabled(id, true)
    const dataToken = await f.store.beginData(1, id, installed.revision)
    const confirmed = await f.store.dataOperation(1, dataToken, 'write', 0, { schemaVersion: 1, value: { retained: 'before signed adoption' } })
    await f.store.installSigned(f.path, yes, current)
    const state = JSON.parse(await readFile(join(f.managed, 'state.json'), 'utf8')) as { plugins: Record<string, { signed: { snapshot: string; sha256?: string } }> }
    const artifact = join(f.managed, 'signed', state.plugins[id]!.signed.snapshot + '.gpp'), original = await readFile(artifact)
    const replacementFiles = new Map(f.pkg.files), replacementManifest = { ...f.pkg.manifest, version: '2.0.0' }
    replacementFiles.set('plugin.json', Buffer.from(JSON.stringify(replacementManifest)))
    const replacement = signPluginPackage({ manifest: replacementManifest, files: replacementFiles }, privateKey)
    assert.equal(verifyPluginPackage(replacement, trust).manifest.version, '2.0.0', 'Substitution has a valid same-publisher signature')
    const url = `geppio://app/plugins/${id}/${installed.revision}/entry.js`
    for (const failure of ['missing', 'tampered', 'substituted', 'revoked']) {
      await writeFile(artifact, original)
      if (failure === 'missing') await rm(artifact)
      if (failure === 'tampered') { const bytes = Buffer.from(original); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; await writeFile(artifact, bytes) }
      if (failure === 'substituted') await writeFile(artifact, replacement)
      const store = new PluginStore(f.managed, failure === 'revoked' ? [{ ...trust[0], revoked: true }] : trust)
      assert.equal(store.asset(url), null)
      assert.equal((await store.list()).plugins.length, 0); assert.equal(store.asset(url), null)
      await assert.rejects(store.setEnabled(id, true)); await assert.rejects(store.beginData(1, id, installed.revision))
    }
    await writeFile(artifact, original)
    const recovered = new PluginStore(f.managed, trust); assert.equal((await recovered.list()).plugins[0]!.revision, installed.revision); assert.ok(recovered.asset(url))
    assert.deepEqual(await recovered.dataOperation(1, await recovered.beginData(1, id, installed.revision), 'read'), confirmed)
    delete state.plugins[id]!.signed.sha256
    const statePath = join(f.managed, 'state.json'), invalidState = JSON.stringify(state)
    await writeFile(statePath, invalidState)
    const invalid = new PluginStore(f.managed, trust)
    await assert.rejects(invalid.list(), /preservados/); assert.equal(invalid.asset(url), null)
    assert.equal(await readFile(statePath, 'utf8'), invalidState)
  } finally { await f.clean() }
})

for (const phase of ['before', 'after', 'failure']) test(`state boundary ${phase} recovers an entire usable installation`, async () => {
  const f = await fixture()
  try {
    const installed = (await f.store.install(source)).plugins[0]!
    await f.store.setEnabled(id, true)
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/fixtures/plugin-package-interrupt.ts', f.managed, f.path, phase], { input: JSON.stringify(trust), encoding: 'utf8' })
    assert.equal(result.status, phase === 'before' ? 73 : phase === 'after' ? 74 : 75, result.stderr)
    const restarted = new PluginStore(f.managed, trust), actual = (await restarted.list()).plugins[0]!
    assert.deepEqual(actual, { ...installed, enabled: true, source: phase === 'after' ? 'signed' : 'legacy' })
    assert.ok(restarted.asset(`geppio://app/plugins/${id}/${actual.revision}/entry.js`))
    const state = JSON.parse(await readFile(join(f.managed, 'state.json'), 'utf8')) as { plugins: Record<string, { signed?: string }> }
    assert.equal(Boolean(state.plugins[id]!.signed), phase === 'after')
    if (phase === 'failure') assert.deepEqual(await readdir(join(f.managed, 'signed')), [])
  } finally { await f.clean() }
})

test('key tools enforce the actual checkout boundary when invoked from another cwd', async () => {
  const f = await fixture(), directory = resolve('.local', 'forbidden-key-' + Date.now()), fake = resolve('.local', 'not-a-private-key.txt')
  try {
    await writeFile(fake, 'Not key material; exclusion must happen before parsing')
    const key = spawnSync(process.execPath, ['--experimental-strip-types', resolve('tools/plugin-key.ts'), directory], { cwd: f.root, encoding: 'utf8' })
    assert.equal(key.status, 1); await assert.rejects(access(directory))
    const pack = spawnSync(process.execPath, ['--experimental-strip-types', resolve('tools/plugin-package.ts'), source, join(f.root, 'unexpected.gpp'), '--key-file', fake], { cwd: f.root, encoding: 'utf8' })
    assert.equal(pack.status, 1); assert.match(pack.stderr, /Packaging refused: private key must be outside checkout/); await assert.rejects(access(join(f.root, 'unexpected.gpp')))
  } finally { await rm(fake, { force: true }); await f.clean() }
})

test('regular-file guard rejects links; state-write failures preserve valid bytes and data', async () => {
  const f = await fixture()
  try {
    const link = join(f.root, 'link.gpp')
    // Windows junctions require no Developer Mode; a linked directory is never a file package.
    await symlink(f.root, link, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(readPackageSnapshot(link))
    await f.store.install(source)
    const state = join(f.managed, 'state.json'), previous = await readFile(state)
    await assert.rejects(f.store.installSigned(f.path, async () => { await rm(state); await mkdir(state); return true }, current))
    await rm(state, { recursive: true }); await writeFile(state, previous)
    assert.equal((await new PluginStore(f.managed, trust).list()).plugins.length, 1)
  } finally { await f.clean() }
})
