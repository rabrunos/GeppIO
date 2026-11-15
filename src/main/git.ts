import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { DirectoryStore, ExplorerFailure, inspectExplorerPath, safeExplorerName } from './explorer.ts'
import { GIT_LIMITS } from '../shared/git.ts'
import type { GitChange, GitError, GitResult, GitStatus } from '../shared/git.ts'

const messages: Record<GitError, string> = {
  invalid: 'Solicitação Git inválida.', stale: 'A pasta ou a consulta Git mudou. Atualize ou selecione a pasta novamente.',
  busy: 'Aguarde a consulta Git em andamento.', unsupported: 'Repositório ou comparação não suportado neste piloto (raiz local comum, sem links, submódulos, filtros ou extensões).',
  limit: 'Limite Git excedido: 512 alterações, 256 KiB por texto, 64 MiB de metadados ou 20.000 entradas. Escolha um repositório menor.',
  unavailable: 'Não foi possível consultar o Git. Atualize e tente novamente.', missing: 'Git para Windows não encontrado na instalação padrão em Arquivos de Programas.', timeout: 'A consulta Git excedeu 15 segundos. Tente um repositório menor.'
}
export class GitFailure extends Error {
  readonly kind: GitError
  constructor(kind: GitError) { super(messages[kind]); this.kind = kind }
}
export function gitFailure(error: unknown): GitResult {
  const code = error instanceof GitFailure || error instanceof ExplorerFailure ? error.kind : 'unavailable'
  return { ok: false, code, error: messages[code] }
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
    if (!/^[ MADRCU?!]{2} /.test(row) || !gitRelativeName(name)) throw new GitFailure('unsupported')
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
/** No shell, stdin, inherited Git/Node/loader/config environment, stderr disclosure or generic bridge. */
export function runGit(executable: string, args: readonly string[], home: string, signal: AbortSignal, cap: number = GIT_LIMITS.output, timeout: number = GIT_LIMITS.timeout): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new GitFailure('stale')); return }
    const child = spawn(executable, ['--no-optional-locks', '--no-pager', ...args], { cwd: home, env: gitEnvironment(home), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []; let size = 0, failure: GitFailure | null = null
    const stop = (kind: GitError) => { failure ??= new GitFailure(kind); child.kill() }
    const abort = () => stop('stale'), timer = setTimeout(() => stop('timeout'), timeout)
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > cap) stop('limit'); else chunks.push(data) })
    child.stderr.on('data', (data: Buffer) => { size += data.length; if (size > cap) stop('limit') })
    child.on('error', () => { failure ??= new GitFailure('unavailable') })
    child.on('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (failure || code !== 0) reject(failure ?? new GitFailure('unavailable')); else resolve(Buffer.concat(chunks)) })
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
/** Per-window owner. Disposable metadata isolates every Git parser from executable config and writes. */
export class GitStore {
  private controller: AbortController | null = null
  private status: GitStatus | null = null
  private busy = false
  private directories: DirectoryStore
  constructor(directories: DirectoryStore) { this.directories = directories }
  revoke(): void { this.controller?.abort(); this.status = null }
  async inspect(operation: 'status' | 'compare', root: string, id: string | undefined, current: () => boolean): Promise<GitResult> {
    if (this.busy) throw new GitFailure('busy')
    this.busy = true
    const controller = new AbortController(); this.controller = controller
    const guard = this.directories.guard(), deadline = Date.now() + GIT_LIMITS.timeout
    let temporary: string | undefined
    const check = () => { if (!guard() || !current() || controller.signal.aborted) throw new GitFailure('stale'); if (Date.now() > deadline) throw new GitFailure('timeout') }
    try {
      const path = await this.directories.folder(root, () => { check(); return true }), git = join(path, '.git')
      if (!await exists(git)) throw new GitFailure('unsupported')
      await inspectExplorerPath(git, 'directory')
      for (const name of ['commondir', 'gitdir', 'shallow', 'info/grafts', 'objects/info/alternates', 'objects/info/http-alternates', 'refs/replace']) if (await exists(join(git, name))) throw new GitFailure('unsupported')
      const executable = await resolveGitExecutable()
      // Windows TEMP can use an OS alias or lie inside the selected working tree.
      // Resolve only host scratch here; never create temporary files inside the grant.
      const scratchBase = await realpath(tmpdir()), scratchRelative = relative(path, scratchBase)
      if (!isAbsolute(scratchRelative) && scratchRelative !== '..' && !scratchRelative.startsWith('..' + sep)) throw new GitFailure('unsupported')
      temporary = await mkdtemp(join(scratchBase, 'geppio-git-read-'))
      const shadow = join(temporary, 'repository'); await mkdir(shadow)
      let nodes = 0, bytes = 0
      // Validate the complete bounded working tree before Git can inspect it. No following links.
      const walk = async (source: string, target?: string, depth = 0): Promise<void> => {
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
          if (!target && source === path && entry.name.toLowerCase() === '.git') continue
          if (!target && entry.name.toLowerCase() === '.git') throw new GitFailure('unsupported')
          const child = join(source, entry.name), stat = await lstat(child)
          if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw new GitFailure('unsupported')
          if (stat.isDirectory()) { const destination = target ? join(target, entry.name) : undefined; if (destination) await mkdir(destination); await walk(child, destination, depth + 1) }
          else if (target) { bytes += stat.size; if (bytes > GIT_LIMITS.metadata) throw new GitFailure('limit'); await writeFile(join(target, entry.name), await boundedRead(child, Math.min(GIT_LIMITS.metadata - bytes + stat.size, stat.size))) }
        }
      }
      await walk(path)
      // Copy only data used by builtin inspection. Original config is parsed explicitly without includes.
      for (const name of ['HEAD', 'index', 'packed-refs', 'refs', 'objects']) {
        const source = join(git, name), target = join(shadow, name)
        if (!await exists(source)) { if (['HEAD', 'objects', 'refs'].includes(name)) throw new GitFailure('unsupported'); continue }
        const stat = await lstat(source)
        if (stat.isDirectory()) { await mkdir(target); await walk(source, target) }
        else { bytes += stat.size; if (bytes > GIT_LIMITS.metadata) throw new GitFailure('limit'); await writeFile(target, await boundedRead(source, Math.min(stat.size, GIT_LIMITS.metadata))) }
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
      const invoke = async (args: string[], cap?: number) => { check(); const result = await runGit(executable, [...base, ...args], temporary!, controller.signal, cap, Math.max(1, deadline - Date.now())); check(); await this.directories.folder(root, () => { check(); return true }); return result }
      const version = decode(await invoke(['--version']))
      if (!/^git version 2\.(?:[4-9]\d|[1-9]\d{2,})\./.test(version)) throw new GitFailure('unsupported')
      const config = decode(await invoke(['config', '--no-includes', '--null', '--file', join(temporary, 'source-config'), '--list']))
      for (const record of config.split('\0').filter(Boolean)) {
        const newline = record.indexOf('\n'), key = record.slice(0, newline).toLowerCase(), value = record.slice(newline + 1)
        if (key.startsWith('extensions.') || key.startsWith('filter.') || ['core.worktree', 'core.excludesfile', 'core.attributesfile'].includes(key) || key === 'core.bare' && value !== 'false' || key === 'core.repositoryformatversion' && value !== '0') throw new GitFailure('unsupported')
        if (['core.filemode', 'core.ignorecase', 'core.symlinks'].includes(key)) { if (!/^(true|false)$/.test(value)) throw new GitFailure('unsupported'); safe += key.slice(5) + ' = ' + value + '\n' }
        if (key === 'core.autocrlf') { if (!/^(true|false|input)$/.test(value)) throw new GitFailure('unsupported'); safe += 'autocrlf = ' + value + '\n' }
        if (key === 'core.eol') { if (!/^(lf|crlf|native)$/.test(value)) throw new GitFailure('unsupported'); safe += 'eol = ' + value + '\n' }
      }
      await writeFile(join(shadow, 'config'), safe)
      const files = decode(await invoke(['ls-files', '--stage', '-z'])).split('\0').filter(Boolean)
      if (files.some(row => !/^(100644|100755) [a-f0-9]{40} [0-3]\t/.test(row) || !gitRelativeName(row.slice(row.indexOf('\t') + 1)))) throw new GitFailure('unsupported')
      if (operation === 'status') {
        this.status = null
        const changes = parseGitStatus(await invoke(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all']))
        const head = text(await boundedRead(join(shadow, 'HEAD'), 4096)).trim()
        const detached = !head.startsWith('ref: refs/heads/'), branch = detached ? 'HEAD destacado · ' + head.slice(0, 12) : head.slice(16)
        const ref = head.slice(5)
        if (detached ? !/^[a-f0-9]{40}$/.test(head) : ref.includes('..') || ref.includes('@{') || [...ref].some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || '~^:?*[\\'.includes(c)) || ref.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) throw new GitFailure('unsupported')
        if (!branch || branch.length > 255) throw new GitFailure('unsupported')
        check(); this.status = { root, name: basename(path), branch, detached, changes }
        return { ok: true, status: this.status }
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
    } finally {
      try {
        if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 })
        check(); await this.directories.folder(root, () => { check(); return true })
      } finally { if (this.controller === controller) this.controller = null; this.busy = false }
    }
  }
}
