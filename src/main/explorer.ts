import { randomUUID } from 'node:crypto'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { EXPLORER_LIMITS } from '../shared/explorer.ts'
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
export function explorerFailure(error: unknown): ExplorerResult {
  const code = error instanceof ExplorerFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: messages[code] }
}
export function safeExplorerName(name: string): boolean {
  return !!name && name.length <= EXPLORER_LIMITS.name && ![...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && !/[/\\:<>"|?*\ud800-\udfff]/u.test(name)
    && !/[. ]$/.test(name) && !/^(\.|\.\.|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) && !/~\d/.test(name)
}
type Evidence = { path: string; chain: string; kind: 'directory' | 'file' }
type Node = Omit<Evidence, 'kind'> & { kind: ExplorerNode['kind']; display: ExplorerNode; depth: number }
/** Inspect every lexical ancestor, including those above the selected navigation root. */
async function inspect(path: string, kind: Evidence['kind']): Promise<Evidence> {
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

/** Per-window, memory-only grant. No renderer path, recursive scan, watcher or write operation. */
export class DirectoryStore {
  private root: Node | null = null
  private nodes = new Map<string, Node>()
  private generation = 0
  get snapshot(): ExplorerNode | null { return this.root ? { ...this.root.display } : null }
  guard(): () => boolean { const generation = this.generation; return () => generation === this.generation }
  revoke(): void { this.generation++; this.root = null; this.nodes.clear() }
  async select(path: string, current: () => boolean): Promise<ExplorerResult> {
    const evidence = await inspect(path, 'directory')
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
    const actual = await inspect(node.path, node.kind)
    if (!current() || selected !== this.root || this.nodes.get(id) !== node || actual.chain !== node.chain) throw new ExplorerFailure('stale')
    return node
  }
  async file(root: string, id: string, current: () => boolean): Promise<string> {
    const node = await this.target(root, id, current)
    if (node.kind !== 'file') throw new ExplorerFailure('unsupported')
    return node.path
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
