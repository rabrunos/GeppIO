import { randomUUID } from 'node:crypto'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { EXPLORER_LIMITS, safeExplorerName, validExplorerBasename } from '../shared/explorer.ts'
export { safeExplorerName } from '../shared/explorer.ts'
import type { ExplorerError, ExplorerNode, ExplorerResult } from '../shared/explorer.ts'

const messages: Record<ExplorerError, string> = {
  invalid: 'Solicitação do Explorador inválida.', stale: 'A pasta ou o item mudou. Atualize a árvore ou abra a pasta novamente.',
  busy: 'Aguarde a operação de arquivo em andamento.', unsupported: 'Pasta ou item não suportado: links e caminhos especiais não são permitidos.',
  limit: 'Limite do Explorador excedido (512 entradas, 32 níveis ou 4.096 nós). Escolha uma pasta menor.',
  unavailable: 'Não foi possível ler a pasta ou o item. Verifique as permissões e tente novamente.'
}
export class ExplorerFailure extends Error {
  readonly kind: ExplorerError
  constructor(kind: ExplorerError) { super(messages[kind]); this.kind = kind }
}
export class ExplorerDestinationExists extends Error {}
export function explorerFailure(error: unknown): ExplorerResult {
  const code = error instanceof ExplorerFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: messages[code] }
}
type Evidence = { path: string; chain: string; kind: 'directory' | 'file' }
type Node = Omit<Evidence, 'kind'> & { kind: ExplorerNode['kind']; display: ExplorerNode; depth: number }
/** Inspect every lexical ancestor, including those above the selected navigation root. */
export async function inspectExplorerPath(path: string, kind: Evidence['kind']): Promise<Evidence> {
  if (!isAbsolute(path) || resolve(path) !== path || path.length > 8192
    || process.platform === 'win32' && !/^[a-z]:\\/i.test(path)) throw new ExplorerFailure('unsupported')
  const chain: string[] = []
  for (let current = path; ; current = dirname(current)) {
    const volume = current === parse(current).root
    if (!volume && !safeExplorerName(basename(current))) throw new ExplorerFailure('unsupported')
    const stat = await lstat(current, { bigint: true })
    if (stat.isSymbolicLink() || (current === path && kind === 'file' ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())) throw new ExplorerFailure('unsupported')
    chain.push(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`)
    if (volume) break
  }
  const canonical = await realpath(path)
  if (process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path) throw new ExplorerFailure('unsupported')
  return { path, chain: chain.join('/'), kind }
}
export const orderExplorerNodes = (a: ExplorerNode, b: ExplorerNode): number =>
  Number(b.kind === 'directory') - Number(a.kind === 'directory') || compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name)
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** Per-window, memory-only grant. Native paths and identity chains stay in Main. */
export class DirectoryStore {
  private root: Node | null = null
  private nodes = new Map<string, Node>()
  private generation = 0
  get snapshot(): ExplorerNode | null { return this.root ? { ...this.root.display } : null }
  /** Remembering a path does not authorize it; restoration revalidates this witness. */
  get descriptor(): { path: string; chain: string } | null { return this.root ? { path: this.root.path, chain: this.root.chain } : null }
  guard(): () => boolean { const generation = this.generation; return () => generation === this.generation }
  revoke(): void { this.generation++; this.root = null; this.nodes.clear() }
  async select(path: string, current: () => boolean): Promise<ExplorerResult> {
    const evidence = await inspectExplorerPath(path, 'directory')
    if (!current()) throw new ExplorerFailure('stale')
    this.revoke()
    const display: ExplorerNode = { id: randomUUID(), name: basename(path) || 'Pasta', kind: 'directory' }
    this.root = { ...evidence, display, depth: 0 }; this.nodes.set(display.id, this.root)
    return { ok: true, root: this.snapshot }
  }
  private async target(root: string, id: string, current: () => boolean): Promise<Node> {
    const node = this.nodes.get(id), selected = this.root
    if (!selected || root !== selected.display.id || !node) throw new ExplorerFailure('stale')
    if (node.kind === 'blocked') throw new ExplorerFailure('unsupported')
    const inside = relative(selected.path, node.path)
    if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new ExplorerFailure('unsupported')
    const actual = await inspectExplorerPath(node.path, node.kind)
    if (!current() || selected !== this.root || this.nodes.get(id) !== node || actual.chain !== node.chain) throw new ExplorerFailure('stale')
    return node
  }
  async file(root: string, id: string, current: () => boolean): Promise<string> {
    const node = await this.target(root, id, current)
    if (node.kind !== 'file') throw new ExplorerFailure('unsupported')
    return node.path
  }
  /** Main-only reuse of the exact selected root; never a renderer path grant. */
  async folder(root: string, current: () => boolean): Promise<string> {
    return (await this.target(root, root, current)).path
  }
  /** Resolve one bounded write intent from existing navigation grants. The
   * callbacks recheck the same parent/source identities across native waits. */
  mutationTarget(root: string, id: string, operation: 'create-file' | 'create-directory' | 'rename-file', name: string, current: () => boolean) {
    const held = this.nodes.get(id)
    if (!current() || !this.root || this.root.display.id !== root || !held) throw new ExplorerFailure('stale')
    const components = relative(parse(held.path).root, held.path).split(sep).filter(Boolean)
    if (!validExplorerBasename(name) || !components.every(validExplorerBasename)) throw new ExplorerFailure('unsupported')
    const rename = operation === 'rename-file'
    if (held.kind !== (rename ? 'file' : 'directory')) throw new ExplorerFailure('unsupported')
    const parent = rename ? [...this.nodes.values()].find(node => node.path === dirname(held.path) && node.kind === 'directory' && held.chain.endsWith('/' + node.chain)) : held
    if (!parent || parent.depth >= EXPLORER_LIMITS.depth) throw new ExplorerFailure('limit')
    const destination = join(parent.path, name), kind = operation === 'create-directory' ? 'directory' : 'file'
    if (destination.length > 8192 || dirname(destination) !== parent.path) throw new ExplorerFailure('unsupported')
    const parentId = parent.display.id
    const verifyParent = async () => {
      if (!current() || await this.target(root, parentId, current) !== parent) throw new ExplorerFailure('stale')
    }
    const authorize = async () => {
      await verifyParent()
      const listing = await this.list(root, parentId, current)
      if (!current() || !listing.ok || !listing.children) throw new ExplorerFailure('stale')
      const children = listing.children
      if (children.some(entry => entry.name.toLowerCase() === name.toLowerCase())) throw new ExplorerDestinationExists()
      if (!rename && (children.length >= EXPLORER_LIMITS.entries || this.nodes.size >= EXPLORER_LIMITS.nodes)) throw new ExplorerFailure('limit')
      const proposed = [...children.filter(child => !rename || child.id !== id), { id: parentId, kind, name }]
      if (Buffer.byteLength(JSON.stringify(proposed)) > EXPLORER_LIMITS.bytes) throw new ExplorerFailure('limit')
      if (rename && await this.target(root, id, current) !== held) throw new ExplorerFailure('stale')
      await verifyParent()
    }
    return { parent: parent.path, parentChain: parent.chain, destination, source: rename ? { path: held.path, chain: held.chain } : null, authorize, verifyParent,
      registerFile: (chain: string) => {
        if (operation !== 'create-file' || !current() || this.nodes.get(parentId) !== parent || !chain.endsWith('/' + parent.chain)) return
        const known = [...this.nodes.values()].find(node => node.path === destination)
        if (known) return known.chain === chain && known.kind === 'file' ? known.display.id : undefined
        if (this.nodes.size >= EXPLORER_LIMITS.nodes) return
        const display: ExplorerNode = { id: randomUUID(), kind: 'file', name }
        this.nodes.set(display.id, { kind: 'file', path: destination, chain, depth: parent.depth + 1, display })
        return display.id
      } }
  }
  /** Main-only restoration through the same lazy nodes, budgets and file checks. */
  async resolveFile(root: string, names: readonly string[], current: () => boolean): Promise<string> {
    if (!names.length || names.length > EXPLORER_LIMITS.depth || !names.every(name => safeExplorerName(name) && name.toLowerCase() !== '.git')) throw new ExplorerFailure('invalid')
    let parent = root
    for (let i = 0; i < names.length; i++) {
      const result = await this.list(root, parent, current)
      if (!result.ok) throw new ExplorerFailure('unavailable')
      const exact = result.children?.find(node => node.name === names[i])
      const folded = process.platform === 'win32' ? result.children?.filter(node => node.name.toLowerCase() === names[i]!.toLowerCase()) : []
      const node = exact ?? (folded?.length === 1 ? folded[0] : undefined)
      if (!node || node.kind !== (i === names.length - 1 ? 'file' : 'directory')) throw new ExplorerFailure('stale')
      if (i === names.length - 1) return this.file(root, node.id, current)
      parent = node.id
    }
    throw new ExplorerFailure('stale')
  }
  release(root: string): ExplorerResult {
    if (!this.root || root !== this.root.display.id) throw new ExplorerFailure('stale')
    this.revoke(); return { ok: true, root: null }
  }
  async list(root: string, id: string, current: () => boolean): Promise<ExplorerResult> {
    const parent = await this.target(root, id, current)
    if (parent.kind !== 'directory') throw new ExplorerFailure('unsupported')
    if (parent.depth >= EXPLORER_LIMITS.depth) throw new ExplorerFailure('limit')
    const candidates: Node[] = [], children: ExplorerNode[] = []
    const directory = await opendir(parent.path, { bufferSize: 32 })
    for await (const entry of directory) {
      // Navigation exclusion only, before stat and visible-entry/node budgets.
      // Hide files/links too: linked worktree metadata is never a navigation grant.
      if (entry.name.toLowerCase() === '.git') continue
      if (children.length >= EXPLORER_LIMITS.entries) throw new ExplorerFailure('limit')
      if (!safeExplorerName(entry.name)) throw new ExplorerFailure('unsupported')
      const path = join(parent.path, entry.name)
      const stat = await lstat(path, { bigint: true })
      const kind = !stat.isSymbolicLink() && stat.isDirectory() ? 'directory' : !stat.isSymbolicLink() && stat.isFile() && stat.nlink === 1n ? 'file' : 'blocked'
      const display: ExplorerNode = { id: randomUUID(), name: entry.name, kind }
      children.push(display)
      // A child is inspected only on access; its identity and complete parent chain are frozen now.
      const chain = `${stat.dev}:${stat.ino}:${stat.birthtimeNs}/${parent.chain}`
      const old = [...this.nodes.values()].find(node => node.path === path && node.chain === chain && node.kind === kind)
      if (old) display.id = old.display.id
      candidates.push({ path, kind, chain, depth: parent.depth + 1, display })
    }
    await this.target(root, id, current)
    children.sort(orderExplorerNodes)
    if (Buffer.byteLength(JSON.stringify(children)) > EXPLORER_LIMITS.bytes) throw new ExplorerFailure('limit')
    const prefix = parent.path.endsWith(sep) ? parent.path : parent.path + sep
    const replaced = [...this.nodes.values()].filter(node => node !== parent && node.path.startsWith(prefix)
      && !candidates.some(candidate => node.path === candidate.path && node.chain === candidate.chain || candidate.kind === 'directory' && node.path.startsWith(candidate.path + sep) && node.chain.endsWith('/' + candidate.chain)))
    if (this.nodes.size - replaced.length + candidates.filter(node => !this.nodes.has(node.display.id)).length > EXPLORER_LIMITS.nodes) throw new ExplorerFailure('limit')
    for (const node of replaced) this.nodes.delete(node.display.id)
    for (const node of candidates) this.nodes.set(node.display.id, this.nodes.get(node.display.id) ?? node)
    return { ok: true, root: this.snapshot, children }
  }
}
