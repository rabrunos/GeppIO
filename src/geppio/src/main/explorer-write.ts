import { spawn } from 'node:child_process'
import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { ExplorerMutation, ExplorerMutationResult, RenameBinding } from '../shared/explorer.ts'
import type { DocumentStore } from './documents.ts'
import { validExplorerBasename } from '../shared/explorer.ts'
import { DirectoryStore, ExplorerDestinationExists, ExplorerFailure, inspectExplorerPath } from './explorer.ts'

type MoveResult = 'moved' | 'exists' | 'denied' | 'unknown'
type Move = (source: string, destination: string, authorize: () => Promise<void>, current: () => boolean, onSubmit?: () => void) => Promise<MoveResult>
const moveCommand = `$ErrorActionPreference = 'Stop'
try {
  $reader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false, $true))
  $buffer = [char[]]::new(65537)
  $length = $reader.ReadBlock($buffer, 0, $buffer.Length)
  if ($length -lt 1 -or $length -gt 65536) { throw 'Invalid request' }
  $request = Microsoft.PowerShell.Utility\\ConvertFrom-Json -InputObject ([string]::new($buffer, 0, $length))
  if ($request.source -isnot [string] -or $request.destination -isnot [string]) { throw 'Invalid request' }
} catch { [Console]::Out.Write('{"code":"denied"}'); exit 0 }
try {
  [IO.File]::Move($request.source, $request.destination)
  [Console]::Out.Write('{"code":"moved"}')
} catch {
  $code = $_.Exception.GetBaseException().HResult -band 65535
  if ($code -in 80,183) { [Console]::Out.Write('{"code":"exists"}') }
  elseif ($code -in 2,3,5,32,33) { [Console]::Out.Write('{"code":"denied"}') }
  else { [Console]::Out.Write('{"code":"unknown"}') }
}`
const timeoutMs = 10_000

/** Fixed first-party Windows helper. Only Main's bounded JSON request uses stdin. */
export const moveExplorerFile: Move = async (source, destination, authorize, current, onSubmit) => {
  if (process.platform !== 'win32' || !current()) return 'denied'
  const sysroot = process.env.SystemRoot, windir = process.env.WINDIR
  if (!sysroot || !windir || !/^[a-z]:\\/i.test(sysroot) || !isAbsolute(sysroot) ||
      resolve(sysroot).toLowerCase() !== sysroot.toLowerCase() || sysroot.toLowerCase() !== windir.toLowerCase()) return 'denied'
  const directory = join(sysroot, 'System32', 'WindowsPowerShell', 'v1.0')
  const executable = join(directory, 'powershell.exe'), payload = Buffer.from(JSON.stringify({ source, destination }), 'utf8')
  if (payload.length > 65536) return 'denied'
  // Like Git for Windows, an OS-installed binary may itself be a hardlink.
  await inspectExplorerPath(directory, 'directory')
  if (!current()) return 'denied'
  const stat = await lstat(executable)
  if (!stat.isFile() || stat.isSymbolicLink() || !current() || (await realpath(executable)).toLowerCase() !== executable.toLowerCase() || !current()) return 'denied'
  const env = { SystemRoot: sysroot, WINDIR: sysroot, PATH: directory, PSModulePath: join(directory, 'Modules') }
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', moveCommand],
    { cwd: directory, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  return new Promise<MoveResult>(resolve => {
    let submitted = false, done = false, output = '', count = 0
    let interrupted: MoveResult | undefined, killDeadline: ReturnType<typeof setTimeout> | undefined
    const finish = (result: MoveResult) => {
      if (done) return
      done = true; clearTimeout(timer); clearTimeout(killDeadline); resolve(result)
    }
    const stop = (cause?: unknown) => {
      if (done || interrupted) return
      interrupted = submitted ? 'unknown' : cause instanceof ExplorerDestinationExists ? 'exists' : 'denied'
      // Reap the fixed helper before the broker releases its transaction. Keep
      // the uncertain outcome bounded even if native process termination fails.
      killDeadline = setTimeout(() => finish(interrupted!), 1000)
      child.kill(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy()
    }
    const timer = setTimeout(stop, timeoutMs)
    child.once('error', stop)
    child.stdin.on('error', stop)
    child.stderr.on('data', (chunk: Buffer) => { count += chunk.length; if (count > 128) stop() })
    child.stdout.on('data', (chunk: Buffer) => { count += chunk.length; if (count > 128) stop(); else output += chunk.toString('ascii') })
    child.once('spawn', () => {
      void authorize().then(() => {
        if (done || interrupted) return
        if (!current()) { stop(); return }
        submitted = true
        onSubmit?.()
        child.stdin.end(payload)
      }).catch(stop)
    })
    child.once('close', code => {
      if (interrupted) { finish(interrupted); return }
      if (!submitted) { finish('denied'); return }
      if (code === 0) for (const result of ['moved', 'exists', 'denied'] as const) {
        if (output === JSON.stringify({ code: result })) { finish(result); return }
      }
      finish('unknown')
    })
  })
}

const refused = (message: string): ExplorerMutationResult => ({ outcome: 'refused', message })
const collision = () => refused('Já existe um item com esse nome. Escolha outro nome.')
const knownRefusal = (err: unknown) => ['EEXIST', 'EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EROFS', 'ENAMETOOLONG', 'EINVAL'].includes((err as NodeJS.ErrnoException)?.code ?? '')

export async function mutateExplorer(directories: DirectoryStore, operation: ExplorerMutation, root: string, node: string, name: string,
  current: () => boolean, bound: (path: string) => boolean, options: { move?: Move; afterMutation?(): Promise<void>; openFile?: { store: DocumentStore; binding: RenameBinding } } = {}): Promise<ExplorerMutationResult> {
  if (!['create-file', 'create-directory', 'rename-file'].includes(operation) || !validExplorerBasename(name)) return refused('Nome ou operação inválida.')
  const generation = directories.guard(), active = () => generation() && current()
  let possible = false
  let binding: ReturnType<DocumentStore['prepareRename']> | undefined
  const unconfirmed = (): ExplorerMutationResult => {
    binding?.uncertain()
    return { outcome: 'unconfirmed', message: binding ? 'Renomeação não confirmada. O rascunho foi mantido. Use Recarregar do disco para conferir o vínculo antes de salvar.' : 'Não foi possível confirmar a alteração. Confira a pasta antes de tentar novamente.' }
  }
  try {
    const target = directories.mutationTarget(root, node, operation, name, active)
    if (options.openFile) {
      if (!target.source) throw new ExplorerFailure('invalid')
      const { store, binding: { id, revision } } = options.openFile
      binding = store.prepareRename(id, revision, target.source.path, target.destination, active)
    }
    const allowed = () => active() && !bound(target.parent) && !bound(target.destination) && (!target.source || (binding ? binding.valid() : !bound(target.source.path)))
    const authorize = async () => {
      if (!allowed()) throw new ExplorerFailure('stale')
      await target.authorize()
      if (!allowed()) throw new ExplorerFailure('stale')
      await binding?.validate()
      if (!allowed()) throw new ExplorerFailure('stale')
    }
    const unavailable = () => refused('A pasta mudou ou o item tem um vínculo ativo. Confira os arquivos abertos e o projeto.')
    if (!allowed()) return unavailable()
    await authorize()
    if (!allowed()) return unavailable()
    let chain: string | undefined
    if (target.source) {
      const result = await (options.move ?? moveExplorerFile)(target.source.path, target.destination, authorize, allowed, () => { possible = true })
      if (result === 'exists') return collision()
      if (result === 'denied') return refused('A renomeação foi recusada. Confira o vínculo, as permissões e a disponibilidade do PowerShell.')
      if (result !== 'moved') return unconfirmed()
      possible = true
      chain = target.source.chain
    } else {
      // Exclusive creation/nonrecursive mkdir are the collision guarantees.
      try {
        if (operation === 'create-file') {
          const file = await open(target.destination, 'wx', 0o600)
          possible = true
          try {
            if (!allowed()) return unconfirmed()
            const stat = await file.stat({ bigint: true })
            if (!stat.isFile() || stat.nlink !== 1n || stat.size !== 0n || !allowed()) return unconfirmed()
            chain = `${stat.dev}:${stat.ino}:${stat.birthtimeNs}/${target.parentChain}`
          } finally { await file.close() }
        } else {
          await mkdir(target.destination, { recursive: false }); possible = true
          if (!allowed()) return unconfirmed()
          chain = (await inspectExplorerPath(target.destination, 'directory')).chain
        }
      } catch (err) {
        if (!possible && !knownRefusal(err)) return unconfirmed()
        throw err
      }
    }
    if (!allowed()) return unconfirmed()
    if (options.afterMutation) await options.afterMutation()
    if (!allowed()) return unconfirmed()
    await target.verifyParent()
    if (!allowed()) return unconfirmed()
    const final = await inspectExplorerPath(target.destination, operation === 'create-directory' ? 'directory' : 'file')
    if (!allowed() || !final.chain.endsWith('/' + target.parentChain) || chain && chain !== final.chain) return unconfirmed()
    if (target.source) {
      try { await lstat(target.source.path); return unconfirmed() }
      catch (err) { if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') return unconfirmed() }
    }
    if (!allowed()) return unconfirmed()
    if (operation === 'create-file') {
      const stat = await lstat(target.destination, { bigint: true })
      if (!allowed() || !stat.isFile() || stat.nlink !== 1n || stat.size !== 0n ||
        final.chain !== `${stat.dev}:${stat.ino}:${stat.birthtimeNs}/${target.parentChain}`) return unconfirmed()
      const createdNode = target.registerFile(final.chain)
      return { outcome: 'confirmed', message: 'Arquivo criado.', ...(createdNode ? { createdNode } : {}) }
    }
    const renamed = await binding?.confirm()
    return { outcome: 'confirmed', message: operation === 'create-directory' ? 'Pasta criada.' : 'Arquivo renomeado.', ...(renamed ? { renamed } : {}) }
  } catch (err) {
    if (possible) return unconfirmed()
    if (err instanceof ExplorerDestinationExists || (err as NodeJS.ErrnoException)?.code === 'EEXIST') return collision()
    return refused(err instanceof ExplorerFailure ? err.message : 'A alteração foi recusada antes da confirmação. Confira a pasta e as permissões.')
  }
}
