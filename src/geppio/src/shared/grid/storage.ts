import type { LayoutStorage } from '../storage.ts'
import { IDENTITY } from '../identity.ts'
import { DEFAULT_GRID, GRID_KEY } from './policy.ts'
import { migrateV1, parseGrid } from './schema.ts'
import type { GridSnapshot } from './types.ts'

export interface GridRestoration { snapshot: GridSnapshot; raw: string | null; writable: boolean; recovery: boolean; message: string }
export function readGrid(storage: LayoutStorage): GridRestoration {
  let raw: string | null = null
  try {
    raw = storage.getItem(GRID_KEY)
    if (raw !== null) return { snapshot: parseGrid(raw), raw, writable: true, recovery: false, message: 'Modo de uso · layout protegido.' }
    const legacy = storage.getItem(IDENTITY.layoutStorageKey)
    if (legacy !== null) return { snapshot: migrateV1(legacy), raw, writable: false, recovery: false,
      message: 'Prévia do layout v1 convertido. Edite e salve para confirmar a grade; os dados antigos serão preservados.' }
    return { snapshot: structuredClone(DEFAULT_GRID), raw, writable: true, recovery: false, message: 'Modo de uso · layout protegido.' }
  } catch {
    return { snapshot: structuredClone(DEFAULT_GRID), raw, writable: false, recovery: true,
      message: 'Não foi possível converter ou restaurar o layout. Dados preservados. Em Configurações, importe uma cópia válida ou abra uma prévia da composição inicial.' }
  }
}
/** Compare observed bytes before writing. Save never overwrites a concurrent/newer draft. */
export function writeGrid(storage: LayoutStorage, snapshot: GridSnapshot, expected: string | null): { raw: string | null; error: string | null } {
  try {
    const validated = parseGrid(JSON.stringify(snapshot))
    if (storage.getItem(GRID_KEY) !== expected) return { raw: expected, error: 'O layout salvo mudou em outra sessão. Reabra o aplicativo antes de salvar; sua prévia foi mantida.' }
    const raw = JSON.stringify(validated); storage.setItem(GRID_KEY, raw)
    return { raw, error: null }
  } catch { return { raw: expected, error: 'Não foi possível salvar localmente. A prévia permanece nesta sessão; tente novamente ou cancele.' } }
}
