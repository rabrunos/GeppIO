import type { PluginContext, PluginInstance } from '../../../../sdk/plugin.d.ts'

export function activate(context: PluginContext): PluginInstance {
  let count = 0
  const render = () => context.publishWidget('counter', { text: `Cliques nesta ativação: ${count}`, action: { id: 'increment', label: 'Incrementar' } })
  render()
  context.reportStatus('Contador iniciado no Worker, sem Node ou documento.')
  return {
    onAction(widgetId, actionId) { if (widgetId === 'counter' && actionId === 'increment') { count++; render() } },
    dispose() { context.reportStatus('Contador descartado.') }
  }
}
