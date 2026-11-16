import { editorText } from './documents.ts'

export interface DocumentTextChange { rangeOffset: number; rangeLength: number; text: string }
export const DOCUMENT_HISTORY_LIMITS = { bytes: 96 * 1024 * 1024, versions: 20000 } as const
/** Accepted edit-text/EOL metadata ledger, not a claim about Monaco/OS heap overhead. */
export class DocumentHistoryBudget {
  private entries = new Map<string, { bytes: number; versions: number }>()
  private total = 0
  private bytes: number
  private versions: number
  constructor(bytes: number = DOCUMENT_HISTORY_LIMITS.bytes, versions: number = DOCUMENT_HISTORY_LIMITS.versions) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(versions) || versions < 1) throw new Error('Invalid history budget')
    this.bytes = bytes; this.versions = versions
  }
  fits(id: string, bytes: number): boolean { return Number.isSafeInteger(bytes) && bytes >= 0 && this.total + bytes <= this.bytes && (this.entries.get(id)?.versions ?? 0) < this.versions }
  retain(id: string, bytes: number): boolean {
    if (!this.fits(id, bytes)) return false
    const before = this.entries.get(id) ?? { bytes: 0, versions: 0 }
    this.entries.set(id, { bytes: before.bytes + bytes, versions: before.versions + 1 }); this.total += bytes; return true
  }
  release(id: string) { this.total -= this.entries.get(id)?.bytes ?? 0; this.entries.delete(id) }
}
/** Apply simultaneous LF-model edits to exact UTF-8 source text; untouched EOL tokens survive. */
export function applyDocumentChanges(previous: string, changes: readonly DocumentTextChange[], fallbackNewline = '\n'): string {
  const offsets = [0]
  for (let i = 0; i < previous.length; i++) { if (previous[i] === '\r' && previous[i + 1] === '\n') i++; offsets.push(i + 1) }
  const newline = previous.match(/\r\n|\r|\n/)?.[0] ?? fallbackNewline
  let result = previous, end = offsets.length - 1
  for (const change of [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
    const { rangeOffset: start, rangeLength: length } = change
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > end) throw new Error('Invalid editor change range')
    result = result.slice(0, offsets[start]) + editorText(change.text).replaceAll('\n', newline) + result.slice(offsets[start + length])
    end = start
  }
  return result
}
