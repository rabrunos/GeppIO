import type { PluginContext, PluginInstance } from '../../shared/plugins.ts'
// No native bridge lives here. The module and all imports come from inspected local assets.
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown): void }
let instance: PluginInstance | undefined
let active = false
let sequence: Promise<void> = Promise.resolve()
self.addEventListener('unhandledrejection', event => {
  event.preventDefault(); active = false
  const reason: unknown = event.reason
  scope.postMessage({ type: 'failed', message: reason instanceof Error ? reason.message.slice(0, 512) : 'Promise rejeitada em segundo plano.' })
})
scope.onmessage = event => {
  const request = event.data as { type: string; requestId: number; entry: string; pluginId: string; widgetId: string; actionId: string }
  sequence = sequence.then(async () => {
    try {
      if (request.type === 'activate') {
        const module = await import(/* @vite-ignore */ request.entry) as { activate?: (context: PluginContext) => PluginInstance | Promise<PluginInstance> }
        if (typeof module.activate !== 'function') throw new Error('O módulo não exporta activate(context).')
        active = true
        instance = await module.activate(Object.freeze({
          pluginId: request.pluginId,
          publishWidget(widgetId: string, view: unknown) { if (active) scope.postMessage({ type: 'widget', widgetId, view }) },
          reportStatus(message: string) { scope.postMessage({ type: 'status', message }) }
        }))
        if (!instance || typeof instance.dispose !== 'function' || (instance.onAction !== undefined && typeof instance.onAction !== 'function')) throw new Error('activate deve retornar uma instância com dispose().')
      } else if (request.type === 'dispose') {
        active = false; await instance?.dispose(); instance = undefined
      } else if (request.type === 'action') {
        if (!active || !instance?.onAction) throw new Error('O plugin não possui essa ação.')
        await instance.onAction(request.widgetId, request.actionId)
      } else throw new Error('Operação de runtime inválida.')
      scope.postMessage({ type: 'done', requestId: request.requestId })
    } catch (error) {
      active = false
      scope.postMessage({ type: 'failed', message: error instanceof Error ? error.message.slice(0, 512) : 'Falha no plugin.' })
    }
  })
}
