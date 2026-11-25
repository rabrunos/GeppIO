import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectPackage, PluginStore } from '../src/geppio/src/main/plugins.ts'
import { verifyPluginPackage } from '../src/geppio/src/main/plugin-package.ts'
import { publicIdentity, signPluginPackage } from '../tools/plugin-package.ts'
test('authorized signed HTML/CSS/TS survives copying; disabled compatible replacement keeps installation, revokes old bytes and grants', async () => {
  const root = await mkdtemp(join(tmpdir(),'geppio-smoke-signed-surface-'))
  try {
    const pkg = await inspectPackage('examples/standalone/plugins/board'), id = pkg.manifest.id
    const {privateKey} = generateKeyPairSync('ed25519'), trust = [{ ...publicIdentity(privateKey), pluginId:id, publisher:'Test', revoked:false }]
    const bytes = signPluginPackage(pkg,privateKey), copy = Buffer.from(bytes)
    assert.deepEqual(verifyPluginPackage(copy,trust).prepared,pkg.prepared)
    assert.throws(()=>verifyPluginPackage(copy))
    const bad = Buffer.from(bytes); bad[bad.length-1] = bad[bad.length-1]! ^ 1
    assert.throws(()=>verifyPluginPackage(bad,trust))
    const store = new PluginStore(join(root,'store'),trust), file = join(root,'local.gpp'), yes = async()=>true, current=()=>true
    await writeFile(file,copy)
    const before = (await store.installSigned(file,yes,current))!.plugins[0]!
    await store.setEnabled(id,true)
    const original = 'geppio-surface://' + before.generation + '/' + id + '/index.html'
    assert.ok(store.surface(original)); assert.equal(store.asset('geppio://app/plugins/'+id+'/'+before.generation+'/entry.js'),null)
    await assert.rejects(store.installSigned(file,yes,current))
    await store.setEnabled(id,false)
    pkg.files.set('panel.html',Buffer.from('<h2>Atualizado</h2>'))
    await writeFile(file,signPluginPackage(pkg,privateKey))
    const after = (await store.installSigned(file,yes,current))!.plugins[0]!
    assert.equal(after.revision,before.revision); assert.equal(after.enabled,false); assert.notEqual(after.generation,before.generation)
    await store.setEnabled(id,true); assert.equal(store.surface(original),null)
    assert.match(store.surface(original.replace(before.generation!,after.generation!))!.html,/Atualizado/)
  } finally { await rm(root,{recursive:true,force:true}) }
})
