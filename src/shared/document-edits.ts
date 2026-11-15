import { editorText } from './documents.ts'

export interface DocumentTextChange { rangeOffset: number; rangeLength: number; text: string }
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
