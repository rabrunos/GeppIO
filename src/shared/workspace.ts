import { DOCUMENT_LIMIT, DOCUMENT_SESSION_LIMITS, documentToken } from './documents.ts'
import type { DocumentResult } from './documents.ts'
import { DOCUMENT_LANGUAGES } from './document-status.ts'
import type { DocumentLanguage } from './document-status.ts'
import type { ExplorerNode } from './explorer.ts'
import type { WorkspaceToolsResult } from './workspace-tools.ts'
import { exactKeys } from './plugin-data.ts'
import { isRecord } from './plugins.ts'

export interface WorkspaceSelection { start: number; end: number; top: number; left: number }
export interface WorkspaceView { id: string; revision: string; dirty: boolean; language: DocumentLanguage | null; selection: WorkspaceSelection }
export interface WorkspaceEditor { active: string | null; tabs: WorkspaceView[] }
export interface WorkspaceStatus { root: ExplorerNode | null; remember: boolean; recovery: { name: string; tabs: number; unsaved: number } | null; error: string | null; notice?: string | null }
export type WorkspaceResult = { ok: true; value: WorkspaceStatus; canceled?: boolean; documents?: DocumentResult; views?: { id: string; language: DocumentLanguage | null; selection: WorkspaceSelection }[] } | { ok: false; error: string; value?: WorkspaceStatus }
/** App-only operations. No native path, source text, command or Worker facade. */
export interface WorkspaceBridge {
  read(): Promise<WorkspaceResult>
  readTools(root: string): Promise<WorkspaceToolsResult>
  restore(): Promise<WorkspaceResult>
  standalone(): Promise<WorkspaceResult>
  configure(remember: boolean): Promise<WorkspaceResult>
  forget(): Promise<WorkspaceResult>
  remember(editor: WorkspaceEditor): Promise<WorkspaceResult>
}
export function validWorkspaceSelection(value: unknown): value is WorkspaceSelection {
  return isRecord(value) && exactKeys(value, ['start', 'end', 'top', 'left'])
    && ['start', 'end'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= DOCUMENT_LIMIT)
    && ['top', 'left'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 10_000_000)
}
export const validWorkspaceLanguage = (value: unknown): value is DocumentLanguage | null => value === null || DOCUMENT_LANGUAGES.includes(value as DocumentLanguage)
export function validWorkspaceEditor(value: unknown): value is WorkspaceEditor {
  if (!isRecord(value) || !exactKeys(value, ['active', 'tabs']) || !Array.isArray(value.tabs) || value.tabs.length > DOCUMENT_SESSION_LIMITS.count) return false
  if (!value.tabs.every(tab => isRecord(tab) && exactKeys(tab, ['id', 'revision', 'dirty', 'language', 'selection']) && documentToken(tab.id) && documentToken(tab.revision) && typeof tab.dirty === 'boolean' && validWorkspaceLanguage(tab.language) && validWorkspaceSelection(tab.selection))) return false
  return new Set(value.tabs.map(tab => tab.id)).size === value.tabs.length && (value.active === null || documentToken(value.active) && value.tabs.some(tab => tab.id === value.active))
}
export function validWorkspaceRequest(operation: string, args: readonly unknown[]): boolean {
  if (operation === 'readTools') return args.length === 1 && documentToken(args[0])
  if (['read', 'restore', 'standalone', 'forget'].includes(operation)) return args.length === 0
  if (operation === 'configure') return args.length === 1 && typeof args[0] === 'boolean'
  return operation === 'remember' && args.length === 1 && validWorkspaceEditor(args[0])
}
