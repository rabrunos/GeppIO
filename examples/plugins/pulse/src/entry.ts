import type { PluginContext, PluginInstance } from '../../../../sdk/plugin.d.ts'

export function activate(context: PluginContext): PluginInstance {
  let ticks = 0
  context.reportStatus('Pulso iniciado; nenhum widget contribuído.')
  const timer = setInterval(() => context.reportStatus(`Pulso ${++ticks}`), 1000)
  return { dispose() { clearInterval(timer); context.reportStatus('Pulso descartado; timer liberado.') } }
}
