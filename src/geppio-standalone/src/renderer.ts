import { CapabilityRuntime } from '@geppio/runtime'
import type { Capability } from '@geppio/runtime'
import type { Definition } from './composition.ts'
declare const __COMPOSITION__: Definition
declare const __HAS_SURFACES__: boolean
declare const __PLUGINS__: import('@geppio/runtime/web').SurfacePlugin[]
const root = document.querySelector('main')!
const surfaces = new AbortController()
const heading = document.createElement('h1')
heading.textContent = __COMPOSITION__.name
document.title = heading.textContent
root.append(heading)
const definitions: Record<string, Capability> = Object.create(null)
const hosts = new Map<string, HTMLElement>()
for (const tile of __COMPOSITION__.tiles) {
  const section = document.createElement('section'), label = document.createElement('h2')
  label.textContent = tile.title; section.dataset.tile = tile.id; section.append(label); root.append(section)
  hosts.set(tile.id, section)
  if (tile.kind === 'surface') continue
  definitions[tile.id] = { start: () => {
    const key = 'v1/' + tile.kind + '/' + tile.id
    if (tile.kind === 'note') {
      const input = document.createElement('textarea')
      input.setAttribute('aria-label', tile.title)
      input.value = localStorage.getItem(key) ?? ''
      input.oninput = () => localStorage.setItem(key, input.value)
      section.append(input)
      return () => input.remove()
    }
    const button = document.createElement('button')
    let count = Number(localStorage.getItem(key) ?? 0)
    if (!Number.isSafeInteger(count)) throw new Error('Contador salvo inválido.')
    const render = () => { button.textContent = 'Contar · ' + count }
    render(); button.onclick = () => { localStorage.setItem(key, String(count + 1)); count++; render() }
    section.append(button)
    return () => button.remove()
  } }
}
const runtime = new CapabilityRuntime(definitions)
runtime.activate(Object.keys(definitions))
root.dataset.active = runtime.active.join(',')
window.addEventListener('pagehide', () => { surfaces.abort(); runtime.dispose() }, { once: true })
if (__HAS_SURFACES__) {
  void import('./surfaces.ts').then(async ({ mountSurfaces }) => {
    await mountSurfaces(__PLUGINS__, __COMPOSITION__.tiles, hosts, surfaces.signal)
    root.dataset.active = __COMPOSITION__.tiles.map(tile => tile.id).join(',')
  }).catch(() => {
    if (!surfaces.signal.aborted) {
      const error = document.createElement('p'); error.setAttribute('role', 'alert')
      error.textContent = 'Falha ao ativar a superfície.'; root.append(error)
    }
  })
}
