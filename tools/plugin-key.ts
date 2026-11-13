import { generateKeyPairSync, createHash } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Owner-run setup only. Never invoked by the app, build, tests or CI.
async function main(): Promise<void> {
  const [directory, ...extra] = process.argv.slice(2)
  if (!directory || extra.length || !isAbsolute(directory)) throw new Error('An absolute external directory is required')
  const checkout = await realpath(fileURLToPath(new URL('../', import.meta.url))), destination = resolve(directory), rel = relative(checkout, destination)
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../')) throw new Error('Key directory must be outside the checkout')
  // New directory only. An existing parent junction must not resolve into the checkout.
  const parent = await realpath(join(destination, '..')), actual = resolve(parent, relative(join(destination, '..'), destination)), actualRel = relative(checkout, actual)
  if (!isAbsolute(actualRel) && actualRel !== '..' && !actualRel.startsWith('..\\') && !actualRel.startsWith('../')) throw new Error('Key directory resolves inside checkout')
  await mkdir(destination, { mode: 0o700 })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const secret = privateKey.export({ type: 'pkcs8', format: 'pem' })
  await writeFile(join(destination, 'workspace-essentials-private.pem'), secret, { flag: 'wx', mode: 0o600 })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  await writeFile(join(destination, 'workspace-essentials-public.pem'), publicPem, { flag: 'wx' })
  console.log(publicPem.toString().trim())
  console.log('SHA-256 (SPKI DER): ' + createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex'))
}
main().catch(() => { console.error('Key generation failed. Use a new directory outside the checkout with an existing owner-controlled parent.'); process.exitCode = 1 })
