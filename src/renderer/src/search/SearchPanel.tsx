import { useSyncExternalStore } from 'react'
import { SEARCH_EXCLUDED_DIRECTORIES, SEARCH_LIMITS, validSearchQuery } from '../../../shared/search.ts'
import type { SearchSession } from './session.ts'
import './search.css'

const statusLabels = {
  idle: '', starting: 'Iniciando busca', running: 'Buscando', complete: 'Busca concluída',
  partial: 'Busca parcial', canceled: 'Busca cancelada', canceling: 'Cancelando busca', failed: 'Falha na busca'
}
export function SearchPanel({ session }: { session: SearchSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const { query, page, matches, status } = state
  const valid = validSearchQuery(query)
  return <section className="project-search ui-scrollbar" aria-label="Busca no projeto">
    <form onSubmit={event => { event.preventDefault(); void session.start() }}>
      <label htmlFor="project-search-query">Texto a buscar</label>
      <input id="project-search-query" type="text" value={query} maxLength={SEARCH_LIMITS.query} autoComplete="off"
        aria-invalid={!!query && !valid} aria-describedby={query && !valid ? 'project-search-invalid' : undefined}
        onChange={event => session.setQuery(event.target.value)} />
      {query && !valid && <p id="project-search-invalid">Use até 256 caracteres UTF-16 em uma linha, sem caracteres de controle.</p>}
      <label className="search-option"><input type="checkbox" checked={state.matchCase}
        onChange={event => session.setMatchCase(event.target.checked)} /> Diferenciar maiúsculas e minúsculas</label>
      <div className="search-actions">
        <button type="submit" className="ui-button tool-button" disabled={!state.root || !valid || session.locked}>Buscar</button>
        <button type="button" className="ui-button tool-button" disabled={!session.canCancel} onClick={() => { void session.cancel() }}>Cancelar busca</button>
      </div>
    </form>
    {!state.root && <p>Abra uma pasta no Explorador para buscar no projeto.</p>}
    <p className="search-policy">A busca lê os arquivos salvos no disco. Rascunhos do editor ficam de fora.</p>
    <details><summary>Pastas excluídas</summary><p>{['.git', ...SEARCH_EXCLUDED_DIRECTORIES].join(', ')}</p></details>
    {state.submitted && <p role="status">{statusLabels[status]} para “{state.submitted}”.
      {page && <> Ocorrências: {page.found}. Arquivos pesquisados: {page.files}. Itens ignorados: {page.skipped}.</>}
      {page?.reason && <> {page.reason}</>}</p>}
    {state.feedback && <p role="alert">{state.feedback}</p>}
    {matches.length > 0 && <ul className="search-results" aria-label="Resultados da busca">
      {matches.map(match => <li key={match.id}>
        <button type="button" className="ui-button search-result" disabled={session.locked}
          aria-label={`Abrir ${match.file}, linha ${match.line}, coluna ${match.column}`} onClick={() => { void session.open(match.id) }}>
          <span className="search-location">{match.file} <small>{match.line}:{match.column}</small></span>
          <code>{match.snippet.slice(0, match.highlightStart)}<mark>{match.snippet.slice(match.highlightStart, match.highlightEnd)}</mark>{match.snippet.slice(match.highlightEnd)}</code>
        </button>
      </li>)}
    </ul>}
  </section>
}
