import { decodeLayout } from './layout.ts'
import type { LayoutSnapshot, MinSize } from './layout.ts'

/** Preserve any destination bytes, including corruption. Only validate/canonicalize a missing key. */
export function migratedLayout(legacy: unknown, current: string | null, fallback: LayoutSnapshot, minimums: Readonly<Record<string, MinSize>>): string | null {
  if (current !== null || legacy === null) return null
  if (typeof legacy !== 'string') throw new Error('Legacy layout is not text.')
  return JSON.stringify(decodeLayout(legacy, fallback.placements.map(p => p.id), minimums))
}
