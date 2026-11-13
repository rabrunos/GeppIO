import { lstat, readdir, readFile, mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, extname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { PLUGIN_LIMITS, packagePath, pluginId, isRecord } from '../shared/plugins.ts'
import type { PluginInventory, InstalledPlugin } from '../shared/plugins.ts'
import { IDENTITY } from '../shared/identity.ts'
import { PluginDataStore } from './plugin-data.ts'
import { DATA_LIMITS, dataRevision, parseDataDocument } from '../shared/plugin-data.ts'
import type { DataSnapshot } from '../shared/plugin-data.ts'
import { readPackageSnapshot, validatePackageFiles, verifyPluginPackage } from './plugin-package.ts'
import type { Package } from './plugin-package.ts'
import { PLUGIN_TRUST } from './plugin-trust.ts'
import type { PluginTrustEntry } from './plugin-trust.ts'

interface SignedPointer { snapshot: string; sha256: string }
interface Preference { enabled: boolean; revision: string; signed?: SignedPointer }
interface State { schemaVersion: 1; plugins: Record<string, Preference> }
export interface SignedInstallPreview { publisher: string; name: string; id: string; version: string; adoption: boolean }
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
  return validatePackageFiles(files)
}
/** Only paths generated from validated IDs are ever written or removed. No renderer path argument. */
export class PluginStore {
  private state: State = { schemaVersion: 1, plugins: {} }
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private packages = new Map<string, Package>()
  private readonly root: string
  private readonly data: PluginDataStore
  private channels = new Map<string, { id: string; installation: string; owner: number; started: number; requests: number }>()
  private dataPending = 0
  private generations = new Map<number, number>()
  private readonly trust: readonly Readonly<PluginTrustEntry>[]
  constructor(root: string, trust: readonly Readonly<PluginTrustEntry>[] = PLUGIN_TRUST) { this.root = resolve(root); this.trust = trust; this.data = new PluginDataStore(join(this.root, '..', 'plugin-data')) }
  revokeOwner(owner: number): void { this.generations.set(owner, (this.generations.get(owner) ?? 0) + 1); for (const [token, channel] of this.channels) if (channel.owner === owner) this.channels.delete(token) }
  ownerGuard(owner: number): () => boolean { const generation = this.generations.get(owner) ?? 0; return () => (this.generations.get(owner) ?? 0) === generation }
  endData(owner: number, token: unknown): void {
    if (typeof token !== 'string' || this.channels.get(token)?.owner !== owner) throw new Error('Canal de dados inválido.')
    this.channels.delete(token)
  }
  beginData(owner: number, id: string, installation: string): Promise<string> {
    const generation = this.generations.get(owner) ?? 0
    return this.serial(async () => {
      await this.load()
      if ((this.generations.get(owner) ?? 0) !== generation) throw new Error('Documento de ativação expirado.')
      const item = this.state.plugins[id], pkg = this.packages.get(id)
      if (!pluginId(id) || !item?.enabled || item.revision !== installation || pkg?.manifest.apiVersion !== 2) throw new Error('Instalação não habilitada para dados v2.')
      for (const [token, channel] of this.channels) if (channel.owner === owner && channel.id === id) this.channels.delete(token)
      const token = randomUUID()
      this.channels.set(token, { id, installation, owner, started: Date.now(), requests: 0 }); return token
    })
  }
  private dataChannel(owner: number, token: unknown) {
    const channel = typeof token === 'string' ? this.channels.get(token) : undefined
    const item = channel ? this.state.plugins[channel.id] : undefined
    if (!channel || channel.owner !== owner || !item?.enabled || item.revision !== channel.installation || this.packages.get(channel.id)?.manifest.apiVersion !== 2) throw new Error('Ativação de dados expirada ou inválida.')
    return channel
  }
  dataOperation(owner: number, token: unknown, operation: 'read' | 'write', expectedRevision?: unknown, input?: unknown): Promise<DataSnapshot> {
    let document
    try {
      const channel = this.dataChannel(owner, token)
      if (Date.now() - channel.started >= 1000) { channel.started = Date.now(); channel.requests = 0 }
      if (++channel.requests > DATA_LIMITS.rate || this.dataPending >= DATA_LIMITS.queue) throw new Error('Limite de solicitações de dados atingido. Rascunho preservado.')
      if (operation === 'write') { if (!dataRevision(expectedRevision)) throw new Error('Revisão inválida.'); document = parseDataDocument(input) }
    } catch (error) { return Promise.reject(error) }
    this.dataPending++
    return this.serial(async () => {
      const channel = this.dataChannel(owner, token)
      if (operation === 'read') { const result = await this.data.read(channel.id, channel.installation); this.dataChannel(owner, token); return result }
      return this.data.write(channel.id, channel.installation, expectedRevision as number, document!, () => { this.dataChannel(owner, token) })
    }).finally(() => { this.dataPending-- })
  }
  private async directory(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Diretório de plugins inválido.')
  }
  private async load(): Promise<void> {
    await this.directory(this.root); await this.directory(join(this.root, 'packages')); await this.directory(join(this.root, 'signed'))
    if (this.loaded) return
    try {
      const path = join(this.root, 'state.json'), stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error('Estado de plugins inválido.')
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!isRecord(value) || value.schemaVersion !== 1 || Object.keys(value).length !== 2 || !isRecord(value.plugins) || Object.keys(value.plugins).length > PLUGIN_LIMITS.plugins) throw new Error('Estado de plugins inválido.')
      for (const [id, item] of Object.entries(value.plugins)) {
        if (!pluginId(id) || !isRecord(item) || Object.keys(item).some(key => !['enabled', 'revision', 'signed'].includes(key)) || typeof item.enabled !== 'boolean' || typeof item.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(item.revision) || (item.signed !== undefined && (!isRecord(item.signed) || Object.keys(item.signed).length !== 2 || typeof item.signed.snapshot !== 'string' || !/^[a-f0-9-]{36}$/.test(item.signed.snapshot) || typeof item.signed.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.signed.sha256)))) throw new Error('Estado de plugins inválido.')
      }
      this.state = value as unknown as State
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Estado de plugins ilegível. Os dados foram preservados; gerenciamento bloqueado.', { cause: error })
    }
    this.loaded = true
  }
  private async save(state: State, beforeCommit: () => void = () => undefined): Promise<void> {
    const temporary = join(this.root, 'state-' + randomUUID() + '.tmp')
    try { await writeFile(temporary, JSON.stringify(state), { flag: 'wx' }); beforeCommit(); await rename(temporary, join(this.root, 'state.json')); this.state = state }
    finally { await rm(temporary, { force: true }).catch(() => undefined) }
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
    for (const id of [...new Set([...names, ...Object.keys(this.state.plugins)])].sort()) {
      if (!pluginId(id)) { errors.push('Pasta de plugin com ID inválido.'); continue }
      try {
        const item = this.state.plugins[id]
        // Signed preferences never fall back to a legacy directory, including after corruption.
        let pkg: Package
        if (item?.signed) {
          const bytes = await readPackageSnapshot(join(this.root, 'signed', item.signed.snapshot + '.gpp'))
          if (createHash('sha256').update(bytes).digest('hex') !== item.signed.sha256) throw new Error('Pacote assinado difere do conteúdo confirmado. Dados preservados.')
          pkg = verifyPluginPackage(bytes, this.trust)
        } else pkg = await inspectPackage(join(this.root, 'packages', id))
        if (pkg.manifest.id !== id) throw new Error('ID do manifesto não corresponde à pasta instalada.')
        if (!item) { errors.push(id + ': pacote incompleto; reinstale pela interface.'); continue }
        plugins.push({ manifest: pkg.manifest, enabled: item.enabled, revision: item.revision }); snapshots.set(id, pkg)
      } catch (error) { errors.push(id + ': ' + (error instanceof Error && !('code' in error) ? error.message : 'Pacote ilegível ou inválido.')) }
    }
    this.packages = snapshots
    return { plugins, errors }
  }
  list(): Promise<PluginInventory> { return this.serial(() => this.inventory()) }
  /** Main-only transaction: callback confirms this immutable snapshot, never a renderer path/token. */
  installSigned(source: string, confirm: (preview: SignedInstallPreview) => Promise<boolean>, currentOwner: () => boolean): Promise<PluginInventory | null> {
    return this.serial(async () => {
      await this.load()
      const bytes = await readPackageSnapshot(source), pkg = verifyPluginPackage(bytes, this.trust), id = pkg.manifest.id
      const previous = this.state.plugins[id], names = await readdir(join(this.root, 'packages'))
      if (previous?.signed || (!previous && names.includes(id))) throw new Error('Já existe uma instalação conflitante com esse ID.')
      const equivalent = async () => {
        const legacy = await inspectPackage(join(this.root, 'packages', id))
        if (legacy.manifest.id !== id || legacy.files.size !== pkg.files.size || [...legacy.files].some(([path, value]) => !pkg.files.has(path) || !Buffer.from(value).equals(Buffer.from(pkg.files.get(path)!)))) throw new Error('A instalação existente difere do pacote assinado. Dados preservados.')
      }
      if (previous) await equivalent()
      else if (new Set([...names, ...Object.keys(this.state.plugins)]).size >= PLUGIN_LIMITS.plugins) throw new Error('Limite de 32 plugins atingido.')
      const stateBytes = await this.stateBytes()
      if (stateBytes === null ? Object.keys(this.state.plugins).length > 0 : JSON.stringify(JSON.parse(stateBytes)) !== JSON.stringify(this.state)) throw new Error('Estado externo mudou. Reinicie antes de instalar.')
      if (!currentOwner() || !await confirm({ publisher: pkg.publisher, name: pkg.manifest.name, id, version: pkg.manifest.version, adoption: Boolean(previous) }) || !currentOwner()) return null
      // Recheck actual legacy bytes and external state changes after the native confirmation.
      if (previous) await equivalent()
      else if ((await readdir(join(this.root, 'packages'))).includes(id)) throw new Error('Instalação mudou durante a confirmação.')
      if (await this.stateBytes() !== stateBytes) throw new Error('Estado mudou durante a confirmação. Dados preservados.')
      // Recheck current trust scope before persistence, as well as on every inventory/startup.
      verifyPluginPackage(bytes, this.trust)
      const signed = randomUUID(), snapshot = join(this.root, 'signed', signed + '.gpp'), staging = snapshot + '.tmp'
      let committed = false
      try {
        await writeFile(staging, bytes, { flag: 'wx' }); await rename(staging, snapshot)
        if (!currentOwner()) return null
        if (previous) await equivalent()
        if (await this.stateBytes() !== stateBytes) throw new Error('Estado mudou antes da instalação. Dados preservados.')
        await this.save({ ...this.state, plugins: { ...this.state.plugins, [id]: { ...(previous ?? { enabled: false, revision: randomUUID() }), signed: { snapshot: signed, sha256: createHash('sha256').update(bytes).digest('hex') } } } }, () => { if (!currentOwner()) throw new Error('Confirmação expirada.') })
        committed = true
      } finally {
        await rm(staging, { force: true }).catch(() => undefined)
        if (!committed) await rm(snapshot, { force: true }).catch(() => undefined)
      }
      return this.inventory()
    })
  }
  private async stateBytes(): Promise<string | null> {
    try {
      const path = join(this.root, 'state.json'), stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new Error('Estado de plugins inválido.')
      return await readFile(path, 'utf8')
    } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  }
  install(source: string): Promise<PluginInventory> {
    return this.serial(async () => {
      await this.load()
      const pkg = await inspectPackage(source), id = pkg.manifest.id
      const names = await readdir(join(this.root, 'packages'))
      if (this.state.plugins[id] || names.includes(id)) throw new Error('Já existe um plugin com esse ID.')
      if (new Set([...names, ...Object.keys(this.state.plugins)]).size >= PLUGIN_LIMITS.plugins) throw new Error('Limite de 32 plugins atingido.')
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
      if (!enabled) for (const [token, channel] of this.channels) if (channel.id === id) this.channels.delete(token)
      return this.inventory()
    })
  }
  remove(id: string): Promise<PluginInventory> {
    return this.serial(async () => {
      await this.load()
      if (!pluginId(id)) throw new Error('ID de plugin inválido.')
      const signed = this.state.plugins[id]?.signed
      const destination = join(this.root, 'packages', id), tombstone = join(this.root, 'remove-' + randomUUID())
      let moved = false
      try { await rename(destination, tombstone); moved = true }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Não foi possível remover o pacote.', { cause: error }) }
      const plugins = { ...this.state.plugins }; delete plugins[id]
      try { await this.save({ ...this.state, plugins }) }
      catch (error) { if (moved) await rename(tombstone, destination); throw error }
      this.packages.delete(id)
      for (const [token, channel] of this.channels) if (channel.id === id) this.channels.delete(token)
      if (moved) await rm(tombstone, { recursive: true, force: true }).catch(() => undefined)
      if (signed) await rm(join(this.root, 'signed', signed.snapshot + '.gpp'), { force: true }).catch(() => undefined)
      return this.inventory()
    })
  }
  /** Serve only immutable inspected JS snapshots of enabled installations, never arbitrary files. */
  asset(source: string): Uint8Array | null {
    try {
      if (source.includes('%') || source.includes('/../') || source.includes('/./') || source.includes('\\')) return null
      const url = new URL(source)
      if (url.protocol !== IDENTITY.protocol + ':' || url.host !== IDENTITY.host || url.username || url.password || url.search || url.hash) return null
      const match = /^\/plugins\/([^/]+)\/([^/]+)\/(.+)$/.exec(decodeURIComponent(url.pathname))
      if (!match) return null
      const [, id = '', revision, path = ''] = match, item = this.state.plugins[id]
      if (!pluginId(id) || !packagePath(path) || !path.endsWith('.js') || !item?.enabled || item.revision !== revision) return null
      return this.packages.get(id)?.files.get(path) ?? null
    } catch { return null }
  }
}
