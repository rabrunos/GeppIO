import { useId, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { SEARCH_EXCLUDED_DIRECTORIES, SEARCH_LIMITS, validSearchQuery } from '../../../shared/search.ts'
import type { SearchSession } from './session.ts'
import { REPLACE_LIMITS, validSearchFilters } from '../../../shared/search-replacement.ts'
import './search.css'

const statusLabels = {
  idle: '', starting: 'Iniciando busca', running: 'Buscando', complete: 'Busca concluída',
  partial: 'Busca parcial', canceled: 'Busca cancelada', canceling: 'Cancelando busca', failed: 'Falha na busca'
}
export function SearchPanel({ session, headerAction }: { session: SearchSession; headerAction?: ReactNode }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const [showReplacement, setShowReplacement] = useState(false)
  const field = useId(), error = useId()
  const { query, page, matches, status } = state
  const valid = validSearchQuery(query), filtersValid = validSearchFilters(state.filters)
  return <section className="project-search ui-scrollbar" aria-label="Busca no projeto">
    <form onSubmit={event => { event.preventDefault(); void session.start() }}>
      <label htmlFor={field}>Texto a buscar</label>
      <input id={field} type="text" value={query} disabled={state.applying} maxLength={SEARCH_LIMITS.query} autoComplete="off"
        aria-invalid={!!query && !valid} aria-describedby={query && !valid ? error : undefined}
        onChange={event => session.setQuery(event.target.value)} />
      {query && !valid && <p id={error}>Use até 256 caracteres UTF-16 em uma linha, sem caracteres de controle.</p>}
      <label className="search-option"><input type="checkbox" checked={state.matchCase} disabled={state.applying}
        onChange={event => session.setMatchCase(event.target.checked)} /> Diferenciar maiúsculas e minúsculas</label>
      <details><summary>Filtrar arquivos</summary><fieldset disabled={state.applying}>
        <label>Caminho relativo<input type="text" placeholder="src/ ou src/editor.ts" maxLength={512} value={state.filters.path}
          onChange={event => session.setFilters({ ...state.filters, path: event.target.value })} /></label>
        <label>Extensões<input type="text" placeholder="ts, txt" maxLength={128} value={state.filters.extensions}
          onChange={event => session.setFilters({ ...state.filters, extensions: event.target.value })} /></label>
        {!filtersValid && <p role="alert">Use um caminho relativo literal, com / no fim para pastas. Separe as extensões por vírgula, sem ponto.</p>}
      </fieldset></details>
      <div className="search-actions">
        <button type="submit" className="ui-button tool-button" disabled={!state.root || !valid || !filtersValid || session.locked || state.applying}>Buscar</button>
        <button type="button" className="ui-button tool-button" disabled={!session.canCancel} onClick={() => { void session.cancel() }}>Cancelar busca</button>
        {headerAction}
      </div>
    </form>
    {!state.root && <p>Abra uma pasta no Explorador para buscar no projeto.</p>}
    <p className="search-policy">A busca lê os arquivos salvos no disco. Rascunhos do editor ficam de fora.</p>
    <details><summary>Pastas excluídas</summary><p>{['.git', ...SEARCH_EXCLUDED_DIRECTORIES].join(', ')}</p></details>
    {state.submitted && <p role="status">{statusLabels[status]} para “{state.submitted}”.
      {page && <> Ocorrências: {page.found}. Arquivos pesquisados: {page.files}. Itens ignorados: {page.skipped}.</>}
      {page?.reason && <> {page.reason}</>}</p>}
    {state.feedback && <p role="alert">{state.feedback}</p>}
    {matches.length > 0 && <details className="replace-review" open={showReplacement} onToggle={event => setShowReplacement(event.currentTarget.open)}><summary>Substituir ocorrências</summary>
      <label>Substituir por<input type="text" value={state.replacement} maxLength={REPLACE_LIMITS.replacement} disabled={state.applying}
        onChange={event => session.setReplacement(event.target.value)} /></label>
      <label className="search-option"><input type="checkbox" checked={state.selected.size === matches.length} disabled={state.applying}
        onChange={event => session.selectAll(event.target.checked)} /> Selecionar todas as ocorrências</label>
      <button className="ui-button tool-button" disabled={!!session.previewUnavailable} onClick={() => void session.prepare()}>Gerar prévia</button>
      {state.preparing ? <p role="status">Conferindo arquivos no disco…</p> : session.previewUnavailable && !state.applying && <p>{session.previewUnavailable}</p>}
      {state.preview && <section aria-label="Prévia da substituição">
        <p>Substituir as ocorrências selecionadas de <code>{state.submitted}</code> por {state.replacement ? <code>{state.replacement}</code> : 'texto vazio'}.
          {' '}Abas limpas recebem o novo conteúdo. Uma alteração no texto reinicia o histórico de desfazer dessa aba.</p>
        {state.preview.partial && <p>A busca teve cobertura parcial. Somente os resultados exibidos entraram na prévia.</p>}
        <ul>{state.preview.files.map(file => <li key={file.id}>{file.file} · {file.matches} · {file.excluded ? 'Excluído. ' + file.excluded :
          state.outcomes.get(file.id) ?? (file.open ? 'Aba aberta' : 'Pronto')}</li>)}</ul>
        {!state.outcomes.size && <button className="ui-button tool-button" disabled={session.locked || !state.preview.files.some(file => !file.excluded)}
          onClick={() => void session.apply()}>Confirmar substituição</button>}
        {(state.applying || !state.outcomes.size) && <button className="ui-button tool-button" onClick={() => session.cancelReplacement()}>
          {state.applying ? 'Interromper após este arquivo' : 'Cancelar prévia'}</button>}
      </section>}
    </details>}
    {matches.length > 0 && <ul className="search-results" aria-label="Resultados da busca">
      {matches.map(match => <li key={match.id}>
        {showReplacement && <label className="search-option"><input type="checkbox" aria-label={`Selecionar ${match.file}, linha ${match.line}, coluna ${match.column}`}
          checked={state.selected.has(match.id)} disabled={state.applying} onChange={event => session.selectMatch(match.id, event.target.checked)} /> Incluir na substituição</label>}
        <button type="button" className="ui-button search-result" disabled={session.locked}
          aria-label={`Abrir ${match.file}, linha ${match.line}, coluna ${match.column}`} onClick={() => { void session.open(match.id) }}>
          <span className="search-location">{match.file} <small>{match.line}:{match.column}</small></span>
          <code>{match.snippet.slice(0, match.highlightStart)}<mark>{match.snippet.slice(match.highlightStart, match.highlightEnd)}</mark>{match.snippet.slice(match.highlightEnd)}</code>
        </button>
      </li>)}
    </ul>}
  </section>
}
