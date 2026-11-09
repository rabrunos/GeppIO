import { isRecord } from './plugins.ts'
import type { DataDocument, DataSnapshot, Json } from '../../sdk/plugin-v2.d.ts'
import type { PluginResult } from './plugins.ts'
export type { DataDocument, DataSnapshot } from '../../sdk/plugin-v2.d.ts'

export const DATA_LIMITS = Object.freeze({ bytes: 128 * 1024, depth: 12, nodes: 4096, queue: 16, rate: 20 })
export function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)) }
export function dataRevision(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < Number.MAX_SAFE_INTEGER }
/** Bound traversal before stringify. Return an immutable-by-ownership JSON copy. */
export function parseDataDocument(value: unknown): DataDocument {
  let nodes = 0, bytes = 0
  const seen = new Set<object>()
  function visit(item: unknown, depth: number): Json {
    if (++nodes > DATA_LIMITS.nodes || depth > DATA_LIMITS.depth) throw new Error('Documento excede os limites de estrutura.')
    if (typeof item === 'string') { if (item.length > DATA_LIMITS.bytes) throw new Error('Documento maior que 128 KiB.'); bytes += new TextEncoder().encode(item).length; if (bytes > DATA_LIMITS.bytes) throw new Error('Documento maior que 128 KiB.'); return item }
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item === 0 ? 0 : item
    if (typeof item !== 'object' || item === null || seen.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) throw new Error('Documento JSON inválido.')
    seen.add(item)
    if (Array.isArray(item)) { if (item.length > DATA_LIMITS.nodes || Object.keys(item).length !== item.length || Array.from({ length: item.length }, (_, index) => !Object.hasOwn(item, index)).some(Boolean)) throw new Error('Lista inválida ou muito grande.'); const result = item.map(child => visit(child, depth + 1)); seen.delete(item); return result }
    const keys = Object.keys(item)
    if (keys.length > DATA_LIMITS.nodes) throw new Error('Documento com campos demais.')
    const result: Record<string, Json> = {}
    for (const key of keys) { if (key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Campo de documento inválido.'); bytes += new TextEncoder().encode(key).length; result[key] = visit((item as Record<string, unknown>)[key], depth + 1) }
    seen.delete(item); return result
  }
  if (!isRecord(value) || !exactKeys(value, ['schemaVersion', 'value']) || value.schemaVersion !== 1 || !Object.hasOwn(value, 'value')) throw new Error('Versão ou documento de dados inválido.')
  const result: DataDocument = { schemaVersion: 1, value: visit(value.value, 0) }
  if (new TextEncoder().encode(JSON.stringify(result)).length > DATA_LIMITS.bytes) throw new Error('Documento maior que 128 KiB.')
  return result
}
/** Host-only bridge. Tokens never enter the Worker facade. */
export interface PluginDataBridge {
  begin(id: string, installation: string): Promise<PluginResult<string>>
  read(token: string): Promise<PluginResult<DataSnapshot>>
  write(token: string, expectedRevision: number, document: DataDocument): Promise<PluginResult<DataSnapshot>>
  end(token: string): Promise<PluginResult<null>>
}
