import { lstat, readdir, readFile, mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PLUGIN_LIMITS, parseManifest, packagePath, pluginId, isRecord } from '../shared/plugins.ts'
import type { PluginInventory, PluginManifest, InstalledPlugin } from '../shared/plugins.ts'

interface Package { manifest: PluginManifest; files: Map<string, Uint8Array> }
interface State { schemaVersion: 1; plugins: Record<string, { enabled: boolean; revision: string }> }
/** Local trusted packages only. Inspect the complete bounded snapshot before copying/exposing it. */
export async function inspectPackage(root: string): Promise<Package> {
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('Escolha uma pasta de plugin regular.')
  const canonical = await realpath(root), files = new Map<string, Uint8Array>()
  let total = 0, entries = 0
  async function walk(dir: string, prefix = '', depth = 0): Promise<void> {
    if (depth > 8) throw new Error('Pacote com pastas demais.')
    const children = await readdir(dir)
    if (children.length > PLUGIN_LIMITS.files) throw new Error('Pacote com arquivos demais.')
    for (const name of children.sort()) {
      if (++entries > PLUGIN_LIMITS.files) throw new Error('Pacote com arquivos demais.')
      const path = prefix + name, source = join(dir, name), stat = await lstat(source)
      const rel = relative(canonical, await realpath(source))
      if (!packagePath(path) || stat.isSymbolicLink() || !rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Caminho ou link não permitido no pacote.')
      if (stat.isDirectory()) { await walk(source, path + '/', depth + 1); continue }
      if (!stat.isFile() || !['.js', '.json'].includes(extname(name)) || stat.size > PLUGIN_LIMITS.fileBytes) throw new Error('Tipo ou tamanho de arquivo não permitido.')
      total += stat.size
      if (total > PLUGIN_LIMITS.packageBytes) throw new Error('Pacote maior que 2 MiB.')
      const bytes = await readFile(source)
      if (bytes.length !== stat.size) throw new Error('Pacote mudou durante a leitura. Tente novamente.')
      files.set(path, bytes)
    }
  }
  await walk(canonical)
  const manifestBytes = files.get('plugin.json')
  if (!manifestBytes) throw new Error('plugin.json não encontrado.')
  const manifest = parseManifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
  if (!files.has(manifest.entry)) throw new Error('Módulo de entrada não encontrado.')
  return { manifest, files }
}
/** Only paths generated from validated IDs are ever written or removed. No renderer path argument. */
export class PluginStore {
  private state: State = { schemaVersion: 1, plugins: {} }
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private packages = new Map<string, Package>()
  private readonly root: string
  constructor(root: string) { this.root = resolve(root) }
  private async directory(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Diretório de plugins inválido.')
  }
  private async load(): Promise<void> {
    await this.directory(this.root); await this.directory(join(this.root, 'packages'))
    if (this.loaded) return
    try {
      const path = join(this.root, 'state.json'), stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error('Estado de plugins inválido.')
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!isRecord(value) || value.schemaVersion !== 1 || Object.keys(value).length !== 2 || !isRecord(value.plugins) || Object.keys(value.plugins).length > PLUGIN_LIMITS.plugins) throw new Error('Estado de plugins inválido.')
      for (const [id, item] of Object.entries(value.plugins)) {
        if (!pluginId(id) || !isRecord(item) || Object.keys(item).length !== 2 || typeof item.enabled !== 'boolean' || typeof item.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(item.revision)) throw new Error('Estado de plugins inválido.')
      }
      this.state = value as unknown as State
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Estado de plugins ilegível. Os dados foram preservados; gerenciamento bloqueado.', { cause: error })
    }
    this.loaded = true
  }
  private async save(state: State): Promise<void> {
    const temporary = join(this.root, 'state-' + randomUUID() + '.tmp')
    try { await writeFile(temporary, JSON.stringify(state), { flag: 'wx' }); await rename(temporary, join(this.root, 'state.json')); this.state = state }
    finally { await rm(temporary, { force: true }) }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => undefined)
    return pending
  }
  private async inventory(): Promise<PluginInventory> {
    await this.load()
    const plugins: InstalledPlugin[] = [], errors: string[] = [], snapshots = new Map<string, Package>()
    const names = await readdir(join(this.root, 'packages'))
    if (names.length > PLUGIN_LIMITS.plugins) throw new Error('Diretório com plugins demais.')
    for (const id of names.sort()) {
      if (!pluginId(id)) { errors.push('Pasta de plugin com ID inválido.'); continue }
      try {
        const pkg = await inspectPackage(join(this.root, 'packages', id))
        if (pkg.manifest.id !== id) throw new Error('ID do manifesto não corresponde à pasta instalada.')
        const item = this.state.plugins[id]
        if (!item) { errors.push(id + ': pacote incompleto; reinstale pela interface.'); continue }
        plugins.push({ manifest: pkg.manifest, ...item }); snapshots.set(id, pkg)
      } catch (error) { errors.push(id + ': ' + (error instanceof Error && !('code' in error) ? error.message : 'Pacote ilegível ou inválido.')) }
    }
    for (const id of Object.keys(this.state.plugins)) if (!names.includes(id)) errors.push(id + ': pacote instalado ausente.')
    this.packages = snapshots
    return { plugins, errors }
  }
  list(): Promise<PluginInventory> { return this.serial(() => this.inventory()) }
  install(source: string): Promise<PluginInventory> {
    return this.serial(async () => {
      await this.load()
      const pkg = await inspectPackage(source), id = pkg.manifest.id
      const names = await readdir(join(this.root, 'packages'))
      if (this.state.plugins[id] || names.includes(id)) throw new Error('Já existe um plugin com esse ID.')
      if (Math.max(names.length, Object.keys(this.state.plugins).length) >= PLUGIN_LIMITS.plugins) throw new Error('Limite de 32 plugins atingido.')
      const staging = join(this.root, 'install-' + randomUUID()), destination = join(this.root, 'packages', id)
      await mkdir(staging)
      let moved = false
      try {
        for (const [path, bytes] of pkg.files) { const target = resolve(staging, path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' }) }
        await rename(staging, destination); moved = true
        await this.save({ ...this.state, plugins: { ...this.state.plugins, [id]: { enabled: false, revision: randomUUID() } } })
      } catch (error) { if (moved) await rm(destination, { recursive: true, force: true }); throw error }
      finally { await rm(staging, { recursive: true, force: true }) }
      return this.inventory()
    })
  }
  setEnabled(id: string, enabled: boolean): Promise<PluginInventory> {
    return this.serial(async () => {
      await this.load()
      if (!pluginId(id) || typeof enabled !== 'boolean' || !this.state.plugins[id]) throw new Error('Plugin ou operação inválida.')
      if (enabled) { const inventory = await this.inventory(); if (!inventory.plugins.some(item => item.manifest.id === id)) throw new Error('Pacote inválido; não pode ser ativado.') }
      await this.save({ ...this.state, plugins: { ...this.state.plugins, [id]: { ...this.state.plugins[id], enabled } } })
      return this.inventory()
    })
  }
  remove(id: string): Promise<PluginInventory> {
    return this.serial(async () => {
      await this.load()
      if (!pluginId(id)) throw new Error('ID de plugin inválido.')
      const destination = join(this.root, 'packages', id), tombstone = join(this.root, 'remove-' + randomUUID())
      let moved = false
      try { await rename(destination, tombstone); moved = true }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Não foi possível remover o pacote.', { cause: error }) }
      const plugins = { ...this.state.plugins }; delete plugins[id]
      try { await this.save({ ...this.state, plugins }) }
      catch (error) { if (moved) await rename(tombstone, destination); throw error }
      this.packages.delete(id)
      if (moved) await rm(tombstone, { recursive: true, force: true })
      return this.inventory()
    })
  }
  /** Serve only immutable inspected JS snapshots of enabled installations, never arbitrary files. */
  asset(source: string): Uint8Array | null {
    try {
      if (source.includes('%') || source.includes('/../') || source.includes('/./') || source.includes('\\')) return null
      const url = new URL(source)
      if (url.protocol !== 'semnome:' || url.host !== 'app' || url.username || url.password || url.search || url.hash) return null
      const match = /^\/plugins\/([^/]+)\/([^/]+)\/(.+)$/.exec(decodeURIComponent(url.pathname))
      if (!match) return null
      const [, id = '', revision, path = ''] = match, item = this.state.plugins[id]
      if (!pluginId(id) || !packagePath(path) || !path.endsWith('.js') || !item?.enabled || item.revision !== revision) return null
      return this.packages.get(id)?.files.get(path) ?? null
    } catch { return null }
  }
}
