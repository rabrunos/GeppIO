import { useEffect, useRef, useState } from 'react'
import type { PluginInventory, PluginResult } from '../../shared/plugins.ts'
import { PluginRuntime } from './plugin-runtime.ts'
import type { RuntimePlugin } from './plugin-runtime.ts'

export function usePlugins() {
  const [inventory, setInventory] = useState<PluginInventory>({ plugins: [], errors: [] })
  const [views, setViews] = useState<RuntimePlugin[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(true)
  const runtime = useRef<PluginRuntime | null>(null)
  const locked = useRef(true)
  useEffect(() => {
    let mounted = true
    const host = new PluginRuntime(() => new Worker(new URL('./plugin-worker.ts', import.meta.url), { type: 'module' }), values => { if (mounted) setViews(values) })
    runtime.current = host
    void (async () => {
      try {
        const result = await window.geppio?.plugins.list()
        if (!mounted) return
        if (!result) setMessage('Gerenciamento disponível somente no aplicativo desktop.')
        else if (!result.ok) setMessage(result.error)
        else { setInventory(result.value); await host.sync(result.value.plugins) }
      } catch { if (mounted) setMessage('Não foi possível iniciar o gerenciamento de plugins.') }
      finally { if (mounted) { locked.current = false; setBusy(false) } }
    })()
    return () => { mounted = false; host.shutdown(); runtime.current = null }
  }, [])
  async function manage(operation: () => Promise<PluginResult<PluginInventory | null>>, stopId?: string) {
    if (locked.current) return
    locked.current = true; setBusy(true); setMessage('')
    try {
      if (stopId) await runtime.current?.stop(stopId)
      const result = await operation()
      if (!result.ok) {
        setMessage(result.error)
        const refreshed = await window.geppio?.plugins.list()
        const actual = refreshed?.ok ? refreshed.value : inventory
        setInventory(actual); await runtime.current?.sync(actual.plugins)
      }
      else if (result.value) { setInventory(result.value); await runtime.current?.sync(result.value.plugins) }
    } catch { setMessage('Falha ao gerenciar plugins. Os dados existentes foram preservados.') }
    finally { locked.current = false; setBusy(false) }
  }
  const bridge = window.geppio?.plugins
  return { inventory, views, message, busy, available: Boolean(bridge),
    install: () => { if (bridge) void manage(() => bridge.install()) },
    toggle: (view: RuntimePlugin) => { if (bridge) void manage(() => bridge.setEnabled(view.plugin.manifest.id, view.status === 'error' || !view.plugin.enabled), view.plugin.manifest.id) },
    remove: (id: string) => { if (bridge) void manage(() => bridge.remove(id), id) },
    removeInvalid: (id: string) => { if (bridge) void manage(() => bridge.remove(id), id) },
    action: (id: string, widgetId: string, actionId: string) => { void runtime.current?.action(id, widgetId, actionId) }
  }
}
type Plugins = ReturnType<typeof usePlugins>
const STATUS = { starting: 'Ativando', active: 'Ativo', stopping: 'Desativando', disabled: 'Desativado', error: 'Falha' }
export function PluginSettings({ plugins }: { plugins: Plugins }) {
  return <section aria-label="Plugins">
    <h3>Plugins</h3>
    <p>Instale somente pacotes locais de desenvolvimento confiáveis. Esta versão não oferece isolamento para plugins de terceiros.</p>
    <button className="button primary" disabled={plugins.busy || !plugins.available} onClick={plugins.install}>Instalar pasta local</button>
    <p role="status">{plugins.busy ? 'Processando plugins…' : plugins.message}</p>
    {plugins.inventory.errors.map(error => <div className="plugin-error" key={error}><p>{error}</p>{/^[a-z][a-z0-9.-]*:/.test(error) && <button className="button" disabled={plugins.busy} onClick={() => plugins.removeInvalid(error.split(':')[0]!)}>Remover instalação inválida</button>}</div>)}
    {!plugins.views.length && <p>Nenhum plugin instalado.</p>}
    <ul className="plugin-list">{plugins.views.map(view => <li key={view.plugin.manifest.id} data-plugin={view.plugin.manifest.id} data-status={view.status}>
      <div><strong>{view.plugin.manifest.name}</strong><small>{view.plugin.manifest.id} · {view.plugin.manifest.version} · {view.plugin.manifest.widgets.length} widget(s)</small></div>
      <span className="badge">{STATUS[view.status]}</span>
      <p role="status">{view.detail}</p>
      <details><summary>Eventos desta sessão</summary><ul>{view.events.map((event, index) => <li key={index}>{event}</li>)}</ul></details>
      <div className="plugin-actions"><button className="button" disabled={plugins.busy} onClick={() => plugins.toggle(view)}>{view.status === 'error' ? 'Tentar novamente' : view.plugin.enabled ? 'Desativar' : 'Ativar'}</button>
        {view.status === 'error' && view.plugin.enabled && <button className="button" disabled={plugins.busy} onClick={() => plugins.toggle({ ...view, status: 'active' })}>Desativar</button>}
        <button className="button" disabled={plugins.busy} onClick={() => plugins.remove(view.plugin.manifest.id)}>Remover</button></div>
    </li>)}</ul>
  </section>
}
export function PluginWidgets({ plugins }: { plugins: Plugins }) {
  const active = plugins.views.filter(view => view.status === 'active')
  if (!active.some(view => Object.keys(view.widgets).length)) return null
  return <section className="plugin-widgets" aria-label="Widgets de plugins locais">{active.flatMap(view => view.plugin.manifest.widgets.map(widget => {
    const content = view.widgets[widget.id]
    return content ? <article className="plugin-widget" key={view.plugin.manifest.id + ':' + widget.id} data-plugin-widget={view.plugin.manifest.id + ':' + widget.id}>
      <h3>{widget.title}</h3><small>{view.plugin.manifest.name}</small><p>{content.text}</p>
      {content.action && <button className="button" onClick={() => plugins.action(view.plugin.manifest.id, widget.id, content.action!.id)}>{content.action.label}</button>}
    </article> : null
  }))}</section>
}
