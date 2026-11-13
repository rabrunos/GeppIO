/** App-owned, single-document contract. Never part of the Worker/plugin SDK. */
export const DOCUMENT_LIMIT = 1024 * 1024
export interface DocumentSnapshot { id: string; revision: string; name: string; text: string; bom: boolean }
export interface DocumentDraft { id: string; revision: string; text: string }
export type DocumentError = 'invalid' | 'stale' | 'busy' | 'unsupported' | 'oversized' | 'unavailable' | 'conflict' | 'write'
export type DocumentResult = { ok: true; document: DocumentSnapshot | null; canceled?: boolean } | { ok: false; code: DocumentError; error: string; confirmed?: DocumentSnapshot }
export interface DocumentBridge {
  open(draft: DocumentDraft | null): Promise<DocumentResult>
  save(draft: DocumentDraft): Promise<DocumentResult>
  release(draft: DocumentDraft): Promise<DocumentResult>
  close(ticket: string, draft: DocumentDraft | null): Promise<DocumentResult>
  onCloseRequested(listener: (ticket: string) => void): () => void
}
export const documentToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
export const wellFormedText = (value: string) => !/[\ud800-\udfff]/u.test(value)
export function validDraft(value: unknown): value is DocumentDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const draft = value as DocumentDraft
  return Object.keys(draft).sort().join(',') === 'id,revision,text' && documentToken(draft.id) && documentToken(draft.revision)
    && typeof draft.text === 'string' && draft.text.length <= DOCUMENT_LIMIT && wellFormedText(draft.text)
}
export function validDocumentRequest(operation: string, args: readonly unknown[]): boolean {
  if (operation === 'close') return args.length === 2 && documentToken(args[0]) && (args[1] === null || validDraft(args[1]))
  return args.length === 1 && (operation === 'open' && args[0] === null || ['open', 'save', 'release'].includes(operation) && validDraft(args[0]))
}
export const editorText = (text: string) => text.replace(/\r\n?/g, '\n')
/** Textarea normalizes newlines. Preserve original bytes in unchanged spans, including mixed EOLs. */
export function applyEditorText(previous: string, next: string): string {
  const old = editorText(previous)
  if (old === next) return previous
  let start = 0, end = old.length, nextEnd = next.length
  while (start < end && start < nextEnd && old[start] === next[start]) start++
  while (end > start && nextEnd > start && old[end - 1] === next[nextEnd - 1]) { end--; nextEnd-- }
  const offsets = [0]
  for (let i = 0; i < previous.length; i++) { if (previous[i] === '\r' && previous[i + 1] === '\n') i++; offsets.push(i + 1) }
  const newline = previous.match(/\r\n|\r|\n/)?.[0] ?? '\n'
  return previous.slice(0, offsets[start]) + next.slice(start, nextEnd).replaceAll('\n', newline) + previous.slice(offsets[end])
}
