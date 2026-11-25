import { useState } from 'react'
import type { WidgetEvent, WidgetViewV2 } from '../../shared/plugin-surface.ts'

/** Host presentation of existing API 2 publications; no alternate model or data path. */
export function BottomPluginSurface({ view, send, paused }: { view: WidgetViewV2; send(event: WidgetEvent): Promise<boolean>; paused: boolean }) {
  const [feedback, setFeedback] = useState('')
  const list = view.lists?.[0], field = view.fields?.find(field => field.multiline)
  const checklist = list?.items.some(item => item.checked !== undefined) || list?.id === 'items'
  async function dispatch(event: WidgetEvent) { setFeedback(await send(event) ? '' : 'Falha ao enviar ação. Tente novamente.') }
  return <div className="bottom-plugin-surface" data-bottom-surface={checklist ? 'checklist' : 'reader'}>
    <div className="bottom-plugin-toolbar">
      {list && !checklist && <select className="ui-input" aria-label={list.label} value={list.selected ?? ''} disabled={paused || !list.items.length} onChange={event => { void dispatch({ kind: 'select', controlId: list.id, itemId: event.target.value }) }}>
        {!list.items.length && <option value="">Nenhum registro salvo</option>}{list.items.map(item => <option key={item.id} value={item.id}>{item.text || 'Sem título'}</option>)}
      </select>}
      <small role="status">{feedback || view.text}</small>
      {view.text.startsWith('Falha ao salvar') && view.actions?.some(action => action.id === 'save') && <button className="ui-button" disabled={paused} onClick={() => { void dispatch({ kind: 'action', controlId: 'save' }) }}>Tentar salvar novamente</button>}
    </div>
    {checklist ? <div className="bottom-plugin-checklist" role="group" aria-label={list?.label}>{list?.items.map(item => <label key={item.id} className="plugin-check-item"><input type="checkbox" checked={item.checked ?? false} disabled={paused} onChange={event => { void dispatch({ kind: 'toggle', controlId: list.id, itemId: item.id, value: event.target.checked }) }} /><span>{item.text}</span></label>)}{!list?.items.length && <span>Nenhum item salvo</span>}</div>
      : <div className="bottom-plugin-preview" role="region" aria-label={field?.label ?? 'Prévia do texto'} tabIndex={0}>{field?.value || 'Selecione um registro salvo. Edite na área Principal ou na Lateral.'}</div>}
  </div>
}
