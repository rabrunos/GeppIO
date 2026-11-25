import { WebSurfaces } from '@geppio/runtime/web'
import { SurfaceGrants } from './web-surfaces.tsx'
import { useEffect, useRef, useState } from 'react'
import type { PluginInventory, PluginResult } from '../../shared/plugins.ts'
import { disabledWidgetOwners, PluginRuntime } from './plugin-runtime.ts'
import type { RuntimePlugin } from './plugin-runtime.ts'
import { useLocale } from './workbench/Locale.tsx'
import { flushPluginDrafts } from './plugin-drafts.ts'

export function usePlugins() {
  const [surfaces] = useState(() => new WebSurfaces())
  const [inventory, setInventory] = useState<PluginInventory>({ plugins: [], errors: [] })
  const [views, setViews] = useState<RuntimePlugin[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(true)
  const runtime = useRef<PluginRuntime | null>(null)
  const accepted = useRef(inventory), published = useRef(views)
  const unknownInventory = useRef(false)
  const locked = useRef(true)
  const pausedInputs = useRef<readonly string[]>([])
  function acceptInventory(value: PluginInventory) { accepted.current = value; unknownInventory.current = false; setInventory(value) }
  useEffect(() => {
    let mounted = true
    const host = new PluginRuntime(() => new Worker(new URL('./plugin-worker.ts', import.meta.url), { type: 'module' }), values => { if (mounted) { published.current = values; setViews(values) } }, undefined, window.geppio?.pluginData, plugin => surfaces.controller(plugin))
    runtime.current = host
    void (async () => {
      try {
        const result = await window.geppio?.plugins.list()
        if (!mounted) return
        if (!result) setMessage('Gerenciamento disponível somente no aplicativo desktop.')
        else if (!result.ok) setMessage(result.error)
        else { acceptInventory(result.value); await host.sync(result.value.plugins) }
      } catch { if (mounted) setMessage('Não foi possível iniciar o gerenciamento de plugins.') }
      finally { if (mounted) { locked.current = false; setBusy(false) } }
    })()
    return () => { mounted = false; host.shutdown(); runtime.current = null }
  }, [])
  async function manage(operation: () => Promise<PluginResult<PluginInventory | null>>, prepare: string[] = [], options: { retryId?: string; discardDrafts?: boolean } = {}) {
    if (locked.current) return
    const host = runtime.current
    async function refreshInventory() {
      try {
        const actual = await window.geppio?.plugins.list()
        if (actual?.ok && host && runtime.current === host) { acceptInventory(actual.value); await host.sync(actual.value.plugins) }
      } catch { /* Keep the current presentation and the unresolved management feedback. */ }
    }
    let awaitingResult = false
    locked.current = true; setBusy(true); setMessage('')
    try {
      if (prepare.length) {
        const ready = options.discardDrafts || await flushPluginDrafts(prepare)
        pausedInputs.current = prepare
        if (!ready || !await runtime.current?.prepareChange(prepare, options.discardDrafts)) { setMessage('Há edições pendentes ou falha ao salvar. Conclua a edição ou copie os rascunhos antes de descartá-los.'); return }
      }
      awaitingResult = true
      const result = await operation()
      awaitingResult = false
      if (runtime.current !== host) return
      if (!result.ok) {
        unknownInventory.current = true
        setMessage(result.error)
        await refreshInventory()
      }
      else if (result.value) { if (options.retryId) await runtime.current?.stop(options.retryId); acceptInventory(result.value); await runtime.current?.sync(result.value.plugins) }
    } catch {
      if (runtime.current === host) {
        if (awaitingResult) unknownInventory.current = true
        setMessage('Resultado do gerenciamento não confirmado. Confira a lista de plugins antes de tentar novamente.')
        await refreshInventory()
      }
    }
    finally { if (runtime.current === host) { pausedInputs.current = []; locked.current = false; setBusy(false) } }
  }
  const bridge = window.geppio?.plugins
  // A deferred layout write can awaken after publication but before React has
  // rendered the new registry and availability. Its old context must decline.
  function managing() {
    if (busy || locked.current || accepted.current !== inventory) return true
    if (published.current === views) return false
    const rendered = disabledWidgetOwners(inventory.plugins, views), current = disabledWidgetOwners(inventory.plugins, published.current)
    return rendered.size !== current.size || [...current].some(id => !rendered.has(id))
  }
  return { surfaces, inventory, views, message, busy, managing, inventoryUnconfirmed: () => unknownInventory.current, available: Boolean(bridge),
    refresh: () => { if (bridge) void manage(() => bridge.list()) },
    install: () => { if (bridge) void manage(() => bridge.install()) },
    installFile: () => { if (bridge) void manage(() => bridge.installFile()) },
    setDeveloperMode: (enabled: boolean) => { if (bridge) void manage(() => bridge.setDeveloperMode(enabled), enabled ? [] : inventory.plugins.filter(item => item.source === 'external' && item.enabled).map(item => item.manifest.id)) },
    reload: (id: string, discardDrafts = false) => { if (bridge) void manage(() => bridge.reload(id), [id], { discardDrafts }) },
    link: (id: string) => { if (bridge) void manage(() => bridge.link(id)) },
    toggle: (view: RuntimePlugin) => { const id = view.plugin.manifest.id; if (bridge) void manage(() => bridge.setEnabled(id, !(view.plugin.desiredEnabled ?? view.plugin.enabled)), [id]) },
    retry: (id: string) => { if (bridge) void manage(() => bridge.setEnabled(id, true), [id], { retryId: id }) },
    discardAndDisable: (view: RuntimePlugin) => { const id = view.plugin.manifest.id; if (bridge && view.recoveryRequired && view.plugin.enabled) void manage(() => bridge.setEnabled(id, false), [id], { discardDrafts: true }) },
    remove: (id: string) => { if (bridge) void manage(() => bridge.remove(id), [id]) },
    removeInvalid: (id: string) => { if (bridge) void manage(() => bridge.remove(id)) },
    action: (id: string, widgetId: string, actionId: string) => { if (!pausedInputs.current.includes(id)) void runtime.current?.action(id, widgetId, actionId) },
    widgetEvent: (id: string, widgetId: string, event: import('../../shared/plugin-surface.ts').WidgetEvent) => pausedInputs.current.includes(id) ? Promise.resolve(false) : runtime.current?.widgetEvent(id, widgetId, event) ?? Promise.resolve(false)
  }
}
type Plugins = ReturnType<typeof usePlugins>
const STATUS = { starting: 'Ativando', active: 'Ativo', stopping: 'Desativando', disabled: 'Desativado', error: 'Falha' }
export function PluginSettings({ plugins }: { plugins: Plugins }) {
  const { t } = useLocale()
  return <section aria-label="Plugins">
    <h3>Plugins</h3>
    <p>{t('Instale um arquivo .gpp assinado por uma chave autorizada para o plugin.')}</p>
    <button className="ui-button tool-button ui-button-primary" disabled={plugins.busy || !plugins.available} onClick={plugins.installFile}>{t('Instalar arquivo assinado')}</button>
    <label className="workspace-switch-row"><span>{t('Modo desenvolvedor')}</span><input type="checkbox" role="switch" aria-label={t('Modo desenvolvedor')} checked={Boolean(plugins.inventory.developerMode)} disabled={plugins.busy || !plugins.available} onChange={event => plugins.setDeveloperMode(event.target.checked)} /></label>
    <p>{t('As APIs 1 e 2 executam código local confiável. A API 3 usa superfícies isoladas com permissões de comunicação. Desligar o modo pausa as pastas e preserva seus dados e posições.')}</p>
    {plugins.inventory.developerMode && <button className="ui-button tool-button" disabled={plugins.busy || !plugins.available} onClick={plugins.install}>{t('Carregar pasta local')}</button>}
    <p role="status">{plugins.busy ? t('Processando plugins…') : t(plugins.message)}</p>
    {plugins.inventoryUnconfirmed() && <button className="ui-button tool-button" disabled={plugins.busy} onClick={plugins.refresh}>Atualizar lista de plugins</button>}
    {plugins.inventory.errors.map(error => <div className="plugin-error" key={error}><p>{error}</p>{/^[a-z][a-z0-9.-]*:/.test(error) && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.removeInvalid(error.split(':')[0]!)}>{t('Remover instalação inválida')}</button>}</div>)}
    {!plugins.views.length && <p>{t('Nenhum plugin instalado.')}</p>}
    <ul className="plugin-list">{plugins.views.map(view => <li key={view.plugin.manifest.id} data-plugin={view.plugin.manifest.id} data-status={view.status}>
      <div><strong>{view.plugin.manifest.name}</strong><small>{view.plugin.manifest.id} · {view.plugin.manifest.version} · {view.plugin.manifest.widgets.length} widget(s)</small></div>
      <small>{t(view.plugin.source === 'external' ? 'Pasta externa' : view.plugin.source === 'signed' ? 'Pacote assinado' : 'Cópia gerenciada legada')}</small>
      <span className="badge">{t(STATUS[view.status])}</span>
      <p role="status">{t(view.detail)}</p>
      {view.status === 'active' && view.plugin.manifest.surface && <SurfaceGrants plugin={view.plugin} host={plugins.surfaces} active={plugins.views.filter(item => item.status === 'active').map(item => item.plugin)} />}
      {view.plugin.unavailable && <p role="status">{t(view.plugin.unavailable)}</p>}
      <details><summary>{t('Eventos desta sessão')}</summary><ul>{view.events.map((event, index) => <li key={index}>{event}</li>)}</ul></details>
      <div className="plugin-actions"><button className="ui-button tool-button" disabled={plugins.busy || view.plugin.source === 'external' && !plugins.inventory.developerMode} onClick={() => plugins.toggle(view)}>{t((view.plugin.desiredEnabled ?? view.plugin.enabled) ? 'Desativar' : 'Ativar')}</button>
        {view.status === 'error' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.retry(view.plugin.manifest.id)}>{t('Tentar novamente')}</button>}
        {plugins.inventory.developerMode && view.plugin.source === 'external' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.reload(view.plugin.manifest.id)}>{view.plugin.manifest.apiVersion === 3 ? 'Atualizar' : t('Recarregar')}</button>}
        {plugins.inventory.developerMode && view.plugin.source === 'external' && view.status === 'error' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.reload(view.plugin.manifest.id, true)}>{t('Recarregar descartando rascunhos')}</button>}
        {plugins.inventory.developerMode && (view.plugin.source ?? 'legacy') === 'legacy' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.link(view.plugin.manifest.id)}>{t('Vincular pasta original')}</button>}
        {view.recoveryRequired && view.plugin.enabled && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.discardAndDisable(view)}>{t('Descartar rascunhos e desativar')}</button>}
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
