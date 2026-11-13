import { useEffect, useRef, useState } from 'react'
import type { PluginInventory, PluginResult } from '../../shared/plugins.ts'
import { PluginRuntime } from './plugin-runtime.ts'
import type { RuntimePlugin } from './plugin-runtime.ts'
import { useLocale } from './workbench/Locale.tsx'
import { flushPluginDrafts } from './plugin-drafts.ts'

export function usePlugins() {
  const [inventory, setInventory] = useState<PluginInventory>({ plugins: [], errors: [] })
  const [views, setViews] = useState<RuntimePlugin[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(true)
  const runtime = useRef<PluginRuntime | null>(null)
  const locked = useRef(true)
  useEffect(() => {
    let mounted = true
    const host = new PluginRuntime(() => new Worker(new URL('./plugin-worker.ts', import.meta.url), { type: 'module' }), values => { if (mounted) setViews(values) }, undefined, window.geppio?.pluginData)
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
  async function manage(operation: () => Promise<PluginResult<PluginInventory | null>>, prepare: string[] = [], retryId?: string) {
    if (locked.current) return
    locked.current = true; setBusy(true); setMessage('')
    try {
      if (prepare.length && (!await flushPluginDrafts(prepare) || !await runtime.current?.prepareChange(prepare))) { setMessage('Há edições pendentes ou falha ao salvar. Aguarde Salvo, conclua o novo item ou copie o texto pendente antes de tentar novamente. Nada foi descartado.'); return }
      const result = await operation()
      if (!result.ok) {
        setMessage(result.error)
        const refreshed = await window.geppio?.plugins.list()
        const actual = refreshed?.ok ? refreshed.value : inventory
        setInventory(actual); await runtime.current?.sync(actual.plugins)
      }
      else if (result.value) { if (retryId) await runtime.current?.stop(retryId); setInventory(result.value); await runtime.current?.sync(result.value.plugins) }
    } catch { setMessage('Falha ao gerenciar plugins. Os dados existentes foram preservados.') }
    finally { locked.current = false; setBusy(false) }
  }
  const bridge = window.geppio?.plugins
  return { inventory, views, message, busy, available: Boolean(bridge),
    install: () => { if (bridge) void manage(() => bridge.install()) },
    installFile: () => { if (bridge) void manage(() => bridge.installFile()) },
    setDeveloperMode: (enabled: boolean) => { if (bridge) void manage(() => bridge.setDeveloperMode(enabled), enabled ? [] : inventory.plugins.filter(item => item.source === 'external' && item.enabled).map(item => item.manifest.id)) },
    reload: (id: string, discardDrafts = false) => { if (bridge) void manage(() => bridge.reload(id), discardDrafts ? [] : [id]) },
    link: (id: string) => { if (bridge) void manage(() => bridge.link(id)) },
    toggle: (view: RuntimePlugin) => { if (bridge) { const id = view.plugin.manifest.id; void manage(() => bridge.setEnabled(id, view.status === 'error' || !(view.plugin.desiredEnabled ?? view.plugin.enabled)), view.status === 'error' ? [] : [id], view.status === 'error' ? id : undefined) } },
    remove: (id: string) => { if (bridge) void manage(() => bridge.remove(id), [id]) },
    removeInvalid: (id: string) => { if (bridge) void manage(() => bridge.remove(id)) },
    action: (id: string, widgetId: string, actionId: string) => { void runtime.current?.action(id, widgetId, actionId) },
    widgetEvent: (id: string, widgetId: string, event: import('../../shared/plugin-surface.ts').WidgetEvent) => runtime.current?.widgetEvent(id, widgetId, event) ?? Promise.resolve(false)
  }
}
type Plugins = ReturnType<typeof usePlugins>
const STATUS = { starting: 'Ativando', active: 'Ativo', stopping: 'Desativando', disabled: 'Desativado', error: 'Falha' }
export function PluginSettings({ plugins }: { plugins: Plugins }) {
  const { t } = useLocale()
  return <section aria-label="Plugins">
    <h3>Plugins</h3>
    <p>{t('Instale um arquivo assinado do piloto Workspace Essentials. Esta versão não oferece isolamento para plugins de terceiros.')}</p>
    <button className="ui-button tool-button ui-button-primary" disabled={plugins.busy || !plugins.available} onClick={plugins.installFile}>{t('Instalar arquivo assinado')}</button>
    <label className="workspace-switch-row"><span>{t('Modo desenvolvedor')}</span><input type="checkbox" role="switch" aria-label={t('Modo desenvolvedor')} checked={Boolean(plugins.inventory.developerMode)} disabled={plugins.busy || !plugins.available} onChange={event => plugins.setDeveloperMode(event.target.checked)} /></label>
    <p>{t('Pastas externas executam código local confiável. Desligar o modo pausa essas fontes e mantém dados, posições e ativação desejada.')}</p>
    {plugins.inventory.developerMode && <button className="ui-button tool-button" disabled={plugins.busy || !plugins.available} onClick={plugins.install}>{t('Carregar pasta local')}</button>}
    <p role="status">{plugins.busy ? t('Processando plugins…') : t(plugins.message)}</p>
    {plugins.inventory.errors.map(error => <div className="plugin-error" key={error}><p>{error}</p>{/^[a-z][a-z0-9.-]*:/.test(error) && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.removeInvalid(error.split(':')[0]!)}>{t('Remover instalação inválida')}</button>}</div>)}
    {!plugins.views.length && <p>{t('Nenhum plugin instalado.')}</p>}
    <ul className="plugin-list">{plugins.views.map(view => <li key={view.plugin.manifest.id} data-plugin={view.plugin.manifest.id} data-status={view.status}>
      <div><strong>{view.plugin.manifest.name}</strong><small>{view.plugin.manifest.id} · {view.plugin.manifest.version} · {view.plugin.manifest.widgets.length} widget(s)</small></div>
      <small>{t(view.plugin.source === 'external' ? 'Pasta externa' : view.plugin.source === 'signed' ? 'Pacote assinado' : 'Cópia gerenciada legada')}</small>
      <span className="badge">{t(STATUS[view.status])}</span>
      <p role="status">{t(view.detail)}</p>
      {view.plugin.unavailable && <p role="status">{t(view.plugin.unavailable)}</p>}
      <details><summary>{t('Eventos desta sessão')}</summary><ul>{view.events.map((event, index) => <li key={index}>{event}</li>)}</ul></details>
      <div className="plugin-actions"><button className="ui-button tool-button" disabled={plugins.busy || view.plugin.source === 'external' && !plugins.inventory.developerMode} onClick={() => plugins.toggle(view)}>{t(view.status === 'error' ? 'Tentar novamente' : (view.plugin.desiredEnabled ?? view.plugin.enabled) ? 'Desativar' : 'Ativar')}</button>
        {plugins.inventory.developerMode && view.plugin.source === 'external' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.reload(view.plugin.manifest.id)}>{t('Recarregar')}</button>}
        {plugins.inventory.developerMode && view.plugin.source === 'external' && view.status === 'error' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.reload(view.plugin.manifest.id, true)}>{t('Recarregar descartando rascunhos')}</button>}
        {plugins.inventory.developerMode && (view.plugin.source ?? 'legacy') === 'legacy' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.link(view.plugin.manifest.id)}>{t('Vincular pasta original')}</button>}
        {view.status === 'error' && view.plugin.enabled && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.toggle({ ...view, status: 'active' })}>{t('Desativar')}</button>}
        <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.remove(view.plugin.manifest.id)}>{t('Remover')}</button></div>
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
