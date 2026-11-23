import { useSyncExternalStore } from 'react'
import type { WorkspaceToolsSession } from './session.ts'
import type { WorkspaceToolBlock } from '../../../shared/workspace-tools.ts'
import './workspace-tools.css'

function ReportBlock({ block }: { block: WorkspaceToolBlock }) {
  if (block.kind === 'text') return <p>{block.text}</p>
  if (block.kind === 'list') return <ul>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
  return <div className="workspace-tools-table ui-scrollbar" role="region" aria-label="Tabela do relatório" tabIndex={0}>
    <table><thead><tr>{block.columns.map((label, i) => <th key={i} scope="col">{label}</th>)}</tr></thead>
      <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table>
  </div>
}

export function WorkspaceTools({ session }: { session: WorkspaceToolsSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot)
  const report = state.reports.find(item => item.id === state.selected)
  const message = state.reading ? 'Lendo relatórios…' : !state.root ? 'Abra uma pasta de projeto para consultar os relatórios.'
    : state.status === 'stale' ? 'Desatualizado. ' + state.error : state.error ?? (state.status === 'missing' ? 'Arquivo .geppio/tools.json ausente.'
      : !state.reports.length ? 'Nenhum relatório disponível.' : '')
  const lastRead = state.lastRead === null ? null : new Date(state.lastRead)
  return <div className="workspace-tools">
    <div className="workspace-tools-controls">
      {report && <label>Relatório<select className="ui-input" value={report.id} onChange={event => session.select(event.target.value)}>
        {state.reports.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      <button type="button" className="ui-button tool-button" disabled={!state.root || state.reading} onClick={() => void session.refresh()}>Atualizar</button>
    </div>
    <div role="status" className="workspace-tools-status">{message && <p>{message}</p>}{lastRead && <p>Última leitura: <time dateTime={lastRead.toISOString()}>{lastRead.toLocaleString('pt-BR')}</time></p>}</div>
    {report && <article aria-label={report.title}><h3>{report.title}</h3>{report.blocks.map((block, i) => <ReportBlock key={i} block={block} />)}</article>}
  </div>
}
