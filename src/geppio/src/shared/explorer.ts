import { documentToken, validDraft } from '@geppio/runtime/documents'
import type { DocumentDraft, DocumentResult, DocumentSnapshot } from '@geppio/runtime/documents'
import { validWorkspaceView } from './workspace.ts'
import type { WorkspaceView } from './workspace.ts'

/** App-only navigation contract; deliberately absent from the plugin SDK. */
export const EXPLORER_LIMITS = { entries: 512, depth: 32, nodes: 4096, name: 255, bytes: 256 * 1024 } as const
export function safeExplorerName(name: string): boolean {
  return !!name && name.length <= EXPLORER_LIMITS.name && ![...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && !/[/\\:<>"|?*\ud800-\udfff]/u.test(name)
    && !/[. ]$/.test(name) && !/^(\.|\.\.|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) && !/~\d/.test(name)
}
export interface ExplorerNode { id: string; name: string; kind: 'directory' | 'file' | 'blocked' }
export const explorerMutations = ['create-file', 'create-directory', 'rename-file'] as const
export type ExplorerMutation = typeof explorerMutations[number]
export type ExplorerMutationResult =
  | { outcome: 'confirmed'; message: string; createdNode?: string; renamed?: DocumentSnapshot }
  | { outcome: 'unconfirmed' | 'refused'; message: string; createdNode?: never }
export const validExplorerBasename = (name: unknown): name is string => typeof name === 'string' && safeExplorerName(name)
  && name.toLowerCase() !== '.git' && !/^(?:conin\$|conout\$|con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(name)
export type RenameBinding = Pick<DocumentSnapshot, 'id' | 'revision'>
export function validExplorerMutationRequest(args: readonly unknown[], operation?: ExplorerMutation) {
  if (!documentToken(args[0]) || !documentToken(args[1]) || !validExplorerBasename(args[2])) return false
  if (args.length === 3) return true
  return operation === 'rename-file' && args.length === 4 && validWorkspaceView(args[3])
}
export type ExplorerError = 'invalid' | 'stale' | 'busy' | 'unsupported' | 'limit' | 'unavailable'
export type ExplorerResult = { ok: true; root: ExplorerNode | null; children?: ExplorerNode[]; canceled?: boolean } | { ok: false; code: ExplorerError; error: string }
export interface ExplorerBridge {
  createFile(root: string, node: string, name: string): Promise<ExplorerMutationResult>
  createDirectory(root: string, node: string, name: string): Promise<ExplorerMutationResult>
  renameFile(root: string, node: string, name: string, binding?: WorkspaceView): Promise<ExplorerMutationResult>
  select(): Promise<ExplorerResult>
  list(root: string, node: string): Promise<ExplorerResult>
  release(root: string): Promise<ExplorerResult>
  open(root: string, node: string, draft: DocumentDraft | null): Promise<DocumentResult>
}
export function validExplorerRequest(operation: string, args: readonly unknown[]): boolean {
  if (operation === 'select') return args.length === 0
  if (operation === 'release') return args.length === 1 && documentToken(args[0])
  if (operation === 'list') return args.length === 2 && args.every(documentToken)
  return operation === 'open' && args.length === 3 && documentToken(args[0]) && documentToken(args[1]) && (args[2] === null || validDraft(args[2]))
}
