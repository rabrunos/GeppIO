import { documentToken } from './documents.ts'

/** First-party only. No command, path, options or executable input. */
export const GIT_LIMITS = { entries: 512, output: 512 * 1024, text: 256 * 1024, metadata: 64 * 1024 * 1024, nodes: 20000, timeout: 15000 } as const
export interface GitChange { id: string; name: string; previous?: string; index: string; working: string; conflict: boolean; untracked: boolean; stage?: boolean; unstage?: boolean; actionReason?: string }
export interface GitStatus { root: string; name: string; branch: string; detached: boolean; changes: GitChange[] }
export interface GitComparison { name: string; original: string; modified: string; basis: string }
export type GitError = 'invalid' | 'stale' | 'busy' | 'unsupported' | 'limit' | 'unavailable' | 'missing' | 'timeout' | 'uncertain'
export type GitResult = { ok: true; status?: GitStatus; comparison?: GitComparison; mutated?: boolean } | { ok: false; code: GitError; error: string }
export interface GitBridge {
  status(root: string): Promise<GitResult>
  compare(root: string, change: string): Promise<GitResult>
  stage(root: string, change: string): Promise<GitResult>
  unstage(root: string, change: string): Promise<GitResult>
}
export function validGitRequest(operation: string, args: readonly unknown[]): boolean {
  return operation === 'status' ? args.length === 1 && documentToken(args[0]) : ['compare', 'stage', 'unstage'].includes(operation) && args.length === 2 && args.every(documentToken)
}
