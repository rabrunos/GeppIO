import { documentToken, validDraft } from './documents.ts'
import type { DocumentDraft, DocumentResult } from './documents.ts'

/** App-only navigation contract; deliberately absent from the plugin SDK. */
export const EXPLORER_LIMITS = { entries: 512, depth: 32, nodes: 4096, name: 255, bytes: 256 * 1024 } as const
export interface ExplorerNode { id: string; name: string; kind: 'directory' | 'file' | 'blocked' }
export type ExplorerError = 'invalid' | 'stale' | 'busy' | 'unsupported' | 'limit' | 'unavailable'
export type ExplorerResult = { ok: true; root: ExplorerNode | null; children?: ExplorerNode[]; canceled?: boolean } | { ok: false; code: ExplorerError; error: string }
export interface ExplorerBridge {
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
