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
export interface TabArrangement<T extends string | number> {
  split: boolean; active: 0 | 1; sides: [T[], T[]]; selected: [T | null, T | null]; pinned: T[]
}
export interface WorkspaceEditor { active: string | null; tabs: WorkspaceView[]; arrangement?: TabArrangement<string> }
export interface WorkspaceStatus { root: ExplorerNode | null; remember: boolean; recovery: { name: string; tabs: number; unsaved: number } | null; error: string | null; notice?: string | null }
export type WorkspaceResult = { ok: true; value: WorkspaceStatus; canceled?: boolean; documents?: DocumentResult; arrangement?: TabArrangement<string>; views?: { id: string; language: DocumentLanguage | null; selection: WorkspaceSelection }[] } | { ok: false; error: string; value?: WorkspaceStatus }
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
export function validWorkspaceView(tab: unknown): tab is WorkspaceView {
  return isRecord(tab) && exactKeys(tab, ['id', 'revision', 'dirty', 'language', 'selection']) && documentToken(tab.id) && documentToken(tab.revision) && typeof tab.dirty === 'boolean' && validWorkspaceLanguage(tab.language) && validWorkspaceSelection(tab.selection)
}
export function validTabArrangement<T extends string | number>(value: unknown, available: readonly T[]): value is TabArrangement<T> {
  if (!isRecord(value) || !exactKeys(value, ['split', 'active', 'sides', 'selected', 'pinned']) || typeof value.split !== 'boolean' ||
      value.active !== 0 && value.active !== 1 || !Array.isArray(value.sides) || value.sides.length !== 2 ||
      !Array.isArray(value.selected) || value.selected.length !== 2) return false
  const distinct = (items: unknown): items is T[] => Array.isArray(items) && items.length <= DOCUMENT_SESSION_LIMITS.count &&
    Array.from(items).every(item => available.includes(item)) && new Set(items).size === items.length
  const [left, right] = value.sides
  return distinct(left) && distinct(right) && distinct(value.pinned) && (value.split || value.active === 0 && !right.length) &&
    available.every(id => left.includes(id) || right.includes(id)) &&
    [left, right].every((side, index) => side.length ? side.includes((value.selected as T[])[index]!) : (value.selected as unknown[])[index] === null)
}
export function mapTabArrangement<A extends string | number, B extends string | number>(input: TabArrangement<A>, mapping: ReadonlyMap<A, B>, all: readonly B[]): TabArrangement<B> {
  const map = (ids: A[]) => ids.flatMap(id => mapping.has(id) ? [mapping.get(id)!] : [])
  const sides: [B[], B[]] = [map(input.sides[0]), map(input.sides[1])]
  for (const id of all) if (!sides.some(group => group.includes(id))) sides[input.active].push(id)
  const selected = (side: 0 | 1) => {
    const source = input.selected[side], id = source === null ? undefined : mapping.get(source)
    return id ?? sides[side][0] ?? null
  }
  return { active: input.active, split: input.split, sides, selected: [selected(0), selected(1)], pinned: map(input.pinned) }
}
export function validWorkspaceEditor(value: unknown): value is WorkspaceEditor {
  if (!isRecord(value) || !exactKeys(value, 'arrangement' in value ? ['active', 'tabs', 'arrangement'] : ['active', 'tabs']) || !Array.isArray(value.tabs) || value.tabs.length > DOCUMENT_SESSION_LIMITS.count) return false
  if (!Array.from(value.tabs).every(validWorkspaceView)) return false
  const ids = value.tabs.map(tab => tab.id)
  return new Set(ids).size === ids.length && (value.active === null || documentToken(value.active) && ids.includes(value.active)) &&
    (!('arrangement' in value) || validTabArrangement(value.arrangement, ids) && value.arrangement.selected[value.arrangement.active] === value.active)
}
export function validWorkspaceRequest(operation: string, args: readonly unknown[]): boolean {
  if (operation === 'readTools') return args.length === 1 && documentToken(args[0])
  if (['read', 'restore', 'standalone', 'forget'].includes(operation)) return args.length === 0
  if (operation === 'configure') return args.length === 1 && typeof args[0] === 'boolean'
  return operation === 'remember' && args.length === 1 && validWorkspaceEditor(args[0])
}
