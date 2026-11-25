import type { Delivery, Endpoint, Outcome, PeerEndpoint, Request } from './contracts.ts'

export interface SurfaceAPI {
  ready(): void
  mode: 'activation' | 'view'
  call(endpoint: PeerEndpoint, value: string, signal?: AbortSignal): Promise<Outcome>
  available(endpoint: PeerEndpoint): Promise<Outcome>
  emit(endpoint: PeerEndpoint, value: string): Promise<Outcome>
  onInvoke(handler: (endpoint: Endpoint, value: string, caller: string, signal: AbortSignal) => Promise<string> | string): void
  onEvent(handler: (endpoint: Endpoint, value: string, caller: string) => void): void
}
declare global { interface Window { geppioSurface: Promise<SurfaceAPI> } }

/** Self-contained browser bootstrap installed into the isolated document by
 * the host. Its only transport is a port transferred by its direct parent. */
export function initializeSurface(): void {
  window.geppioSurface = new Promise(resolve => {
    const connect = (event: MessageEvent) => {
      if (event.source !== parent || event.data?.v !== 1 || event.data.type !== 'geppio-connect' || event.ports.length !== 1) return
      window.removeEventListener('message', connect)
      const port = event.ports[0]!
      let sequence = 0
      const pending = new Map<number, (result: Outcome) => void>()
      const active = new Map<number, AbortController>()
      let invoke: Parameters<SurfaceAPI['onInvoke']>[0] | undefined
      let notify: Parameters<SurfaceAPI['onEvent']>[0] | undefined
      const send = (request: Request) => port.postMessage(request)
      const request = (op: 'available' | 'call' | 'emit', endpoint: PeerEndpoint, value?: string, signal?: AbortSignal): Promise<Outcome> =>
        new Promise(done => {
          if (signal?.aborted || pending.size >= 32) { done({ ok: false, error: signal?.aborted ? 'cancelled' : 'busy' }); return }
          const id = ++sequence
          const cancel = () => { send({ v: 1, op: 'cancel', id }); settle({ ok: false, error: 'cancelled' }) }
          const timer = setTimeout(cancel, 6000)
          const settle = (result: Outcome) => {
            clearTimeout(timer); signal?.removeEventListener('abort', cancel); pending.delete(id); done(result)
          }
          pending.set(id, settle)
          signal?.addEventListener('abort', cancel, { once: true })
          send({ v: 1, op, id, endpoint, ...(op === 'available' ? {} : { value }) })
        })
      port.onmessage = async ({ data }: MessageEvent<Delivery>) => {
        if (data.v !== 1) return
        if (data.type === 'result' && data.outcome) pending.get(data.id)?.(data.outcome)
        if (data.type === 'event' && data.endpoint && data.from) notify?.(data.endpoint, data.value ?? '', data.from)
        if (data.type === 'cancel') active.get(data.id)?.abort()
        if (data.type === 'invoke' && data.endpoint && data.from) {
          const signal = new AbortController()
          active.set(data.id, signal)
          try {
            if (!invoke) throw new Error()
            const result = await invoke(data.endpoint, data.value ?? '', data.from, signal.signal)
            if (!signal.signal.aborted) send({ v: 1, op: 'reply', id: data.id, value: result, ok: true })
          } catch { send({ v: 1, op: 'reply', id: data.id, value: '', ok: false }) }
          finally { active.delete(data.id) }
        }
      }
      resolve({ ready: () => port.postMessage({ v: 1, type: 'ready' }), mode: event.data.mode,
        call: (ep, v, signal) => request('call', ep, v, signal), available: ep => request('available', ep), emit: (ep, v) => request('emit', ep, v),
        onInvoke: handler => { invoke = handler }, onEvent: handler => { notify = handler }
      })
    }
    window.addEventListener('message', connect)
  })
}
