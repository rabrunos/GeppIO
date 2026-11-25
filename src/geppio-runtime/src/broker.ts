import { sameEndpoint, validRequest } from '@geppio/plugin-sdk'
import type { Delivery, Outcome, PeerEndpoint, Request, SurfaceContract, SurfaceError } from '@geppio/plugin-sdk'

export interface Principal { id: string; generation: string; contract: SurfaceContract }
interface Client { owner: Principal; control: boolean; send(message: Delivery): void }
interface Call { source: Client; target: Client; id: number; endpoint: PeerEndpoint; deadline: number }
export interface Connection { receive(value: unknown): void; close(): void }

/** Identity is captured by the host at attachment. Grants bind both live
 * generations and one exact endpoint. Requests contain no caller field. */
export class SurfaceBroker {
  private clients = new Set<Client>()
  private controls = new Map<string, Client>()
  private grants = new Set<string>()
  private calls = new Map<number, Call>()
  private sequence = 0
  private grantKey(source: Principal, target: Principal, endpoint: PeerEndpoint): string {
    return [source.id, source.generation, target.id, target.generation, endpoint.kind, endpoint.name, endpoint.version].join('/')
  }
  permitted(source: Principal, endpoint: PeerEndpoint): boolean {
    const provider = this.controls.get(endpoint.provider)?.owner
    return !!provider && this.controls.get(source.id)?.owner === source && this.grants.has(this.grantKey(source, provider, endpoint))
  }
  grant(source: Principal, endpoint: PeerEndpoint, allow: boolean): boolean {
    const target = this.controls.get(endpoint.provider)?.owner
    if (!target || this.controls.get(source.id)?.owner !== source || !source.contract.uses.some(use => use.provider === target.id && sameEndpoint(use, endpoint))
      || !target.contract.offers.some(offer => sameEndpoint(offer, endpoint))) return false
    const key = this.grantKey(source, target, endpoint)
    if (allow) this.grants.add(key)
    else {
      this.grants.delete(key)
      for (const [ticket, call] of this.calls) if (call.source.owner === source && call.target.owner === target && sameEndpoint(call.endpoint, endpoint)) this.finish(ticket, { ok: false, error: 'denied' })
    }
    return true
  }
  attach(owner: Principal, control: boolean, send: Client['send']): Connection {
    if (control ? this.controls.has(owner.id) : this.controls.get(owner.id)?.owner !== owner) throw new Error('Stale surface generation')
    const client = { owner, control, send }
    this.clients.add(client)
    if (control) this.controls.set(owner.id, client)
    let windowStart = 0, count = 0
    return {
      receive: value => {
        if (!this.clients.has(client)) return
        const now = Date.now()
        if (now - windowStart >= 1000) { windowStart = now; count = 0 }
        if (++count > 120 || !validRequest(value)) return
        this.handle(client, value)
      },
      close: () => this.remove(client)
    }
  }
  expire(now: number): void {
    for (const [ticket, call] of this.calls) if (call.deadline <= now) this.finish(ticket, { ok: false, error: 'cancelled' })
  }
  private finish(ticket: number, outcome: Outcome): void {
    const call = this.calls.get(ticket)
    if (!call) return
    this.calls.delete(ticket)
    if (!outcome.ok && this.clients.has(call.target)) call.target.send({ v: 1, type: 'cancel', id: ticket })
    if (this.clients.has(call.source)) call.source.send({ v: 1, type: 'result', id: call.id, outcome })
  }
  private remove(client: Client): void {
    if (!this.clients.delete(client)) return
    if (client.control) {
      this.controls.delete(client.owner.id)
      for (const key of this.grants) {
        const [from, , to] = key.split('/')
        if (from === client.owner.id || to === client.owner.id) this.grants.delete(key)
      }
      for (const view of this.clients) if (view.owner === client.owner) this.remove(view)
    }
    for (const [ticket, call] of this.calls) if (call.source === client || call.target === client) this.finish(ticket, { ok: false, error: 'unavailable' })
  }
  private handle(client: Client, request: Request): void {
    const { op, id, endpoint, value = '' } = request
    const reply = (outcome: Outcome) => client.send({ v: 1, type: 'result', id, outcome })
    const fail = (error: SurfaceError) => reply({ ok: false, error })
    if (op === 'reply') {
      if (this.calls.get(id)?.target === client) this.finish(id, request.ok ? { ok: true, value } : { ok: false, error: 'failed' })
      return
    }
    if (op === 'cancel') {
      for (const [ticket, call] of this.calls) if (call.source === client && call.id === id) this.finish(ticket, { ok: false, error: 'cancelled' })
      return
    }
    if (!endpoint) return fail('invalid')
    const target = this.controls.get(endpoint.provider)
    if (!target) return fail('unavailable')
    if (!target.owner.contract.offers.some(offer => sameEndpoint(offer, endpoint))) return fail('incompatible')
    if (op === 'emit') {
      if (target.owner !== client.owner || endpoint.kind !== 'event') return fail('denied')
      for (const subscriber of this.clients) if (this.permitted(subscriber.owner, endpoint))
        subscriber.send({ v: 1, type: 'event', id, from: client.owner.id, endpoint, value })
      return reply({ ok: true, value: '' })
    }
    if (!this.permitted(client.owner, endpoint)) return fail('denied')
    if (op === 'available') return reply({ ok: true, value: 'available' })
    if (endpoint.kind !== 'command' && endpoint.kind !== 'service') return fail('invalid')
    if (this.calls.size >= 64 || [...this.calls.values()].some(call => call.source === client && call.id === id)) return fail('busy')
    const ticket = ++this.sequence
    this.calls.set(ticket, { source: client, target, id, endpoint, deadline: Date.now() + 5000 })
    target.send({ v: 1, type: 'invoke', id: ticket, from: client.owner.id, endpoint, value })
  }
}
