import { createPrivateKey, createPublicKey, createHash, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import { lstat, realpath, readFile, writeFile } from 'node:fs/promises'
import { relative, isAbsolute, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { inspectPackage } from '../src/main/plugins.ts'
import type { Package } from '../src/main/plugin-package.ts'
import { PACKAGE_DOMAIN, PACKAGE_MAGIC, PACKAGE_LIMITS, validatePackageFiles, verifyPluginPackage } from '../src/main/plugin-package.ts'

export function publicIdentity(key: KeyObject): { publicKey: string; keyId: string } {
  const publicKey = createPublicKey(key)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required')
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), keyId: createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex') }
}
/** Deterministic offline envelope. There is no timestamp, compression or external dependency. */
export function signPluginPackage(pkg: Package, key: KeyObject): Buffer {
  validatePackageFiles(pkg.files)
  const identity = publicIdentity(key)
  const metadata = Buffer.from(JSON.stringify({ keyId: identity.keyId, pluginId: pkg.manifest.id }))
  const payload = Buffer.from(JSON.stringify([...pkg.files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, type: 'file', content: Buffer.from(bytes).toString('base64') }))))
  const header = Buffer.alloc(20)
  PACKAGE_MAGIC.copy(header); header.writeUInt32BE(1, 8); header.writeUInt32BE(metadata.length, 12); header.writeUInt32BE(payload.length, 16)
  const body = Buffer.concat([header, metadata, payload]), bytes = Buffer.concat([body, sign(null, Buffer.concat([PACKAGE_DOMAIN, body]), key)])
  if (bytes.length > PACKAGE_LIMITS.bytes) throw new Error('Package exceeds 3 MiB')
  if (pkg.manifest.id !== 'geppio.workspace-essentials') throw new Error('Only Workspace Essentials is in this pilot')
  verifyPluginPackage(bytes, [{ ...identity, pluginId: pkg.manifest.id, publisher: 'Local packaging self-check', revoked: false }])
  return bytes
}
async function main(): Promise<void> {
  const [source, output, flag, keyFile, ...extra] = process.argv.slice(2)
  if (!source || !output || flag !== '--key-file' || !keyFile || extra.length) throw new Error('Usage: pnpm plugins:package <built-folder> <output.gpp> --key-file <private-key-outside-checkout>')
  // CLI arguments contain a path only. Never accept private key bytes as an argument/environment value.
  const keyPath = await realpath(keyFile), checkout = await realpath(fileURLToPath(new URL('../', import.meta.url))), rel = relative(checkout, keyPath)
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../')) throw new Error('Private key must be outside the checkout')
  const stat = await lstat(keyFile)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error('Invalid private key input')
  const secret = await readFile(keyPath)
  try {
    const key = createPrivateKey(secret), pkg = await inspectPackage(resolve(source)), bytes = signPluginPackage(pkg, key)
    await writeFile(resolve(output), bytes, { flag: 'wx' })
    console.log(`Signed ${pkg.manifest.id} ${pkg.manifest.version}; public fingerprint SHA-256 ${publicIdentity(key).keyId}`)
  } finally { secret.fill(0) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error && error.message === 'Private key must be outside the checkout' ? 'Packaging refused: private key must be outside checkout.' : 'Packaging failed. Check arguments, external Ed25519 key, package and unused output path. No private material was logged.'); process.exitCode = 1 })
}
