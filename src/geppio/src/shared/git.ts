import { documentToken } from '@geppio/runtime/documents'

/** First-party only. No command, path, options or executable input. */
export const GIT_LIMITS = { entries: 512, output: 512 * 1024, text: 256 * 1024, metadata: 64 * 1024 * 1024, nodes: 20000, timeout: 15000 } as const
export const GIT_HISTORY_LIMITS = { page: 50, commits: 500, commitBytes: 64 * 1024, files: 512, pageBytes: 512 * 1024, retainedBytes: 2 * 1024 * 1024 } as const
export interface GitChange { id: string; name: string; previous?: string; index: string; working: string; conflict: boolean; untracked: boolean; stage?: boolean; unstage?: boolean; actionReason?: string }
export interface GitStatus { root: string; name: string; branch: string; detached: boolean; changes: GitChange[] }
export interface GitComparison { name: string; original: string; modified: string; basis: string }
export interface GitHistorySummary { id: string; hash: string; author: string; date: string; subject: string }
export interface GitHistoryPage {
  snapshot: string
  commits: GitHistorySummary[]
  cursor: string | null
  detached: boolean
  unborn: boolean
  limited: boolean
}
export interface GitHistoryFile { id: string; name: string; status: string }
export interface GitHistoryCommit extends GitHistorySummary {
  message: string
  parents: string[]
  files: GitHistoryFile[]
}
export type GitError = 'invalid' | 'stale' | 'busy' | 'unsupported' | 'limit' | 'unavailable' | 'missing' | 'not-repository' | 'version' | 'timeout' | 'uncertain'
export type GitResult = { ok: true; status?: GitStatus; comparison?: GitComparison; mutated?: boolean; history?: GitHistoryPage; commit?: GitHistoryCommit } | { ok: false; code: GitError; error: string }
export interface GitBridge {
  status(root: string): Promise<GitResult>
  compare(root: string, change: string): Promise<GitResult>
  stage(root: string, change: string): Promise<GitResult>
  unstage(root: string, change: string): Promise<GitResult>
  history(root: string): Promise<GitResult>
  historyPage(root: string, snapshot: string, cursor: string): Promise<GitResult>
  historyCommit(root: string, snapshot: string, commit: string): Promise<GitResult>
  historyCompare(root: string, snapshot: string, commit: string, file: string): Promise<GitResult>
}
export const gitOperations = ['status', 'compare', 'stage', 'unstage', 'history', 'historyPage', 'historyCommit', 'historyCompare'] as const
export type GitOperation = typeof gitOperations[number]
const gitArity: Record<GitOperation, number> = { status: 1, compare: 2, stage: 2, unstage: 2, history: 1, historyPage: 3, historyCommit: 3, historyCompare: 4 }
export function validGitRequest(operation: string, args: readonly unknown[]): boolean {
  return Object.hasOwn(gitArity, operation) && args.length === gitArity[operation as GitOperation] && args.every(documentToken)
}
