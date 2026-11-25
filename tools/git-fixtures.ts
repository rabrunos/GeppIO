import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { link, lstat, mkdir, opendir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gitEnvironment, resolveGitExecutable } from '../src/geppio/src/main/git.ts'

/** Fixture setup/verifier only, never application code. Keep verification itself
 * from executing the malicious fsmonitor/hooks deliberately stored by tests. */
export async function fixtureGit(root: string): Promise<(args: string[]) => string> {
  const executable = await resolveGitExecutable()
  return args => execFileSync(executable, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + join(root, '.git', 'geppio-fixture-no-hooks'), ...args], { cwd: root, env: gitEnvironment(root), encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}
export async function initializeGit(root: string) {
  await mkdir(root, { recursive: true })
  const git = await fixtureGit(root)
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Disposable Test']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'core.autocrlf', 'false'])
  for (const name of ['modified.ts', 'deleted.txt', 'rename old.txt', 'both.txt', 'binary.dat', 'large.txt', 'café 😀.txt']) await writeFile(join(root, name), name === 'binary.dat' ? Buffer.from([0, 255]) : name === 'modified.ts' ? 'const answer = 1;\r\n' : name === 'deleted.txt' ? 'unique deleted content\n' : 'before\n')
  git(['add', '.']); git(['commit', '-m', 'Disposable fixture'])
  return git
}
/** pnpm-shaped and arbitrary ignored trees, with only disposable destinations. */
export async function ignoredGitTrees(root: string, outside: string) {
  await mkdir(outside, { recursive: true }); await writeFile(join(outside, 'outside-sentinel.txt'), 'outside fixture\n')
  for (const name of ['node_modules', 'vendor-cache', '.local']) {
    const directory = join(root, name); await mkdir(directory, { recursive: true })
    await symlink(outside, join(directory, 'linked-package'), 'junction')
    await link(join(outside, 'outside-sentinel.txt'), join(directory, 'hardlinked-package.txt'))
  }
  let deep = join(root, 'vendor-cache')
  for (let i = 0; i < 36; i++) { deep = join(deep, 'd'); await mkdir(deep) }
  await writeFile(join(deep, 'beyond-worktree-depth.txt'), 'ignored\n')
  await writeFile(join(root, '.gitignore'), 'node_modules/\nvendor-cache/\n.local/\n')
}
/** Detect byte or modification-time writes anywhere, including index/config/refs and working files. */
export async function gitFingerprint(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  const visit = async (path: string, prefix: string) => {
    for await (const item of await opendir(path)) {
      const file = join(path, item.name), name = prefix + item.name, stat = await lstat(file, { bigint: true })
      if (stat.isSymbolicLink()) result[name] = `${stat.ino}:${stat.mtimeNs}:link:` + createHash('sha256').update(await readlink(file)).digest('hex')
      else if (stat.isDirectory()) await visit(file, name + '/')
      else result[name] = `${stat.ino}:${stat.mtimeNs}:${stat.size}:` + createHash('sha256').update(await readFile(file)).digest('hex')
    }
  }
  await visit(root, '')
  return result
}
