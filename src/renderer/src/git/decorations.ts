import type { GitChange, GitStatus } from '../../../shared/git.ts'

export interface GitDecoration { badge: string; description: string }
const labels: Record<string, string> = { M: 'Modificado', U: 'Unversionado (não rastreado pelo Git)', A: 'Adicionado', D: 'Deletado', R: 'Renomeado', C: 'Copiado', T: 'Tipo alterado', I: 'Ignorado' }
export function fileDecoration(change: GitChange): GitDecoration {
  if (change.conflict) return { badge: '!', description: `Conflito (índice: ${change.index}; árvore de trabalho: ${change.working}).` }
  if (change.untracked) return { badge: 'U', description: labels.U! }
  if (change.index === '!' && change.working === '!') return { badge: 'I', description: labels.I! }
  const index = change.index.trim(), working = change.working.trim()
  const origin = change.previous ? (index === 'C' || working === 'C' ? ' Copiado de ' : ' Renomeado de ') + change.previous + '.' : ''
  return { badge: [index, working].filter(Boolean).join('·'), description: `Índice: ${labels[index] ?? 'sem alteração'}; árvore de trabalho: ${labels[working] ?? 'sem alteração'}.${origin}` }
}
/** One bounded snapshot projection, never native IO or one Git command per row.
 * Paths are repository-relative display names already supplied by the Git service.
 * Ancestors use sets: mixed layers and renames count a change only once per folder.
 */
export function gitDecorations(status: GitStatus | null): { files: Map<string, GitDecoration>; folders: Map<string, GitDecoration> } {
  const files = new Map<string, GitDecoration>(), descendants = new Map<string, Set<string>>()
  for (const change of status?.changes ?? []) {
    files.set(change.name, fileDecoration(change))
    // Ignored files are not changes; a copy does not change its source folder.
    if (change.index === '!' && change.working === '!') continue
    const names = [change.name]
    if (change.previous && (change.index === 'R' || change.working === 'R')) names.push(change.previous)
    for (const name of names) {
      const parts = name.split('/')
      for (let depth = 0; depth < parts.length; depth++) {
        const ancestor = parts.slice(0, depth).join('/'), entries = descendants.get(ancestor) ?? new Set<string>()
        entries.add(change.id); descendants.set(ancestor, entries)
      }
    }
  }
  return { files, folders: new Map([...descendants].map(([name, entries]) => [name, { badge: String(entries.size), description: `${entries.size} arquivo(s) com alterações Git nos descendentes (índice ou disco).` }])) }
}
