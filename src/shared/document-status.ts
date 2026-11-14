import { editorText } from './documents.ts'
export const DOCUMENT_LANGUAGES = ['Texto simples', 'JSON', 'TypeScript', 'JavaScript', 'Markdown', 'CSS', 'HTML'] as const
export type DocumentLanguage = typeof DOCUMENT_LANGUAGES[number]
export function documentLanguage(name: string): DocumentLanguage {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'json') return 'JSON'
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext ?? '')) return 'TypeScript'
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext ?? '')) return 'JavaScript'
  if (ext === 'md') return 'Markdown'
  if (ext === 'css') return 'CSS'
  if (ext === 'html' || ext === 'htm') return 'HTML'
  return 'Texto simples'
}
export function documentEOL(text: string): string {
  const kinds = new Set<string>()
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') { if (text[i + 1] === '\n') { kinds.add('\r\n'); i++ } else kinds.add('\r') }
    else if (text[i] === '\n') kinds.add('\n')
    if (kinds.size > 1) return 'Misto'
  }
  return kinds.size > 1 ? 'Misto' : kinds.has('\r\n') ? 'CRLF' : kinds.has('\r') ? 'CR' : kinds.has('\n') ? 'LF' : 'Sem EOL'
}
/** Cursor uses textarea UTF-16 selection offsets; CRLF occupies one displayed newline. */
export function documentCursor(text: string, offset: number) {
  const normalized = editorText(text), end = Math.max(0, Math.min(normalized.length, offset))
  let line = 1, column = 1
  for (let i = 0; i < end; i++) { if (normalized[i] === '\n') { line++; column = 1 } else column++ }
  return { line, column }
}
