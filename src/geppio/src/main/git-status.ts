import { randomUUID } from 'node:crypto'
import { safeExplorerName } from './explorer.ts'
import { GIT_LIMITS } from '../shared/git.ts'
import type { GitChange } from '../shared/git.ts'
import { GitFailure } from './git-failure.ts'

export const decodeGitText = (bytes: Buffer) => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new GitFailure('unsupported') } }
export function gitRelativeName(name: string): boolean {
  return name.length <= 2048 && name.split('/').length <= 32 && name.split('/').every(part => safeExplorerName(part) && part.toLowerCase() !== '.git')
}
/** NUL records preserve spaces/Unicode and rename ordering; unsupported names fail closed. */
export function parseGitStatus(bytes: Buffer): GitChange[] {
  const records = decodeGitText(bytes).split('\0'), changes: GitChange[] = []
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
