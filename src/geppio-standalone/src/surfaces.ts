import { WebSurfaces } from '@geppio/runtime/web'
import type { SurfacePlugin } from '@geppio/runtime/web'
import type { Tile } from './composition.ts'

function presentation(host: WebSurfaces, plugin: SurfacePlugin, root: HTMLElement) {
  const container = document.createElement('div')
  root.append(container)
  const detach = host.presentation(plugin, container, () => {
    container.textContent = 'Superfície indisponível.'
    container.setAttribute('role', 'status')
  })
  return () => { detach?.(); container.remove() }
}

/** Guest frames are supervised siblings in the host DOM. Logical placement
 * inside a provider's tile never changes the principal attached to a port. */
function mountTile(host: WebSurfaces, plugin: SurfacePlugin, all: SurfacePlugin[], root: HTMLElement) {
  const own = presentation(host, plugin, root)
  const controls = document.createElement('div')
  root.append(controls)
  const guests = new Map<string, () => void>()
  for (const use of plugin.manifest.surface!.uses) {
    const label = document.createElement('label'), checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const provider = all.find(p => p.manifest.id === use.provider && p.manifest.surface?.offers.some(
      offer => offer.kind === use.kind && offer.name === use.name && offer.version === use.version))
    const change = host.permissionChange(plugin, provider, use)
    checkbox.disabled = !change
    checkbox.onchange = () => {
      change?.(checkbox.checked)
      checkbox.checked = host.permitted(plugin.manifest.id, use)
    }
    label.append(checkbox, 'Permitir ' + use.kind + ' ' + use.provider + ' / ' + use.name + ' v' + use.version)
    controls.append(label)
  }
  const sync = () => {
    for (const other of all) {
      const id = other.manifest.id
      const allowed = other.manifest.surface?.uses.some(use =>
        use.kind === 'slot' && use.provider === plugin.manifest.id && host.permitted(id, use))
      if (allowed && !guests.has(id)) {
        const slot = document.createElement('section')
        slot.setAttribute('aria-label', 'Contribuição de ' + id)
        root.append(slot)
        const detach = presentation(host, other, slot)
        guests.set(id, () => { detach(); slot.remove() })
      } else if (!allowed && guests.has(id)) {
        guests.get(id)!()
        guests.delete(id)
      }
    }
  }
  const unsubscribe = host.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    for (const release of guests.values()) release()
    controls.remove()
    own()
  }
}

export async function mountSurfaces(plugins: SurfacePlugin[], tiles: Tile[], hosts: Map<string, HTMLElement>, signal: AbortSignal) {
  const host = new WebSurfaces(), cleanup: (() => void)[] = []
  const close = () => { for (const fn of cleanup.splice(0).reverse()) fn() }
  signal.throwIfAborted()
  signal.addEventListener('abort', close, { once: true })
  try {
    for (const plugin of plugins) {
      const controller = host.controller(plugin)
      cleanup.push(() => controller.terminate())
      await new Promise<void>((resolve, reject) => {
        const cancel = () => reject(signal.reason)
        signal.addEventListener('abort', cancel, { once: true })
        controller.onmessage = ({ data }) => {
          signal.removeEventListener('abort', cancel)
          if ((data as { type: string }).type === 'done') resolve()
          else reject(new Error('Activation failed'))
        }
        controller.postMessage({ type: 'activate', requestId: 1 })
      })
      signal.throwIfAborted()
    }
    const selected = tiles.filter(tile => tile.kind === 'surface')
    for (const [index, tile] of selected.entries()) {
      cleanup.push(mountTile(host, plugins[index]!, plugins, hosts.get(tile.id)!))
    }
  } catch (error) {
    signal.removeEventListener('abort', close)
    close()
    throw error
  }
}
