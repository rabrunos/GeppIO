import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve, dirname, relative, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

export const LEGACY_IDENTITY = Object.freeze({ directory: 'semnome', protocol: 'semnome', layoutStorageKey: 'semnome:layout:v1' })
export const BACKUP_DIRECTORY = 'identity-backup-v1'
const LIMITS = { entries: 10000, bytes: 128 * 1024 * 1024, depth: 16 }
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }
function exists(path: string): boolean {
  try { lstatSync(path); return true } catch (error) { if (missing(error)) return false; throw error }
}
function directory(path: string): void {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Profile migration requires regular directories.')
}
export function validatedTestProfile(value: string, temporaryRoot = tmpdir()): string {
  const candidate = resolve(value), rel = relative(temporaryRoot, candidate)
  if (!isAbsolute(value) || !rel || rel.startsWith('..') || isAbsolute(rel) || !/^geppio-smoke-[\w-]+$/.test(rel.split(/[\\/]/)[0]!)) throw new Error('Invalid test data directory')
  directory(candidate)
  const canonical = relative(realpathSync(temporaryRoot), realpathSync(candidate))
  if (canonical.toLowerCase() !== rel.toLowerCase()) throw new Error('Linked test data directory is not allowed')
  return candidate
}
/** Bounded snapshot; never follows links or edits Chromium/serialized identity bytes. */
export function snapshotTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  if (!exists(root)) return files
  directory(root)
  let entries = 0, bytes = 0
  function walk(path: string, prefix = '', depth = 0): void {
    if (depth > LIMITS.depth) throw new Error('Profile migration depth limit exceeded.')
    const names = readdirSync(path).sort()
    if (names.length > LIMITS.entries) throw new Error('Profile migration entry limit exceeded.')
    for (const name of names) {
      if (++entries > LIMITS.entries) throw new Error('Profile migration entry limit exceeded.')
      const source = join(path, name), stat = lstatSync(source), key = prefix + name
      if (stat.isSymbolicLink()) throw new Error('Profile migration refuses symbolic links.')
      if (stat.isDirectory()) { walk(source, key + '/', depth + 1); continue }
      if (!stat.isFile() || (bytes += stat.size) > LIMITS.bytes) throw new Error('Profile migration size/type limit exceeded.')
      const data = readFileSync(source)
      if (data.length !== stat.size) throw new Error('Profile changed during migration. Close the old app and retry.')
      files.set(key, data)
    }
  }
  walk(root)
  return files
}
function digest(files: Map<string, Buffer>): string {
  const hash = createHash('sha256')
  for (const [key, value] of files) hash.update(JSON.stringify([key, value.length])).update(value)
  return hash.digest('hex')
}
export function writeSnapshot(root: string, files: Map<string, Buffer>): void {
  mkdirSync(root, { recursive: true })
  for (const [name, bytes] of files) {
    const target = resolve(root, name), rel = relative(root, target)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid snapshot path.')
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' })
  }
}
/** Called before Electron readiness/session creation. Existing destinations are never merged. */
export function prepareProfile(legacy: string, destination: string): 'existing' | 'fresh' | 'copied' {
  if (resolve(legacy) === resolve(destination)) throw new Error('Identity profiles must be separate.')
  directory(dirname(destination))
  if (exists(destination)) { directory(destination); return 'existing' }
  if (!exists(legacy)) { mkdirSync(destination); return 'fresh' }
  directory(legacy)
  const plugins = snapshotTree(join(legacy, 'plugins')), storage = snapshotTree(join(legacy, 'Local Storage'))
  const staging = join(dirname(destination), '.geppio-migration-' + randomUUID())
  mkdirSync(staging)
  try {
    writeSnapshot(join(staging, 'plugins'), plugins)
    writeSnapshot(join(staging, BACKUP_DIRECTORY, 'Local Storage'), storage)
    // Loopback drafts keep their origin. Production drafts are transferred with Chromium below.
    writeSnapshot(join(staging, 'Local Storage'), storage)
    if (digest(plugins) !== digest(snapshotTree(join(legacy, 'plugins'))) || digest(storage) !== digest(snapshotTree(join(legacy, 'Local Storage')))) throw new Error('Profile changed during migration. Close the old app and retry.')
    if (exists(destination)) throw new Error('Destination appeared during migration; preserved without merging.')
    renameSync(staging, destination)
    return 'copied'
  } finally { rmSync(staging, { recursive: true, force: true }) }
}
/** A disposable derived session; the backup and original profile remain untouched. */
export function recoveryProfile(profile: string): string | null {
  const backup = join(profile, BACKUP_DIRECTORY)
  if (!exists(backup)) return null
  directory(backup)
  const target = join(profile, 'identity-recovery-v1')
  if (exists(target)) { directory(target); return target }
  const files = snapshotTree(join(backup, 'Local Storage'))
  const staging = join(profile, '.geppio-recovery-' + randomUUID())
  try { writeSnapshot(join(staging, 'Local Storage'), files); renameSync(staging, target) }
  finally { rmSync(staging, { recursive: true, force: true }) }
  return target
}
