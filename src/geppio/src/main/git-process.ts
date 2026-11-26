import { spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspectExplorerPath } from './explorer.ts'
import { GIT_LIMITS } from '../shared/git.ts'
import type { GitError } from '../shared/git.ts'
import { GitFailure } from './git-failure.ts'

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
