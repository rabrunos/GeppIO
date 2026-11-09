import type { LayoutStorage } from '../storage.ts'
import { readFreeform } from '../freeform/storage.ts'
import { FREEFORM_KEY } from '../freeform/policy.ts'
import { adoptLayout, initialWorkbench, WORKBENCH_KEY } from './model.ts'
import type { Registry, WorkbenchSnapshot } from './model.ts'
import { parseWorkbench, serializeWorkbench } from './codec.ts'
import { retireDemoViews } from './retirement.ts'

export function readWorkbench(storage: LayoutStorage, registry: Registry) {
  const legacy = readFreeform(storage)
  let raw: string | null = null, previous: string | null = null
  try {
    raw = storage.getItem(WORKBENCH_KEY); previous = storage.getItem(FREEFORM_KEY)
    if (raw !== null) return { ...legacy, snapshot: parseWorkbench(raw, registry), raw, previous, recovery: false, message: 'Composição protegida.' }
    return { ...legacy, snapshot: previous === null && !legacy.recovery ? initialWorkbench([...registry.values()].some(type => type.fixture && !type.retired)) : retireDemoViews(adoptLayout(legacy.snapshot), registry), raw, previous, recovery: legacy.recovery || previous !== null,
      message: previous !== null ? 'Composição anterior preservada. Adote uma prévia em Configurações.' : legacy.message }
  } catch {
    return { ...legacy, snapshot: initialWorkbench(), raw, previous, recovery: true,
      message: 'Composição incompatível, plugin ausente ou armazenamento indisponível. Dados preservados; escolha uma prévia explícita em Configurações.' }
  }
}
export function writeWorkbench(storage: LayoutStorage, snapshot: WorkbenchSnapshot, registry: Registry, expected: string | null, legacyExpected?: string | null) {
  try {
    const raw = serializeWorkbench(snapshot, registry)
    if (storage.getItem(WORKBENCH_KEY) !== expected || (legacyExpected !== undefined && storage.getItem(FREEFORM_KEY) !== legacyExpected)) {
      return { raw: expected, error: 'A composição salva mudou em outra sessão. Sua prévia foi mantida; reabra para recuperar.' }
    }
    storage.setItem(WORKBENCH_KEY, raw)
    return { raw, error: null }
  } catch { return { raw: expected, error: 'Não foi possível salvar. A prévia e todos os dados anteriores foram preservados.' } }
}
