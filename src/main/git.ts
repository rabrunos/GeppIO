import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, opendir, readlink, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DirectoryStore, ExplorerFailure, inspectExplorerPath, safeExplorerName } from './explorer.ts'
import { GIT_LIMITS } from '../shared/git.ts'
import type { GitChange, GitError, GitResult, GitStatus } from '../shared/git.ts'

const messages: Record<GitError, string> = {
  'not-repository': 'A pasta selecionada não contém .git. Selecione a raiz exata do repositório; pastas internas não são descobertas automaticamente.',
  version: 'Versão do Git não suportada. Este piloto requer Git para Windows 2.40 ou superior na instalação padrão.',
  uncertain: 'O Git pode ter alterado o índice antes da interrupção. Atualize para conferir; a operação não será repetida nem desfeita automaticamente.',
  invalid: 'Solicitação Git inválida.', stale: 'A pasta ou a consulta Git mudou. Atualize ou selecione a pasta novamente.',
  busy: 'Aguarde a consulta Git em andamento.', unsupported: 'Operação Git não suportada para este formato ou arquivo. O status pode continuar disponível quando uma ação individual é recusada.',
  limit: 'Limite Git excedido: 512 alterações, 256 KiB por texto, 64 MiB de metadados ou 20.000 entradas. Escolha um repositório menor.',
  unavailable: 'Não foi possível consultar o Git. Atualize e tente novamente.', missing: 'Git para Windows não encontrado na instalação padrão em Arquivos de Programas.', timeout: 'A consulta Git excedeu 15 segundos. Tente um repositório menor.'
}
/** Main-only categories. Never contain filenames, configuration values or native paths. */
export type GitFailureReason = 'layout' | 'metadata' | 'configuration' | 'index' | 'worktree-redirect' | 'worktree-special' | 'worktree-rules' | 'worktree-budget'
const reasons: Partial<Record<GitFailureReason, string>> = {
  layout: 'Formato de repositório não suportado: selecione uma raiz local com diretório .git próprio, sem worktree vinculado, repositório aninhado ou histórico raso.',
  metadata: 'Metadados Git recusados: link, redirecionamento de objetos, arquivo especial ou estrutura incompatível. Nenhum reparo automático foi feito.',
  configuration: 'Configuração Git não suportada: filtros, extensões ou redirecionamentos nativos exigem outro escopo seguro. Nenhum programa do projeto foi executado.',
  index: 'Formato ou caminho do índice Git não suportado para esta consulta.',
  'worktree-redirect': 'Um caminho visível redireciona a árvore de trabalho ou tem tipo de link que não pode ser confirmado com segurança. Dependências não rastreadas e ignoradas não são percorridas.',
  'worktree-special': 'A árvore de trabalho visível contém um arquivo ou nome não suportado. Entradas ignoradas não são abertas.',
  'worktree-rules': 'As regras locais de ignore/atributos não puderam ser confirmadas com segurança. Confira links, tamanho ou alterações simultâneas nesses arquivos.'
}
export class GitFailure extends Error {
  readonly kind: GitError
  readonly reason?: GitFailureReason
  constructor(kind: GitError, reason?: GitFailureReason) { super(messages[kind]); this.kind = kind; this.reason = reason }
}
export function gitFailure(error: unknown): GitResult {
  const code = error instanceof GitFailure || error instanceof ExplorerFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: code === 'unsupported' && error instanceof GitFailure && error.reason ? reasons[error.reason] ?? messages[code] : messages[code] }
}
const decode = (bytes: Buffer) => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new GitFailure('unsupported') } }
export function gitRelativeName(name: string): boolean {
  return name.length <= 2048 && name.split('/').length <= 32 && name.split('/').every(part => safeExplorerName(part) && part.toLowerCase() !== '.git')
}
/** NUL records preserve spaces/Unicode and rename ordering; unsupported names fail closed. */
export function parseGitStatus(bytes: Buffer): GitChange[] {
  const records = decode(bytes).split('\0'), changes: GitChange[] = []
  if (records.pop() !== '') throw new GitFailure('unsupported')
  for (let i = 0; i < records.length; i++) {
    const row = records[i]!, index = row[0]!, working = row[1]!, name = row.slice(3)
    if (!/^[ MADRCUT?!]{2} /.test(row) || !gitRelativeName(name)) throw new GitFailure('unsupported')
    const previous = /[RC]/.test(index + working) ? records[++i] : undefined
    if (previous !== undefined && !gitRelativeName(previous) || /[RC]/.test(index + working) && !previous) throw new GitFailure('unsupported')
    changes.push({ id: randomUUID(), name, ...(previous ? { previous } : {}), index, working, conflict: index === 'U' || working === 'U' || ['AA', 'DD'].includes(index + working), untracked: index + working === '??' })
    if (changes.length > GIT_LIMITS.entries) throw new GitFailure('limit')
  }
  return changes
}
export async function resolveGitExecutable(): Promise<string> {
  if (process.platform !== 'win32') throw new GitFailure('missing')
  // Fixed machine installation, never PATH, cwd, a renderer value or a repository executable.
  const path = join(process.env.ProgramW6432 ?? process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe')
  try {
    await inspectExplorerPath(dirname(path), 'directory')
    const stat = await lstat(path)
    // Git for Windows uses hardlinks between its installed launchers. This exception is
    // solely for the fixed installed executable, never selected repository data.
    if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase()) throw new GitFailure('missing')
    return path
  } catch { throw new GitFailure('missing') }
}
export function gitEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: 'NUL', GIT_CONFIG_GLOBAL: 'NUL', GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C', LANG: 'C' }
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
  return env
}
/** No shell, renderer-supplied stdin, inherited Git/Node/loader/config environment, stderr disclosure or generic bridge. */
export function runGit(executable: string, args: readonly string[], home: string, signal: AbortSignal, cap: number = GIT_LIMITS.output, timeout: number = GIT_LIMITS.timeout, io?: { input: Buffer; index?: string; objects?: string; ignoreQuery?: true }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new GitFailure('stale')); return }
    const ignoreQuery = io?.ignoreQuery === true
    if (ignoreQuery && (args.slice(-4).join('\0') !== 'check-ignore\0--no-index\0--stdin\0-z' || io.index || io.objects || io.input.length > GIT_LIMITS.output)) { reject(new GitFailure('invalid')); return }
    const env = gitEnvironment(home)
    // check-ignore consumes literal pathname records, not pathspecs. Git rejects
    // GIT_LITERAL_PATHSPECS for this command. Other commands retain it unchanged.
    if (ignoreQuery) delete env.GIT_LITERAL_PATHSPECS
    // Main-only, validated destinations. Never an environment/argument IPC surface.
    if (io?.index) env.GIT_INDEX_FILE = io.index
    if (io?.objects) env.GIT_OBJECT_DIRECTORY = io.objects
    const child = spawn(executable, ['--no-optional-locks', '--no-pager', ...args], { cwd: home, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []; let size = 0, failure: GitFailure | null = null
    const stop = (kind: GitError) => { failure ??= new GitFailure(kind); child.kill() }
    const abort = () => stop('stale'), timer = setTimeout(() => stop('timeout'), timeout)
    signal.addEventListener('abort', abort, { once: true })
    child.stdin.on('error', () => { /* Early native rejection can close stdin (EPIPE). Close owns the outcome. */ })
    child.stdin.end(io?.input)
    child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > cap) stop('limit'); else chunks.push(data) })
    child.stderr.on('data', (data: Buffer) => { size += data.length; if (size > cap) stop('limit') })
    child.on('error', () => { failure ??= new GitFailure('unavailable') })
    child.on('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (failure || code !== 0 && !(ignoreQuery && code === 1)) reject(failure ?? new GitFailure('unavailable')); else resolve(Buffer.concat(chunks)) })
  })
}
async function boundedRead(path: string, cap: number): Promise<Buffer> {
  const evidence = await inspectExplorerPath(path, 'file'), before = await lstat(path, { bigint: true })
  if (before.size > BigInt(cap)) throw new GitFailure('limit')
  const file = await open(path, 'r')
  try {
    const initial = await file.stat({ bigint: true }), buffer = Buffer.alloc(cap + 1)
    if (initial.ino !== before.ino || initial.dev !== before.dev) throw new GitFailure('stale')
    let length = 0
    while (length < buffer.length) { const read = await file.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead }
    if (length > cap) throw new GitFailure('limit')
    const after = await file.stat({ bigint: true }), final = await lstat(path, { bigint: true })
    if (initial.size !== after.size || initial.mtimeNs !== after.mtimeNs || initial.ctimeNs !== after.ctimeNs || after.ino !== final.ino || after.mtimeNs !== final.mtimeNs || evidence.chain !== (await inspectExplorerPath(path, 'file')).chain) throw new GitFailure('stale')
    return buffer.subarray(0, length)
  } finally { await file.close() }
}
const exists = async (path: string) => { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
function text(bytes: Buffer): string {
  const value = decode(bytes)
  if ([...value].some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)) || c.charCodeAt(0) === 127)) throw new GitFailure('unsupported')
  return value
}
interface IndexEntry { name: string; mode: string; oid: string }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
/** Documented v2/v3 index framing. Reject special flags/extensions before Git sees a real index. */
export function ordinaryIndex(bytes: Buffer | null): IndexEntry[] {
  if (!bytes) return []
  const fail = () => { throw new GitFailure('unsupported') }
  if (bytes.length < 32 || bytes.toString('ascii', 0, 4) !== 'DIRC' || ![2, 3].includes(bytes.readUInt32BE(4))) return fail()
  const end = bytes.length - 20, count = bytes.readUInt32BE(8), entries: IndexEntry[] = [], names = new Set<string>(), parents = new Set<string>()
  if (count > GIT_LIMITS.nodes || !createHash('sha1').update(bytes.subarray(0, end)).digest().equals(bytes.subarray(end))) return fail()
  let offset = 12, tree = false
  let previous: Buffer = Buffer.alloc(0)
  for (let i = 0; i < count; i++) {
    const start = offset
    if (offset + 62 > end) return fail()
    const flags = bytes.readUInt16BE(offset + 60), mode = bytes.readUInt32BE(offset + 24).toString(8), oid = bytes.subarray(offset + 40, offset + 60).toString('hex')
    if (flags & 0xf000 || !['100644', '100755'].includes(mode) || /^0+$/.test(oid)) return fail()
    const nul = bytes.indexOf(0, offset + 62)
    if (nul < 0 || nul >= end) return fail()
    const name = decode(bytes.subarray(offset + 62, nul)), key = name.toLowerCase()
    const raw = bytes.subarray(offset + 62, nul), ancestors = key.split('/').slice(0, -1).map((_, index) => key.split('/').slice(0, index + 1).join('/'))
    if (!gitRelativeName(name) || Buffer.byteLength(name) !== (flags & 0xfff) || names.has(key) || parents.has(key) || ancestors.some(parent => names.has(parent)) || previous.length && Buffer.compare(previous, raw) >= 0) return fail()
    previous = raw; ancestors.forEach(parent => parents.add(parent))
    names.add(key); entries.push({ name, mode, oid })
    offset = start + Math.ceil((nul + 1 - start) / 8) * 8
    if (offset > end || bytes.subarray(nul, offset).some(byte => byte !== 0)) return fail()
  }
  while (offset < end) {
    if (offset + 8 > end) return fail()
    const extension = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32BE(offset + 4)
    // TREE is a data-only cache. In particular no split-index, sparse, fsmonitor,
    // untracked cache or path-bearing accelerator enters the mutation path.
    if (extension !== 'TREE' || tree || length > end - offset - 8) return fail()
    tree = true
    offset += 8 + length
  }
  return entries
}
async function fileWitness(path: string): Promise<string> {
  if (!await exists(path)) {
    let parent = dirname(path)
    while (!await exists(parent)) parent = dirname(parent)
    return 'missing:' + (await inspectExplorerPath(parent, 'directory')).chain
  }
  const bytes = await boundedRead(path, GIT_LIMITS.text), stat = await lstat(path, { bigint: true })
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, (await inspectExplorerPath(path, 'file')).chain, digest(bytes)].join(':')
}
async function actionWitness(root: string, name: string, check: () => void): Promise<string> {
  check()
  const hash = createHash('sha256').update(await fileWitness(join(root, ...name.split('/'))))
  let directory = root
  for (const component of ['', ...name.split('/').slice(0, -1)]) {
    check()
    if (component) directory = join(directory, component)
    for (const rule of ['.gitignore', '.gitattributes']) { check(); hash.update(rule + ':' + await fileWitness(join(directory, rule))) }
  }
  return hash.digest('hex')
}
/** Snapshot includes the whole refs namespace, not just HEAD's symbolic name. */
async function metadataWitness(git: string, check: () => void, includeIndex = true): Promise<string> {
  const hash = createHash('sha256'); let bytes = 0, nodes = 0
  hash.update((await inspectExplorerPath(git, 'directory')).chain)
  const visit = async (path: string, depth: number): Promise<void> => {
    check(); if (++nodes > GIT_LIMITS.nodes || depth > 32) throw new GitFailure('limit')
    hash.update(relative(git, path) + '\0')
    if (!await exists(path)) { hash.update('absent'); return }
    const stat = await lstat(path, { bigint: true })
    if (stat.isDirectory()) {
      hash.update((await inspectExplorerPath(path, 'directory')).chain)
      const directory = await opendir(path), children: string[] = []
      for await (const entry of directory) { check(); if (children.length + nodes >= GIT_LIMITS.nodes) throw new GitFailure('limit'); if (!safeExplorerName(entry.name)) throw new GitFailure('unsupported'); children.push(entry.name) }
      for (const name of children.sort()) await visit(join(path, name), depth + 1)
    } else {
      bytes += Number(stat.size); if (bytes > GIT_LIMITS.metadata) throw new GitFailure('limit')
      const data = await boundedRead(path, Math.min(GIT_LIMITS.metadata, Number(stat.size)))
      hash.update([stat.dev, stat.ino, stat.mtimeNs, stat.ctimeNs].join(':')).update(data)
    }
  }
  for (const name of ['HEAD', 'config', 'packed-refs', 'refs', 'info/attributes', 'info/exclude', ...(includeIndex ? ['index'] : [])]) await visit(join(git, name), 0)
  return hash.digest('hex')
}
async function validateObjectDestination(objects: string, check: () => void): Promise<void> {
  let nodes = 0, size = 0
  const walk = async (path: string, depth: number): Promise<void> => {
    check(); await inspectExplorerPath(path, 'directory')
    const directory = await opendir(path)
    for await (const entry of directory) {
      check()
      if (++nodes > GIT_LIMITS.nodes || depth > 2) throw new GitFailure('limit')
      const child = join(path, entry.name), parts = relative(objects, child).split(sep)
      // Unlike the read-only copier, reject omitted accelerators too. The real
      // object database cannot redirect a write/read through alternates or MIDX.
      const allowed = parts.length === 1 ? /^(?:[a-f0-9]{2}|pack|info)$/.test(entry.name) : parts.length === 2 && (parts[0] === 'pack' ? /^pack-[a-f0-9]{40}\.(pack|idx)$/.test(entry.name) : /^[a-f0-9]{2}$/.test(parts[0]!) && /^[a-f0-9]{38}$/.test(entry.name))
      if (!allowed) throw new GitFailure('unsupported')
      const stat = await lstat(child)
      if (stat.isDirectory() && parts.length === 1) await walk(child, depth + 1)
      else {
        await inspectExplorerPath(child, 'file'); size += stat.size
        if (size > GIT_LIMITS.metadata) throw new GitFailure('limit')
      }
    }
  }
  await walk(objects, 0)
}
interface TrackedPath { name: string; mode: string; stage: number }
/** Git decides ignores; Main validates only visited directories and relevant leaves.
 * No descendant of a pruned untracked directory is enumerated or submitted to Git.
 */
async function inspectWorkingTree(root: string, tracked: readonly TrackedPath[], ignore: (names: string[]) => Promise<Set<string>>, check: () => void, spend: () => void): Promise<() => Promise<void>> {
  const key = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name
  const held = new Map<string, { mode: string; stage: number }>(), ancestors = new Set<string>()
  for (const file of tracked) {
    const folded = key(file.name)
    held.set(folded, held.has(folded) ? { mode: 'ambiguous', stage: -1 } : file)
    const names = file.name.split('/')
    for (let i = 1; i < names.length; i++) ancestors.add(key(names.slice(0, i).join('/')))
  }
  const folders = new Map<string, string>(), rules = new Map<string, string>(), links = new Map<string, string>()
  const folderWitness = async (path: string) => {
    const evidence = await inspectExplorerPath(path, 'directory'), stat = await lstat(path, { bigint: true })
    return [evidence.chain, stat.mtimeNs, stat.ctimeNs].join(':')
  }
  const linkWitness = async (path: string) => { const stat = await lstat(path, { bigint: true }); if (!stat.isSymbolicLink()) throw new GitFailure('stale'); return [stat.dev, stat.ino, stat.mtimeNs, stat.ctimeNs, await readlink(path)].join(':') }
  let level = [{ path: root, name: '', depth: 0 }]
  while (level.length) {
    const children: { path: string; name: string; depth: number }[] = []; let inputBytes = 0
    for (const folder of level) {
      check(); if (folder.depth > 32) throw new GitFailure('limit', 'worktree-budget')
      folders.set(folder.path, await folderWitness(folder.path))
      for (const name of ['.gitignore', '.gitattributes']) {
        const path = join(folder.path, name)
        try { rules.set(path, await fileWitness(path)) } catch { throw new GitFailure('unsupported', 'worktree-rules') }
      }
      const directory = await opendir(folder.path, { bufferSize: 32 })
      for await (const entry of directory) {
        check(); spend()
        if (!folder.name && entry.name.toLowerCase() === '.git') continue
        if (folder.name && entry.name.toLowerCase() === '.git') throw new GitFailure('unsupported', 'layout')
        const name = (folder.name ? folder.name + '/' : '') + entry.name
        if (folder.depth + 1 > 32) throw new GitFailure('limit', 'worktree-budget')
        if (!gitRelativeName(name)) throw new GitFailure('unsupported', 'worktree-special')
        inputBytes += Buffer.byteLength(name) + 1
        if (inputBytes > GIT_LIMITS.output) throw new GitFailure('limit', 'worktree-budget')
        children.push({ path: join(folder.path, entry.name), name, depth: folder.depth + 1 })
      }
    }
    const ignored = children.length ? await ignore(children.map(child => child.name)) : new Set<string>()
    const next: typeof level = []
    for (const child of children) {
      check()
      const folded = key(child.name), mode = held.get(folded), parent = ancestors.has(folded)
      if (ignored.has(child.name) && !mode && !parent) continue
      // Ignore submodule worktrees completely, matching the fixed Git status flag.
      // Their index entries still prevent ordinaryIndex from authorizing writes.
      if (mode?.mode === '160000' && mode.stage === 0 && !parent) continue
      const stat = await lstat(child.path)
      if (stat.isSymbolicLink()) {
        if (parent) throw new GitFailure('unsupported', 'worktree-redirect')
        // Node does not distinguish Windows junctions from leaf symlinks here.
        // Confirm an ordinary inside-root file target without inspecting outside
        // the grant. Visible directory/dangling/outside redirects fail closed.
        const target = resolve(dirname(child.path), await readlink(child.path)), inside = relative(root, target)
        if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new GitFailure('unsupported', 'worktree-redirect')
        try { await inspectExplorerPath(target, 'file') } catch { throw new GitFailure('unsupported', 'worktree-redirect') }
        links.set(child.path, await linkWitness(child.path))
      } else if (stat.isDirectory()) next.push(child)
      else if (!stat.isFile()) throw new GitFailure('unsupported', 'worktree-special')
      // A regular hardlink can be inspected by Git. Native file reads and index
      // actions still use the original single-link actionWitness/boundedRead.
    }
    level = next
  }
  return async () => {
    for (const [path, witness] of folders) { check(); if (witness !== await folderWitness(path)) throw new GitFailure('stale') }
    for (const [path, witness] of rules) { check(); if (witness !== await fileWitness(path)) throw new GitFailure('stale') }
    for (const [path, witness] of links) { check(); if (witness !== await linkWitness(path)) throw new GitFailure('stale') }
  }
}
/** Per-window owner. Isolated inspection metadata; a separate explicit gate targets the real index. */
export class GitStore {
  private controller: AbortController | null = null
  private status: GitStatus | null = null
  private authority: { metadata: string; files: Map<string, string> } | null = null
  private busy = false
  private directories: DirectoryStore
  constructor(directories: DirectoryStore) { this.directories = directories }
  revoke(): void { this.controller?.abort(); this.status = null; this.authority = null }
  async inspect(operation: 'status' | 'compare' | 'stage' | 'unstage', root: string, id: string | undefined, current: () => boolean): Promise<GitResult> {
    if (this.busy) throw new GitFailure('busy')
    if (operation === 'status') { this.status = null; this.authority = null }
    this.busy = true
    const controller = new AbortController(); this.controller = controller
    const guard = this.directories.guard(), deadline = Date.now() + GIT_LIMITS.timeout
    let temporary: string | undefined, writeStarted = false, phase: GitFailureReason = 'layout'
    const finish = async () => {
      try {
        if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 })
        check(); await this.directories.folder(root, () => { check(); return true })
      } catch (error) { if (writeStarted) throw new GitFailure('uncertain'); throw error }
    }
    const check = () => { if (!guard() || !current() || controller.signal.aborted) throw new GitFailure('stale'); if (Date.now() > deadline) throw new GitFailure('timeout') }
    try {
      const path = await this.directories.folder(root, () => { check(); return true }), git = join(path, '.git')
      if (!await exists(git)) {
        if (await exists(join(path, 'HEAD')) && await exists(join(path, 'objects')) && await exists(join(path, 'config'))) throw new GitFailure('unsupported')
        throw new GitFailure('not-repository')
      }
      const metadataKind = await lstat(git)
      if (!metadataKind.isDirectory() || metadataKind.isSymbolicLink()) throw new GitFailure('unsupported')
      await inspectExplorerPath(git, 'directory')
      phase = 'metadata'
      // Validate parents before even probing path-bearing metadata children.
      for (const name of ['info', 'refs', 'objects', 'objects/info']) if (await exists(join(git, name))) await inspectExplorerPath(join(git, name), 'directory')
      for (const name of ['commondir', 'gitdir', 'shallow']) if (await exists(join(git, name))) throw new GitFailure('unsupported', 'layout')
      for (const name of ['info/grafts', 'objects/info/alternates', 'objects/info/http-alternates', 'refs/replace']) if (await exists(join(git, name))) throw new GitFailure('unsupported', 'metadata')
      const mutation = operation === 'stage' || operation === 'unstage'
      const selected = this.status?.root === root ? this.status.changes.find(change => change.id === id) : undefined
      const authority = this.authority
      if (mutation && (!selected || !authority)) throw new GitFailure('stale')
      const metadata = operation === 'compare' ? '' : await metadataWitness(git, check)
      if (mutation && (metadata !== authority!.metadata || await actionWitness(path, selected!.name, check) !== authority!.files.get(selected!.id))) throw new GitFailure('stale')
      if (mutation && !selected![operation]) throw new GitFailure('unsupported')
      if (mutation && await exists(join(git, 'index.lock'))) throw new GitFailure('busy')
      if (operation === 'status') { this.status = null; this.authority = null }
      const executable = await resolveGitExecutable()
      // Windows TEMP can use an OS alias or lie inside the selected working tree.
      // Resolve only host scratch here; never create temporary files inside the grant.
      const scratchBase = await realpath(tmpdir()), scratchRelative = relative(path, scratchBase)
      if (!isAbsolute(scratchRelative) && scratchRelative !== '..' && !scratchRelative.startsWith('..' + sep)) throw new GitFailure('unsupported')
      temporary = await mkdtemp(join(scratchBase, 'geppio-git-read-'))
      const shadow = join(temporary, 'repository'); await mkdir(shadow)
      let nodes = 0, bytes = 0
      // Native metadata remains fully validated, including ignored metadata files.
      const walk = async (source: string, target: string, depth = 0): Promise<void> => {
        check(); if (depth > 32) throw new GitFailure('limit')
        await inspectExplorerPath(source, 'directory')
        const directory = await opendir(source, { bufferSize: 32 })
        for await (const entry of directory) {
          check(); if (++nodes > GIT_LIMITS.nodes) throw new GitFailure('limit')
          if (!safeExplorerName(entry.name)) throw new GitFailure('unsupported')
          if (target && (source.toLowerCase() === join(git, 'objects').toLowerCase() || source.toLowerCase().startsWith(join(git, 'objects').toLowerCase() + sep))) {
            const object = relative(join(git, 'objects'), join(source, entry.name)).split(sep)
            // Optional object accelerators can contain additional filename references.
            // Copy only ordinary loose objects and matching pack/idx pairs; no MIDX,
            // commit-graph, alternates, promisor or accelerator data enters Git's snapshot.
            if (object[0]?.toLowerCase() === 'info') continue
            if (object[0]?.toLowerCase() === 'pack') { if (object.length > 1 && !/^pack-[a-f0-9]{40}\.(pack|idx)$/.test(object.slice(1).join('/'))) continue }
            else if (!/^[a-f0-9]{2}$/.test(object[0]!) || object.length > 1 && (object.length !== 2 || !/^[a-f0-9]{38}$/.test(object[1]!))) throw new GitFailure('unsupported')
          }
          // Never let a racing redirect enter the private object database.
          if (target && source.toLowerCase() === join(git, 'objects', 'info').toLowerCase() && ['alternates', 'http-alternates'].includes(entry.name.toLowerCase())) throw new GitFailure('unsupported')
          const child = join(source, entry.name), stat = await lstat(child)
          if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw new GitFailure('unsupported')
          if (stat.isDirectory()) { const destination = join(target, entry.name); await mkdir(destination); await walk(child, destination, depth + 1) }
          else if (target) { bytes += stat.size; if (bytes > GIT_LIMITS.metadata) throw new GitFailure('limit'); await writeFile(join(target, entry.name), await boundedRead(child, Math.min(GIT_LIMITS.metadata - bytes + stat.size, stat.size))) }
        }
      }
      // Copy only data used by builtin inspection. Original config is parsed explicitly without includes.
      for (const name of ['HEAD', 'index', 'packed-refs', 'refs', 'objects']) {
        const source = join(git, name), target = join(shadow, name)
        if (!await exists(source)) { if (['HEAD', 'objects', 'refs'].includes(name)) throw new GitFailure('unsupported'); continue }
        const stat = await lstat(source)
        if (stat.isDirectory()) { await mkdir(target); await walk(source, target) }
        else {
          bytes += stat.size; if (bytes > GIT_LIMITS.metadata) throw new GitFailure('limit')
          await writeFile(target, await boundedRead(source, Math.min(stat.size, GIT_LIMITS.metadata)))
          // Git uses the index timestamp to detect racily clean stat-cache entries.
          // A newly dated copy can hide same-size edits. Round down conservatively
          // so copying never makes that check less strict; the real index is untouched.
          if (name === 'index') await utimes(target, stat.atime, Math.floor(stat.mtimeMs / 1000))
        }
      }
      await mkdir(join(shadow, 'info'))
      for (const name of ['exclude', 'attributes']) if (await exists(join(git, 'info', name))) await writeFile(join(shadow, 'info', name), await boundedRead(join(git, 'info', name), 64 * 1024))
      for (const name of ['alternates', 'http-alternates']) if (await exists(join(shadow, 'objects', 'info', name))) throw new GitFailure('unsupported')
      await writeFile(join(temporary, 'source-config'), await boundedRead(join(git, 'config'), 64 * 1024))
      const base = ['--git-dir=' + shadow, '--work-tree=' + path]
      let safe = '[core]\nrepositoryformatversion = 0\nbare = false\nfsmonitor = false\nuntrackedCache = false\npreloadindex = false\n'
      await writeFile(join(shadow, 'config'), safe)
      // Bind even version/config parsing to private metadata: the host temporary
      // directory must never cause implicit discovery of another parent repository.
      const invoke = async (args: string[], cap?: number, io?: { input: Buffer; index?: string; objects?: string; ignoreQuery?: true }) => { check(); const result = await runGit(executable, [...base, ...args], temporary!, controller.signal, cap, Math.max(1, deadline - Date.now()), io); check(); await this.directories.folder(root, () => { check(); return true }); return result }
      const version = decode(await invoke(['--version']))
      if (!/^git version 2\.(?:[4-9]\d|[1-9]\d{2,})\./.test(version)) throw new GitFailure('version')
      phase = 'configuration'
      const config = decode(await invoke(['config', '--no-includes', '--null', '--file', join(temporary, 'source-config'), '--list']))
      for (const record of config.split('\0').filter(Boolean)) {
        const newline = record.indexOf('\n'), key = record.slice(0, newline).toLowerCase(), value = record.slice(newline + 1)
        if (key.startsWith('extensions.') || key.startsWith('filter.') || ['core.worktree', 'core.excludesfile', 'core.attributesfile'].includes(key) || key === 'core.bare' && value !== 'false' || key === 'core.repositoryformatversion' && value !== '0') throw new GitFailure('unsupported')
        if (['core.filemode', 'core.ignorecase', 'core.symlinks'].includes(key)) { if (!/^(true|false)$/.test(value)) throw new GitFailure('unsupported'); safe += key.slice(5) + ' = ' + value + '\n' }
        if (key === 'core.autocrlf') { if (!/^(true|false|input)$/.test(value)) throw new GitFailure('unsupported'); safe += 'autocrlf = ' + value + '\n' }
        if (key === 'core.eol') { if (!/^(lf|crlf|native)$/.test(value)) throw new GitFailure('unsupported'); safe += 'eol = ' + value + '\n' }
      }
      await writeFile(join(shadow, 'config'), safe)
      phase = 'index'
      let indexListing: Buffer
      try { indexListing = await invoke(['ls-files', '--stage', '-z']) }
      catch (error) { if (error instanceof GitFailure && error.kind === 'unavailable') throw new GitFailure('unsupported', 'index'); throw error }
      const files = decode(indexListing).split('\0').filter(Boolean)
      if (files.length > GIT_LIMITS.nodes) throw new GitFailure('limit')
      if (files.some(row => !/^(100644|100755|120000|160000) [a-f0-9]{40} [0-3]\t/.test(row) || !gitRelativeName(row.slice(row.indexOf('\t') + 1)))) throw new GitFailure('unsupported')
      phase = 'worktree-special'
      const verifyWorktree = await inspectWorkingTree(path, files.map(row => ({ mode: row.slice(0, 6), stage: Number(row[48]), name: row.slice(row.indexOf('\t') + 1) })), async names => {
        const input = Buffer.from(names.join('\0') + '\0'), requested = new Set(names)
        const output = await invoke(['-C', path, 'check-ignore', '--no-index', '--stdin', '-z'], GIT_LIMITS.output, { input, ignoreQuery: true })
        const ignored = decode(output).split('\0')
        if (ignored.pop() !== '' || ignored.some(name => !requested.has(name))) throw new GitFailure('unsupported', 'worktree-rules')
        return new Set(ignored)
      }, check, () => { if (++nodes > GIT_LIMITS.nodes) throw new GitFailure('limit', 'worktree-budget') })
      const status = async () => { await verifyWorktree(); const result = parseGitStatus(await invoke(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all'])); await verifyWorktree(); return result }
      if (operation === 'status') {
        this.status = null
        const changes = await status()
        const head = text(await boundedRead(join(shadow, 'HEAD'), 4096)).trim()
        const detached = !head.startsWith('ref: refs/heads/'), branch = detached ? 'HEAD destacado · ' + head.slice(0, 12) : head.slice(16)
        const ref = head.slice(5)
        if (detached ? !/^[a-f0-9]{40}$/.test(head) : ref.includes('..') || ref.includes('@{') || [...ref].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || '~^:?*[\\'.includes(c)) || ref.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) throw new GitFailure('unsupported')
        if (!branch || branch.length > 255) throw new GitFailure('unsupported')
        const witnesses = new Map<string, string>()
        let ordinary = true
        try { ordinaryIndex(await exists(join(shadow, 'index')) ? await boundedRead(join(shadow, 'index'), GIT_LIMITS.metadata) : null) } catch { ordinary = false }
        for (const change of changes) {
          check()
          const eligible = ordinary && !change.conflict && !change.previous && /^[ MAD?]{2}$/.test(change.index + change.working)
          if (eligible) {
            try {
              witnesses.set(change.id, await actionWitness(path, change.name, check))
              change.stage = change.untracked || change.working !== ' '
              change.unstage = !change.untracked && change.index !== ' '
            } catch { change.actionReason = 'Arquivo fora dos limites seguros para preparar (até 256 KiB, sem links).' }
          } else change.actionReason = 'Renomes, conflitos, modos e índices especiais não permitem esta ação.'
        }
        if (metadata !== await metadataWitness(git, check)) throw new GitFailure('stale')
        check(); this.status = { root, name: basename(path), branch, detached, changes }; this.authority = { metadata, files: witnesses }
        return { ok: true, status: this.status }
      }
      if (mutation) {
        const change = selected!, working = join(path, ...change.name.split('/')), indexPath = join(git, 'index')
        const fresh = (await status()).find(entry => entry.name === change.name)
        if (!fresh || fresh.index !== change.index || fresh.working !== change.working || fresh.previous !== change.previous || fresh.conflict || fresh.untracked !== change.untracked) throw new GitFailure('stale')
        const entries = ordinaryIndex(await exists(join(shadow, 'index')) ? await boundedRead(join(shadow, 'index'), GIT_LIMITS.metadata) : null)
        const old = entries.find(entry => entry.name === change.name)
        if (old) await invoke(['cat-file', 'blob', old.oid], GIT_LIMITS.text)
        let target: IndexEntry | undefined
        if (operation === 'stage' && await exists(working)) {
          const oid = decode(await invoke(['-C', path, 'hash-object', '-w', '--path=' + change.name, '--stdin'], 256, { input: await boundedRead(working, GIT_LIMITS.text) })).trim()
          if (!/^[a-f0-9]{40}$/.test(oid)) throw new GitFailure('unsupported')
          await invoke(['cat-file', 'blob', oid], GIT_LIMITS.text)
          target = { name: change.name, mode: old?.mode ?? '100644', oid }
        } else if (operation === 'unstage') {
          const head = decode(await boundedRead(join(shadow, 'HEAD'), 4096)).trim(), ref = head.startsWith('ref: refs/heads/') ? head.slice(5) : null
          const packed = await exists(join(shadow, 'packed-refs')) ? decode(await boundedRead(join(shadow, 'packed-refs'), GIT_LIMITS.metadata)) : ''
          const unborn = ref && !await exists(join(shadow, ...ref.split('/'))) && !packed.split('\n').some(line => line.endsWith(' ' + ref))
          if (!unborn) {
            const tree = decode(await invoke(['ls-tree', '-z', 'HEAD', '--', change.name])).split('\0').filter(Boolean)
            if (tree.length) {
              const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(tree[0]!)
              if (tree.length !== 1 || !match || match[3] !== change.name) throw new GitFailure('unsupported')
              target = { name: change.name, mode: match[1]!, oid: match[2]! }
              await invoke(['cat-file', 'blob', target.oid], GIT_LIMITS.text)
            }
          }
        }
        if (old && target && old.mode !== target.mode) throw new GitFailure('unsupported')
        const beforeTree = decode(await invoke(['write-tree'], 256)).trim()
        if (target) await invoke(['update-index', '--add', '--cacheinfo', target.mode, target.oid, target.name])
        else await invoke(['update-index', '--force-remove', '--', change.name])
        const prospective = await status()
        if (prospective.some(entry => (entry.name === change.name || entry.previous === change.name) && (entry.previous || entry.conflict))) throw new GitFailure('unsupported')
        const afterTree = decode(await invoke(['write-tree'], 256)).trim()
        await writeFile(join(shadow, 'info', 'attributes'), '* -diff\n')
        let patch = await invoke(['diff-tree', '-p', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv', beforeTree, afterTree, '--', change.name])
        const rendered = decode(patch), empty = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
        if (!rendered.startsWith('diff --git ') || rendered.split('\ndiff --git ').length !== 1 || (!rendered.includes('\nGIT binary patch\n') && !(old?.oid === empty && !target || !old && target?.oid === empty))) throw new GitFailure('unsupported')
        // Binary preimage OID is checked by Git under its native index lock. Omit
        // unchanged modes so a racing executable-bit update is preserved by Git.
        if (old && target) patch = Buffer.from(rendered.replace(/^(index [a-f0-9]{40}\.\.[a-f0-9]{40}) 100(?:644|755)$/m, '$1'))
        await validateObjectDestination(join(git, 'objects'), check)
        const fixed = await metadataWitness(git, check, false)
        if (metadata !== await metadataWitness(git, check) || await actionWitness(path, change.name, check) !== authority!.files.get(change.id)) throw new GitFailure('stale')
        await this.directories.folder(root, () => { check(); return true })
        this.status = null; this.authority = null
        writeStarted = true
        await invoke(['apply', '--cached', '--binary', '--whitespace=nowarn'], undefined, { input: patch, index: indexPath, objects: join(git, 'objects') })
        const actual = ordinaryIndex(await boundedRead(indexPath, GIT_LIMITS.metadata))
        const expected = [...entries.filter(entry => entry.name !== change.name), ...(target ? [target] : [])].sort((a, b) => a.name.localeCompare(b.name))
        actual.sort((a, b) => a.name.localeCompare(b.name))
        if (JSON.stringify(actual) !== JSON.stringify(expected) || fixed !== await metadataWitness(git, check, false) || await actionWitness(path, change.name, check) !== authority!.files.get(change.id)) throw new GitFailure('uncertain')
        return { ok: true, mutated: true }
      }
      const change = this.status?.root === root ? this.status.changes.find(change => change.id === id) : undefined
      if (!change) throw new GitFailure('stale')
      if (change.untracked || change.conflict) throw new GitFailure('unsupported')
      const tree = decode(await invoke(['ls-tree', '-z', 'HEAD', '--', change.previous ?? change.name])).split('\0').filter(Boolean)
      let original: Buffer = Buffer.alloc(0)
      if (tree.length) {
        const match = /^(100644|100755) blob ([a-f0-9]{40})\t/.exec(tree[0]!)
        if (tree.length !== 1 || !match) throw new GitFailure('unsupported')
        original = await invoke(['cat-file', 'blob', match[2]!], GIT_LIMITS.text)
      }
      const working = join(path, ...change.name.split('/'))
      const modified = await exists(working) ? await boundedRead(working, GIT_LIMITS.text) : Buffer.alloc(0)
      if (!await exists(working) && change.index !== 'D' && change.working !== 'D') throw new GitFailure('stale')
      check()
      return { ok: true, comparison: { name: change.name, original: text(original), modified: text(modified), basis: 'HEAD → arquivo salvo no disco; não representa o índice nem alterações não salvas do Editor.' } }
    } catch (error) {
      if (writeStarted) throw new GitFailure('uncertain')
      if (error instanceof GitFailure && error.kind === 'unsupported' && !error.reason) throw new GitFailure(error.kind, phase)
      if (error instanceof ExplorerFailure && error.kind === 'unsupported') throw new GitFailure(error.kind, phase)
      throw error
    } finally {
      try {
        await finish()
      } finally { if (this.controller === controller) this.controller = null; this.busy = false }
    }
  }
}
