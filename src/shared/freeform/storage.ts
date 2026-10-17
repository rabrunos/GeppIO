import type { LayoutStorage } from '../storage.ts'
import { IDENTITY } from '../identity.ts'
import { GRID_KEY } from '../grid/policy.ts'
import { HORIZONTAL_KEY } from '../grid/horizontal.ts'
import { DEFAULT_FREEFORM, FREEFORM_KEY } from './policy.ts'
import { parseFreeform } from './schema.ts'
import type { HistoricalKind } from './migration.ts'
import type { Snapshot } from './types.ts'

export interface HistoricalChoice { kind: HistoricalKind; raw: string; label: string }
export function readFreeform(storage: LayoutStorage) {
  let raw: string | null = null
  const choices: HistoricalChoice[] = []
  try {
    raw = storage.getItem(FREEFORM_KEY)
    for (const [kind, key, label] of [
      ['fractional', IDENTITY.layoutStorageKey, 'Fracionário v1'], ['grid', GRID_KEY, 'Responsivo v2'], ['horizontal', HORIZONTAL_KEY, 'Horizontal v1']
    ] as const) {
      const old = storage.getItem(key)
      if (old !== null) choices.push({ kind, raw: old, label })
    }
    if (raw !== null) return { snapshot: parseFreeform(raw), raw, choices, recovery: false, message: 'Modo de uso · layout livre protegido.' }
    return { snapshot: structuredClone(DEFAULT_FREEFORM), raw, choices, recovery: choices.length > 0,
      message: choices.length ? 'Layouts anteriores preservados. Escolha uma prévia em Configurações e salve para adotar o layout livre.' : 'Modo de uso · layout livre protegido.' }
  } catch {
    return { snapshot: structuredClone(DEFAULT_FREEFORM), raw, choices, recovery: true,
      message: 'Layout inválido ou armazenamento indisponível. Dados preservados. Importe uma cópia válida ou escolha uma prévia em Configurações.' }
  }
}
/** Same-origin Web Lock in the transaction serializes cooperative writers; byte CAS also
 * rejects stale/uncooperative updates observed before the synchronous write. No database
 * guarantee is made for plugins that share origin storage authority.
 */
export function writeFreeform(storage: LayoutStorage, snapshot: Snapshot, expected: string | null) {
  try {
    const raw = JSON.stringify(parseFreeform(JSON.stringify(snapshot)))
    if (storage.getItem(FREEFORM_KEY) !== expected) return { raw: expected, error: 'O layout salvo mudou em outra sessão. Reabra o aplicativo; sua prévia foi mantida.' }
    storage.setItem(FREEFORM_KEY, raw)
    return { raw, error: null }
  } catch { return { raw: expected, error: 'Não foi possível salvar. A prévia e os dados anteriores foram preservados; tente novamente ou cancele.' } }
}
