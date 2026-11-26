import { WebWidget } from './web-surfaces.tsx'
import { PluginSurface } from './PluginSurface.tsx'
import { BottomPluginSurface } from './BottomPluginSurface.tsx'
import type { Region } from '@geppio/runtime/layout/types'
import type { WidgetType } from '../../shared/workbench/model.ts'
import { useLocale } from './workbench/Locale.tsx'
import type { Plugins } from './usePlugins.ts'

export function PluginWidgetBody({ definition, plugins, preview = false, region = 'main' }: { definition: WidgetType; plugins: Plugins; preview?: boolean; region?: Region }) {
  const { t } = useLocale(), content = plugins.views.find(view => view.plugin.manifest.id === definition.pluginId)?.widgets[definition.widgetId!]
  const runtime = plugins.views.find(view => view.plugin.manifest.id === definition.pluginId)
  if (!preview && runtime?.status === 'active' && runtime.plugin.manifest.surface) {
    return <WebWidget host={plugins.surfaces} plugin={runtime.plugin} active={plugins.views.filter(item => item.status === 'active').map(item => item.plugin)} />
  }
  const api2 = runtime?.plugin.manifest.apiVersion === 2
  const compactTime = region !== 'main' && definition.pluginId === 'geppio.time-tracker'
  const surface = compactTime && content ? { ...content, text: content.text.split('\n\n')[0]!, actions: content.actions?.filter(action => ['start', 'pause', 'retry'].includes(action.id)) } : content
  const compact = region === 'bottom' && definition.pluginId === 'geppio.workspace-essentials'
  const send = (event: Parameters<typeof plugins.widgetEvent>[2]) => plugins.widgetEvent(definition.pluginId!, definition.widgetId!, event)
  return <div className="host-plugin-content" data-time-compact={compactTime || undefined} data-plugin-widget={!preview && content ? `${definition.pluginId}:${definition.widgetId}` : undefined}>{surface && api2 ? compact ? <BottomPluginSurface view={surface} paused={preview || plugins.busy || runtime?.status !== 'active'} send={send} /> : <PluginSurface view={surface} preview={preview} paused={plugins.busy || runtime?.status !== 'active'} send={send} pluginId={definition.pluginId} /> : <><p>{content?.text ?? t(definition.missing ? 'Widget ausente na geração atual. Referência e posição preservadas para recuperação.' : 'Plugin desativado ou aguardando publicação.')}</p>{content?.action && <button className="ui-button tool-button" disabled={plugins.busy} onClick={preview ? undefined : () => plugins.action(definition.pluginId!, definition.widgetId!, content.action!.id)}>{content.action.label}</button>}</>}</div>
}
