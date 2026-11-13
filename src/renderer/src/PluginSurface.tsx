import { useEffect, useRef, useState } from 'react'
import type { TextField } from '../../../sdk/plugin-v2.d.ts'
import type { WidgetEvent, WidgetViewV2 } from '../../shared/plugin-surface.ts'
import { registerPluginDraft } from './plugin-drafts.ts'

function Field({ field, send, disabled, paused, onDraft, pluginId }: { field: TextField; send(event: WidgetEvent): Promise<boolean>; disabled: boolean; paused: boolean; onDraft(id: string, value: string): void; pluginId?: string }) {
  const [value, setValue] = useState(field.value), [status, setStatus] = useState('')
  const draft = useRef(field.value), dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sender = useRef(send); sender.current = send
  const notify = useRef(onDraft); notify.current = onDraft
  useEffect(() => { if (!dirty.current) { draft.current = field.value; setValue(field.value); notify.current(field.id, field.value) } }, [field.id, field.value])
  async function flush() {
    clearTimeout(timer.current)
    if (!dirty.current) return true
    const text = draft.current
    const accepted = await sender.current({ kind: 'input', controlId: field.id, value: text })
    if (draft.current === text) { dirty.current = !accepted; setStatus(accepted ? '' : 'Falha ao enviar. Texto pendente preservado.') }
    return accepted && !dirty.current
  }
  const flushRef = useRef(flush); flushRef.current = flush
  useEffect(() => pluginId ? registerPluginDraft(pluginId, () => flushRef.current()) : undefined, [pluginId])
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) void sender.current({ kind: 'input', controlId: field.id, value: draft.current }) }, [field.id])
  const props = { 'aria-label': field.label, value, disabled, readOnly: paused, maxLength: field.maxLength ?? 32768, onBlur: () => { void flush() }, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    draft.current = event.target.value; notify.current(field.id, event.target.value); dirty.current = true; setValue(event.target.value); setStatus('Alterações pendentes…'); clearTimeout(timer.current); timer.current = setTimeout(() => { void flushRef.current() }, 500)
  } }
  return <label className="plugin-text-field"><span>{field.label}</span>{field.multiline ? <textarea {...props} rows={5} /> : <input {...props} type="text" />}<small role="status">{status}</small>{status.startsWith('Falha') && <button className="ui-button" disabled={paused || disabled} onClick={() => { void flush() }}>Tentar enviar novamente</button>}</label>
}

/** Only host React controls. User/plugin text is always literal, including clipboard content. */
export function PluginSurface({ view, send, preview = false, paused = false, pluginId }: { view: WidgetViewV2; send(event: WidgetEvent): Promise<boolean>; preview?: boolean; paused?: boolean; pluginId?: string }) {
  const [feedback, setFeedback] = useState('')
  const drafts = useRef(new Map<string, string>())
  for (const id of drafts.current.keys()) if (!view.fields?.some(field => field.id === id)) drafts.current.delete(id)
  async function dispatch(event: WidgetEvent) { const ok = await send(event); setFeedback(ok ? '' : 'Falha ao enviar ação. Tente novamente.'); return ok }
  async function copy() {
    setFeedback('Copiando…')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      const field = view.fields?.find(field => field.id === view.copy!.fieldId)
      if (!field) throw new Error('Campo indisponível')
      await navigator.clipboard.writeText(drafts.current.get(field.id) ?? field.value); setFeedback('Prompt copiado.')
    } catch { setFeedback('Não foi possível copiar. Selecione o texto e copie manualmente.') }
  }
  return <div className="plugin-surface-v2">
    <p role="status">{view.text}</p>
    {view.lists?.map(list => <fieldset key={list.id}><legend>{list.label}</legend>{list.items.map(item => item.checked === undefined
      ? <button className="ui-button plugin-list-choice" key={item.id} aria-pressed={list.selected === item.id} disabled={preview || paused} onClick={() => { void dispatch({ kind: 'select', controlId: list.id, itemId: item.id }) }}>{item.text || 'Sem título'}</button>
      : <label key={item.id} className="plugin-check-item"><input type="checkbox" checked={item.checked} disabled={preview || paused} onChange={event => { void dispatch({ kind: 'toggle', controlId: list.id, itemId: item.id, value: event.target.checked }) }} /><span>{item.text}</span></label>)}</fieldset>)}
    {view.fields?.map(field => <Field key={field.id} field={field} send={send} disabled={preview} paused={paused} pluginId={preview ? undefined : pluginId} onDraft={(id, value) => { drafts.current.set(id, value) }} />)}
    <div className="plugin-surface-actions">{view.actions?.map(action => <button className="ui-button tool-button" key={action.id} disabled={preview || paused} onClick={() => { void dispatch({ kind: 'action', controlId: action.id }) }}>{action.label}</button>)}{view.copy && <button className="ui-button tool-button" disabled={preview} onClick={() => { void copy() }}>{view.copy.label}</button>}</div>
    <small role="status">{feedback}</small>
  </div>
}
