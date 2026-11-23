/** Monaco normalizes its model to LF. Each alternative version keeps its exact disk/draft endings. */
export function modelEndings(text: string): string {
  return (text.match(/\r\n|\r|\n/g) ?? []).map(eol => eol === '\r\n' ? 'C' : eol === '\r' ? 'R' : 'L').join('')
}
export function applyModelEndings(normalized: string, pattern: string): string {
  let i = 0
  return normalized.replaceAll('\n', () => ({ C: '\r\n', R: '\r', L: '\n' })[pattern[i++]!] ?? '\n')
}
