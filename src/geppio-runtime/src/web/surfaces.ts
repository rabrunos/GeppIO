import { SurfaceBroker } from '../broker.ts'
import type { Principal } from '../broker.ts'
import type { PeerEndpoint, SurfaceContract } from '@geppio/plugin-sdk'

export interface SurfacePlugin { revision: string; generation?: string; manifest: { id: string; surface?: SurfaceContract } }
export interface SurfaceController {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(value: unknown): void
  terminate(): void
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
/** Owned by one renderer activation, never exposed on Window. Controllers
 * survive widget unmount. Each presentation gets its own revocable port. */
export class WebSurfaces {
  private broker = new SurfaceBroker()
  private owners = new Map<string, Principal>()
  private frames = new Map<() => void, Principal>()
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setInterval>
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed() { for (const listener of this.listeners) listener() }
  private mount(owner: Principal, control: boolean, root: HTMLElement, ready: () => void, failed: () => void) {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.title = owner.id
    frame.dataset.surfaceOwner = owner.id
    frame.style.cssText = 'width:100%;height:100%;border:0'
    if (control) frame.hidden = true
    const channel = new MessageChannel()
    const connection = this.broker.attach(owner, control, message => channel.port1.postMessage(message))
    let connected = false, closed = false, acknowledged = false
    const timer = setTimeout(() => { if (!closed && !acknowledged) { close(); failed() } }, 3000)
    const close = () => {
      if (closed) return
      closed = true
      this.frames.delete(close)
      clearTimeout(timer); connection.close(); channel.port1.close(); channel.port2.close(); frame.remove()
    }
    this.frames.set(close, owner)
    channel.port1.onmessage = event => {
      if (closed) return
      if (!acknowledged) {
        if (isRecord(event.data) && event.data.type === 'ready' && event.data.v === 1) {
          acknowledged = true; clearTimeout(timer); ready()
        }
        return
      }
      connection.receive(event.data)
    }
    frame.addEventListener('load', () => {
      if (closed) return
      if (connected || !frame.contentWindow) { close(); failed(); return }
      connected = true
      frame.contentWindow.postMessage({ v: 1, type: 'geppio-connect', mode: control ? 'activation' : 'view' }, '*', [channel.port2])
    })
    frame.src = 'geppio-surface://' + owner.generation + '/' + owner.id + '/index.html'
    root.append(frame)
    return close
  }
  controller(plugin: SurfacePlugin): SurfaceController {
    if (!plugin.manifest.surface) throw new Error('Missing surface contract')
    const owner: Principal = { id: plugin.manifest.id, generation: (plugin.generation ?? plugin.revision), contract: plugin.manifest.surface! }
    let stopped = false
    const adapter: SurfaceController = {
      onmessage: null, onmessageerror: null, onerror: null,
      postMessage: (request: unknown) => {
        if (!isRecord(request)) return
        const done = () => adapter.onmessage?.(new MessageEvent('message', { data: { type: 'done', requestId: request.requestId } }))
        if (request.type === 'dispose') { adapter.terminate(); done(); return }
        if (request.type !== 'activate' || stopped) return
        if (this.owners.has(owner.id)) throw new Error('Surface already active')
        this.owners.set(owner.id, owner)
        this.timer ??= setInterval(() => this.broker.expire(Date.now()), 500)
        this.mount(owner, true, document.body, done, () => adapter.onmessage?.(new MessageEvent('message', { data: { type: 'failed', message: 'A superfície não concluiu a ativação.' } })))
      },
      terminate: () => {
        stopped = true
        for (const [close, principal] of this.frames) if (principal === owner) close()
        if (this.owners.get(owner.id) === owner) this.owners.delete(owner.id)
        if (!this.owners.size) { clearInterval(this.timer); this.timer = undefined }
        this.changed()
      }
    }
    return adapter
  }
  presentation(plugin: SurfacePlugin, root: HTMLElement, failed: () => void) {
    const owner = this.owners.get(plugin.manifest.id)
    if (owner?.generation === (plugin.generation ?? plugin.revision)) return this.mount(owner, false, root, () => undefined, failed)
    failed()
  }
  permitted(id: string, endpoint: PeerEndpoint) {
    const owner = this.owners.get(id)
    return !!owner && this.broker.permitted(owner, endpoint)
  }
  permissionChange(source: SurfacePlugin, provider: SurfacePlugin | undefined, endpoint: PeerEndpoint) {
    const owner = this.owners.get(source.manifest.id), target = this.owners.get(endpoint.provider)
    if (!provider || !owner || !target || provider.manifest.id !== endpoint.provider
      || owner.generation !== (source.generation ?? source.revision)
      || target.generation !== (provider.generation ?? provider.revision)) return undefined
    return (allow: boolean) => {
      if (this.owners.get(owner.id) !== owner || this.owners.get(target.id) !== target) return
      if (this.broker.grant(owner, endpoint, allow)) this.changed()
    }
  }
}
