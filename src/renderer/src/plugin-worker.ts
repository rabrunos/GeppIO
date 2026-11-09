import type { PluginContext, PluginInstance } from '../../shared/plugins.ts'
import type { PluginContextV2, PluginInstanceV2, WidgetEvent, DataSnapshot, DataDocument } from '../../../sdk/plugin-v2.d.ts'
// No native bridge lives here. The module and all imports come from inspected local assets.
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown): void }
let instance: PluginInstanceV2 | undefined
let active = false
let sequence: Promise<void> = Promise.resolve()
let dataId = 0
const dataPending = new Map<number, { resolve(value: DataSnapshot): void; reject(error: Error): void }>()
function dataRequest(operation: string, expectedRevision?: number, document?: DataDocument): Promise<DataSnapshot> {
  if (!active || dataPending.size >= 4) return Promise.reject(new Error('Canal de dados indisponível.'))
  return new Promise((resolve, reject) => {
    const id = ++dataId
    dataPending.set(id, { resolve, reject })
    scope.postMessage({ type: 'data', id, operation, ...(operation === 'write' ? { expectedRevision, document } : {}) })
  })
}
self.addEventListener('unhandledrejection', event => {
  event.preventDefault(); active = false
  const reason: unknown = event.reason
  scope.postMessage({ type: 'failed', message: reason instanceof Error ? reason.message.slice(0, 512) : 'Promise rejeitada em segundo plano.' })
})
scope.onmessage = event => {
  const request = event.data as { type: string; requestId: number; entry: string; pluginId: string; apiVersion: number; widgetId: string; actionId: string; event: WidgetEvent; id: number; result: { ok: boolean; value: DataSnapshot; error: string } }
  if (request.type === 'data-result') {
    const pending = dataPending.get(request.id)
    if (pending) { dataPending.delete(request.id); if (request.result.ok) pending.resolve(request.result.value); else pending.reject(new Error(request.result.error)) }
    return
  }
  sequence = sequence.then(async () => {
    try {
      if (request.type === 'activate') {
        const module = await import(/* @vite-ignore */ request.entry) as { activate?: (context: PluginContext | PluginContextV2) => PluginInstance | Promise<PluginInstance> }
        if (typeof module.activate !== 'function') throw new Error('O módulo não exporta activate(context).')
        active = true
        instance = await module.activate(Object.freeze({
          pluginId: request.pluginId,
          publishWidget(widgetId: string, view: unknown) { if (active) scope.postMessage({ type: 'widget', widgetId, view }) },
          reportStatus(message: string) { scope.postMessage({ type: 'status', message }) },
          ...(request.apiVersion === 2 ? { data: Object.freeze({ read: () => dataRequest('read'), write: (revision: number, document: DataDocument) => dataRequest('write', revision, document) }) } : {})
        }))
        if (!instance || typeof instance.dispose !== 'function' || (instance.onAction !== undefined && typeof instance.onAction !== 'function')) throw new Error('activate deve retornar uma instância com dispose().')
      } else if (request.type === 'dispose') {
        active = false; await instance?.dispose(); instance = undefined
      } else if (request.type === 'action') {
        if (!active || !instance?.onAction) throw new Error('O plugin não possui essa ação.')
        await instance.onAction(request.widgetId, request.actionId)
      } else if (request.type === 'event') {
        if (!active || !instance?.onEvent) throw new Error('O plugin não possui esse evento.')
        await instance.onEvent(request.widgetId, request.event)
      } else throw new Error('Operação de runtime inválida.')
      scope.postMessage({ type: 'done', requestId: request.requestId })
    } catch (error) {
      active = false
      scope.postMessage({ type: 'failed', message: error instanceof Error ? error.message.slice(0, 512) : 'Falha no plugin.' })
    }
  })
}
