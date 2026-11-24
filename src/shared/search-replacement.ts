import { DOCUMENT_SESSION_LIMITS, documentToken, wellFormedText } from './documents.ts'
import type { DocumentSnapshot } from './documents.ts'

export const REPLACE_LIMITS = { files: 100, matches: 1000, replacement: 1024 } as const
export interface SearchFilters { path: string; extensions: string }
export const emptySearchFilters: SearchFilters = { path: '', extensions: '' }
export function validSearchFilters(value: unknown): value is SearchFilters {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'extensions,path') return false
  const { path, extensions } = value as SearchFilters
  if (typeof path !== 'string' || path.length > 512 || !wellFormedText(path) || typeof extensions !== 'string' || extensions.length > 128) return false
  const parts = path.replace(/\/$/, '').split('/')
  return (!path || parts.length <= 32 && parts.every(part => part && part !== '.' && part !== '..' && !/[\\:*?"<>|\p{Cc}]/u.test(part)))
    && (!extensions || extensions.split(',').length <= 12 && extensions.split(',').every(ext => /^[a-z0-9_-]{1,16}$/i.test(ext.trim())))
}
export function includedByFilters(file: string, filters: SearchFilters) {
  if (filters.path && !(filters.path.endsWith('/') ? file.startsWith(filters.path) : file === filters.path)) return false
  if (!filters.extensions) return true
  const name = file.slice(file.lastIndexOf('/') + 1), dot = name.lastIndexOf('.')
  return dot > 0 && filters.extensions.split(',').some(ext => ext.trim().toLowerCase() === name.slice(dot + 1).toLowerCase())
}
export interface ReplacementMark { id: string; revision: string; clean: boolean }
export type ReplacementDocument = Pick<ReplacementMark, 'id' | 'revision'>
export interface ReplacementFile { id: string; file: string; matches: number; open: ReplacementDocument | null; excluded?: string }
export interface ReplacementPreview { id: string; files: ReplacementFile[]; partial: boolean }
export type PreviewResult = { ok: true; preview: ReplacementPreview } | { ok: false; error: string }
export type ApplyResult = { ok: true; document: DocumentSnapshot | null; notice?: string } | { ok: false; error: string; uncertain?: true }
export function validReplacement(value: unknown): value is string {
  return typeof value === 'string' && value.length <= REPLACE_LIMITS.replacement && wellFormedText(value) && !/[\p{Cc}\u2028\u2029]/u.test(value)
}
export function validMarks(value: unknown): value is ReplacementMark[] {
  return Array.isArray(value) && value.length <= DOCUMENT_SESSION_LIMITS.count && value.every(mark =>
    mark && typeof mark === 'object' && Object.keys(mark).sort().join(',') === 'clean,id,revision' &&
    documentToken(mark.id) && documentToken(mark.revision) && typeof mark.clean === 'boolean') && new Set(value.map(mark => mark.id)).size === value.length
}

/** Positions come from an immutable search witness, in source order. */
export function replacePositions(text: string, positions: readonly { line: number; column: number; length: number }[], replacement: string) {
  const breaks = /\r\n|\r|\n/g, chunks: string[] = []
  let line = 1, start = 0, consumed = 0
  for (const position of positions) {
    while (line < position.line) {
      if (!breaks.exec(text)) throw new RangeError('Invalid saved search line')
      line++; start = breaks.lastIndex
    }
    const offset = start + position.column - 1
    if (offset < consumed || offset + position.length > text.length) throw new RangeError('Invalid saved search span')
    chunks.push(text.slice(consumed, offset), replacement)
    consumed = offset + position.length
  }
  chunks.push(text.slice(consumed))
  return chunks.join('')
}
