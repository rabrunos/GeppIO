import { WebSurfaces } from '@geppio/runtime/web'
import { useEffect, useRef, useState } from 'react'
import type { PluginInventory, PluginResult } from '../../shared/plugins.ts'
import { disabledWidgetOwners, PluginRuntime } from './plugin-runtime.ts'
import type { RuntimePlugin } from './plugin-runtime.ts'
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

export type Plugins = ReturnType<typeof usePlugins>
