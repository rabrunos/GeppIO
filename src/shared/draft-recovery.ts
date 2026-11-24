import { DOCUMENT_SESSION_LIMITS, documentToken, validDraft } from './documents.ts'
import type { DocumentDraft, DocumentResult } from './documents.ts'

export interface RecoveryChoice { key: string; name: string; bom: boolean }
export interface RecoveryStatus { epoch: string; enabled: boolean; choices: RecoveryChoice[]; error: string | null; staleIds?: string[] }
export interface RecoveryBridge {
  read(): Promise<RecoveryStatus>
  snapshot(epoch: string, sequence: number, drafts: DocumentDraft[]): Promise<RecoveryStatus>
  restore(epoch: string, key: string): Promise<{ result: DocumentResult; text?: string }>
  configure(epoch: string, enabled: boolean): Promise<RecoveryStatus>
  clear(epoch: string): Promise<RecoveryStatus>
}
export const recoveryOperations = ['read', 'snapshot', 'restore', 'configure', 'clear'] as const
export function validRecoveryRequest(operation: typeof recoveryOperations[number], args: unknown[]) {
  if (operation === 'read') return !args.length
  if (!documentToken(args[0])) return false
  if (operation === 'clear') return args.length === 1
  if (operation === 'configure') return args.length === 2 && typeof args[1] === 'boolean'
  if (operation === 'restore') return args.length === 2 && documentToken(args[1])
  const drafts = args[2]
  return args.length === 3 && Number.isSafeInteger(args[1]) && Number(args[1]) > 0 && Array.isArray(drafts) &&
    drafts.length > 0 && drafts.length <= DOCUMENT_SESSION_LIMITS.count && drafts.every(draft => validDraft(draft)) &&
    new Set(drafts.map(draft => draft.id)).size === drafts.length
}
