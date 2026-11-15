import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, opendir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gitEnvironment, resolveGitExecutable } from '../src/main/git.ts'

/** Mutations are exclusively fixture setup; never used by application production code. */
export async function fixtureGit(root: string): Promise<(args: string[]) => string> {
  const executable = await resolveGitExecutable()
  return args => execFileSync(executable, args, { cwd: root, env: gitEnvironment(root), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}
export async function initializeGit(root: string) {
  await mkdir(root, { recursive: true })
  const git = await fixtureGit(root)
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Disposable Test']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false'])
  for (const name of ['modified.ts', 'deleted.txt', 'rename old.txt', 'both.txt', 'binary.dat', 'large.txt', 'café 😀.txt']) await writeFile(join(root, name), name === 'binary.dat' ? Buffer.from([0, 255]) : name === 'modified.ts' ? 'const answer = 1;\r\n' : 'before\n')
  git(['add', '.']); git(['commit', '-m', 'Disposable fixture'])
  return git
}
/** Detect byte or modification-time writes anywhere, including index/config/refs and working files. */
export async function gitFingerprint(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const visit = async (path: string, prefix: string) => {
    for await (const item of await opendir(path)) {
      const file = join(path, item.name), name = prefix + item.name, stat = await lstat(file, { bigint: true })
      if (stat.isDirectory()) await visit(file, name + '/')
      else result[name] = `${stat.ino}:${stat.mtimeNs}:${stat.size}:` + createHash('sha256').update(await readFile(file)).digest('hex')
    }
  }
  await visit(root, '')
  return result
}
