import type { Plugins } from '../usePlugins.ts'

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
