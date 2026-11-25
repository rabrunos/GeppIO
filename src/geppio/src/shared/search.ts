import { documentToken, wellFormedText } from '@geppio/runtime/documents'
import type { DocumentResult } from '@geppio/runtime/documents'
import { REPLACE_LIMITS, validMarks, validReplacement, validSearchFilters } from './search-replacement.ts'
import type { ApplyResult, PreviewResult, ReplacementMark, SearchFilters } from './search-replacement.ts'

/** Fixed first-party operations for searching saved workspace text. */
export const SEARCH_LIMITS = { query: 256, depth: 32, children: 512, entries: 4096, fileBytes: 1024 * 1024,
  sourceBytes: 32 * 1024 * 1024, matches: 1000, resultBytes: 1024 * 1024, snippet: 240,
  chunkMatches: 100, chunkBytes: 128 * 1024, deadlineMs: 30000 } as const
export const SEARCH_EXCLUDED_DIRECTORIES = ['node_modules', 'vendor', '.venv', 'venv', 'dist', 'build', 'out', 'coverage'] as const

export interface SearchMatch {
  id: string; file: string; line: number; column: number; length: number
  snippet: string; highlightStart: number; highlightEnd: number
}
export interface SearchPage {
  job: string; status: 'running' | 'complete' | 'partial' | 'canceled' | 'failed'
  visited: number; files: number; skipped: number; bytes: number; found: number
  items: SearchMatch[]; next: number; more: boolean; reason?: string
}
export type SearchResult = { ok: true; value: SearchPage } | { ok: false; error: string; expired?: true }
export type SearchOpenResult = DocumentResult & { matchesSnapshot?: boolean; expired?: true }
export interface SearchBridge {
  start(root: string, query: string, matchCase: boolean, filters?: SearchFilters): Promise<SearchResult>
  read(job: string, offset: number): Promise<SearchResult>
  cancel(job: string): Promise<SearchResult>
  open(job: string, match: string): Promise<SearchOpenResult>
  preview(job: string, matches: string[], replacement: string, marks: ReplacementMark[]): Promise<PreviewResult>
  applyFile(job: string, preview: string, file: string, marks: ReplacementMark[]): Promise<ApplyResult>
}
export const validSearchQuery = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= SEARCH_LIMITS.query
  && wellFormedText(value) && !/[\p{Cc}\u2028\u2029]/u.test(value)
export function validSearchRequest(operation: string, args: readonly unknown[]): boolean {
  if (!documentToken(args[0])) return false
  switch (operation) {
    case 'start': return (args.length === 3 || args.length === 4 && validSearchFilters(args[3])) && validSearchQuery(args[1]) && typeof args[2] === 'boolean'
    case 'preview': return args.length === 4 && Array.isArray(args[1]) && args[1].length > 0 && args[1].length <= REPLACE_LIMITS.matches &&
      args[1].every(documentToken) && new Set(args[1]).size === args[1].length && validReplacement(args[2]) && validMarks(args[3])
    case 'applyFile': return args.length === 4 && documentToken(args[1]) && documentToken(args[2]) && validMarks(args[3])
    case 'read': return args.length === 2 && Number.isSafeInteger(args[1]) && (args[1] as number) >= 0 && (args[1] as number) <= SEARCH_LIMITS.matches
    case 'cancel': return args.length === 1
    case 'open': return args.length === 2 && documentToken(args[1])
    default: return false
  }
}

/** Unicode simple case folding preserves the source indices. Match literal text
 * without normalization, treating CR, LF and CRLF as Monaco line boundaries. */
export function* searchText(text: string, query: string, matchCase: boolean): Generator<Omit<SearchMatch, 'id' | 'file'>> {
  if (!validSearchQuery(query)) return
  const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu')
  const breaks = /\r\n|[\r\n]/g
  let line = 1, lineStart = 0, nextBreak = breaks.exec(text)
  for (const occurrence of text.matchAll(literal)) {
    const offset = occurrence.index!, length = occurrence[0].length
    while (nextBreak && nextBreak.index < offset) { line++; lineStart = breaks.lastIndex; nextBreak = breaks.exec(text) }
    const lineEnd = nextBreak?.index ?? text.length
    const context = Math.max(0, Math.floor((SEARCH_LIMITS.snippet - length) / 2))
    let left = Math.max(lineStart, Math.min(offset - context, lineEnd - SEARCH_LIMITS.snippet))
    if (left > lineStart && /[\udc00-\udfff]/.test(text[left]!)) left++
    let right = Math.min(lineEnd, left + SEARCH_LIMITS.snippet)
    if (right < lineEnd && /[\ud800-\udbff]/.test(text[right - 1]!)) right--
    yield { line, column: offset - lineStart + 1, length, snippet: text.slice(left, right),
      highlightStart: offset - left, highlightEnd: Math.min(offset + length, right) - left }
  }
}
