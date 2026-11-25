import { documentToken } from '@geppio/runtime/documents'
import type { DocumentResult } from '@geppio/runtime/documents'
import { SEARCH_LIMITS, validSearchQuery } from './search.ts'

export const QUICK_OPEN_LIMITS = { query: SEARCH_LIMITS.query, results: 200, metadataBytes: 1024 * 1024 } as const
export const validQuickOpenQuery = validSearchQuery
export interface QuickOpenItem { id: string; file: string }
export interface QuickOpenPage {
  job: string; status: 'running' | 'complete' | 'partial' | 'failed'
  visited: number; skipped: number; total: number; items: QuickOpenItem[]; truncated: boolean
}
export type QuickOpenError = { ok: false; error: string; expired?: true }
export type QuickOpenResult = { ok: true; value: QuickOpenPage } | QuickOpenError
export type QuickOpenCancelResult = { ok: true } | QuickOpenError
export interface QuickOpenBridge {
  start(root: string, query: string): Promise<QuickOpenResult>
  read(job: string, query: string): Promise<QuickOpenResult>
  cancel(job: string): Promise<QuickOpenCancelResult>
  open(job: string, id: string): Promise<DocumentResult & { expired?: true }>
}
export function validQuickOpenRequest(operation: string, args: readonly unknown[]) {
  if (!documentToken(args[0])) return false
  switch (operation) {
    case 'start':
    case 'read': return args.length === 2 && validQuickOpenQuery(args[1])
    case 'cancel': return args.length === 1
    case 'open': return args.length === 2 && documentToken(args[1])
    default: return false
  }
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
/** Locale-independent ordering. Only the relative display name and opaque ID cross the bridge. */
export function rankQuickOpen(items: readonly QuickOpenItem[], query: string) {
  if (!validQuickOpenQuery(query)) return { items: [], truncated: false }
  // Use the same Unicode simple folding as content search. All metacharacters
  // in the supplied text are literal. No match offsets are exposed.
  const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
  const hits: { item: QuickOpenItem; folded: string; rank: number }[] = []
  for (const item of items) {
    const folded = item.file.toLowerCase()
    const basename = item.file.slice(item.file.lastIndexOf('/') + 1)
    const offset = basename.search(literal)
    if (offset < 0 && !literal.test(item.file)) continue
    const rank = offset === 0 ? 0 : offset > 0 ? 1 : 2
    hits.push({ item, folded, rank })
  }
  hits.sort((a, b) => a.rank - b.rank || compare(a.folded, b.folded) || compare(a.item.file, b.item.file))
  return { items: hits.slice(0, QUICK_OPEN_LIMITS.results).map(({ item }) => ({ id: item.id, file: item.file })),
    truncated: hits.length > QUICK_OPEN_LIMITS.results }
}
