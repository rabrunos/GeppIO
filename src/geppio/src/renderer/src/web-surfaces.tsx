import { useEffect, useRef, useState } from 'react'
import { WebSurfaces } from '@geppio/runtime/web'
import type { InstalledPlugin } from '../../shared/plugins.ts'
import { codeGeneration } from '../../shared/plugins.ts'

function useGrants(host: WebSurfaces) {
  const [, refresh] = useState(0)
  useEffect(() => host.subscribe(() => refresh(i => i + 1)), [host])
}
export function SurfaceGrants({ plugin, host, active }: { plugin: InstalledPlugin; host: WebSurfaces; active: readonly InstalledPlugin[] }) {
  useGrants(host)
  return <>{plugin.manifest.surface?.uses.map(use => {
    const provider = active.find(target => target.manifest.id === use.provider && target.manifest.surface?.offers.some(e => e.kind === use.kind && e.name === use.name && e.version === use.version))
    const change = host.permissionChange(plugin, provider, use)
    return <label key={[use.provider, use.name, use.kind, use.version].join('/')}>
      <input type="checkbox" disabled={!change} checked={host.permitted(plugin.manifest.id, use)} onChange={event => change?.(event.currentTarget.checked)} />
      Permitir {use.kind} {use.provider} / {use.name} v{use.version}
    </label>
  })}</>
}
function Presentation({ plugin, host }: { plugin: InstalledPlugin; host: WebSurfaces }) {
  const root = useRef<HTMLDivElement>(null), [failure, setFailure] = useState(false)
  const generation = codeGeneration(plugin)
  useEffect(() => {
    setFailure(false)
    if (root.current) return host.presentation(plugin, root.current, () => setFailure(true))
    // Inventory refreshes can replace metadata objects without reloading accepted code.
  }, [host, plugin.manifest.id, generation])
  return <div ref={root} style={{ minHeight: 96, height: '100%' }}>{failure && <p role="status">A superfície não ficou disponível.</p>}</div>
}
export function WebWidget({ host, plugin, active }: { host: WebSurfaces; plugin: InstalledPlugin; active: readonly InstalledPlugin[] }) {
  useGrants(host)
  const guests = active.filter(other => other.manifest.surface?.uses.some(use => use.kind === 'slot' && use.provider === plugin.manifest.id && host.permitted(other.manifest.id, use)))
  return <section data-plugin-widget={plugin.manifest.id + ':' + plugin.manifest.widgets[0]!.id}>
    <Presentation host={host} plugin={plugin} />
    {guests.map(other => <section key={other.manifest.id} aria-label={'Contribuição de ' + other.manifest.name}><Presentation host={host} plugin={other} /></section>)}
  </section>
}
