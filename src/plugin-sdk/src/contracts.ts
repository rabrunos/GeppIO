/** API 3 message protocol. Native capabilities are outside this namespace. */
export const protocolVersion = 1
export type ChannelKind = 'command' | 'service' | 'event' | 'slot'
export interface Endpoint { kind: ChannelKind; name: string; version: number }
export interface PeerEndpoint extends Endpoint { provider: string }
export interface SurfaceContract {
  html: string
  css: string
  offers: Endpoint[]
  uses: PeerEndpoint[]
}
export type SurfaceError = 'invalid' | 'denied' | 'unavailable' | 'incompatible' | 'cancelled' | 'busy' | 'failed'
export type Outcome = { ok: true; value: string } | { ok: false; error: SurfaceError }
export type Operation = 'call' | 'available' | 'cancel' | 'reply' | 'emit'
export interface Request { v: 1; op: Operation; id: number; endpoint?: PeerEndpoint; value?: string; ok?: boolean }
export interface Delivery {
  v: 1
  type: 'invoke' | 'cancel' | 'event' | 'result'
  id: number
  from?: string
  endpoint?: Endpoint
  value?: string
  outcome?: Outcome
}
export function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value)
    && !Object.hasOwn(Object.prototype, value)
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function validEndpoint(value: unknown, peer = false): boolean {
  if (!object(value) || Object.keys(value).length !== (peer ? 4 : 3)) return false
  return typeof value.kind === 'string' && ['command', 'service', 'event', 'slot'].includes(value.kind) && validName(value.name)
    && Number.isSafeInteger(value.version) && Number(value.version) >= 1 && Number(value.version) <= 255
    && (!peer || validName(value.provider))
}
export function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return a.kind === b.kind && a.name === b.name && a.version === b.version
}
export function validContract(value: unknown): value is SurfaceContract {
  if (!object(value) || Object.keys(value).length !== 4 || typeof value.html !== 'string' || typeof value.css !== 'string') return false
  return ([['offers', false], ['uses', true]] as const).every(([field, peer]) => {
    const list: unknown = value[field]
    if (!Array.isArray(list) || list.length > 16 || !list.every(item => validEndpoint(item, peer))) return false
    return new Set(list.map(item => [item.provider, item.kind, item.name, item.version].join('/'))).size === list.length
  })
}
export function validRequest(value: unknown): value is Request {
  if (!object(value) || value.v !== 1 || !Number.isSafeInteger(value.id) || Number(value.id) < 1) return false
  const fields = Object.keys(value).sort().join(',')
  if (value.op === 'cancel') return fields === 'id,op,v'
  if (value.op === 'reply') return fields === 'id,ok,op,v,value' && typeof value.ok === 'boolean' && typeof value.value === 'string' && value.value.length <= 8192
  if (!validEndpoint(value.endpoint, true)) return false
  if (value.op === 'available') return fields === 'endpoint,id,op,v'
  return (value.op === 'call' || value.op === 'emit') && fields === 'endpoint,id,op,v,value' && typeof value.value === 'string' && value.value.length <= 8192
}
