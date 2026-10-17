import { decodeLayout } from '../layout.ts'
import { DEFAULT_LAYOUT, MINIMUMS } from '../layout-defaults.ts'
import { parseGrid } from '../grid/schema.ts'
import { parseHorizontal } from '../grid/horizontal.ts'
import { CONSTRAINTS, DEFAULT_FREEFORM, POLICY } from './policy.ts'
import { parseFreeform } from './schema.ts'
import { projectRegion } from './projection.ts'
import type { Snapshot } from './types.ts'

export type HistoricalKind = 'fractional' | 'grid' | 'horizontal'
/** Explicitly selecting one JSON file chooses a recovery source, still only in preview. */
export function importFreeform(text: string): Snapshot {
  if (text.length > POLICY.maxBytes || new TextEncoder().encode(text).length > POLICY.maxBytes) throw new Error('Oversized layout import')
  const data: unknown = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('schemaVersion' in data)) throw new Error('Unsupported layout import')
  const engine = 'engine' in data ? data.engine : undefined
  if (engine === 'freeform') return parseFreeform(text)
  if (engine === 'horizontal') return convertHistorical(text, 'horizontal')
  if (engine === undefined && data.schemaVersion === 2) return convertHistorical(text, 'grid')
  if (engine === undefined && data.schemaVersion === 1) return convertHistorical(text, 'fractional')
  throw new Error('Unsupported layout import')
}
/** Read-only, continuous conversion with explicit stable pixel references. Old schemas did
 * not record pixel viewports: v1 uses its documented 960×620 canvas; grid uses 70px pitch,
 * horizontal 62px pitch. No rounding, no hidden packing and no dropping widgets.
 * If declared minima/clearance cannot be met, conversion rejects rather than losing intent.
 */
export function convertHistorical(text: string, kind: HistoricalKind): Snapshot {
  if (text.length > POLICY.maxBytes) throw new Error('Oversized historical layout')
  const result = structuredClone(DEFAULT_FREEFORM)
  if (kind === 'fractional') {
    const old = decodeLayout(text, DEFAULT_LAYOUT.placements.map(p => p.id), MINIMUMS)
    result.reference.main = { width: 960, height: 620 }
    result.placements = old.placements.map(p => ({ id: p.id, region: 'main', x: p.x * 960, y: p.y * 620,
      width: p.width * 960, height: p.height * 620, preferred: { width: Math.max(CONSTRAINTS[p.id]!.min.width, p.width * 960), height: Math.max(CONSTRAINTS[p.id]!.min.height, p.height * 620) } }))
    // Continuous interval fitting can add the 10px clearance and enforce today's content
    // minima while retaining every separation. This is a visible conversion preview only.
    const projected = projectRegion(result, 'main', result.reference.main, false)
    if (!projected.feasible) throw new Error('Historical minima cannot fit')
    result.placements = projected.placements
  } else {
    const old = kind === 'grid' ? parseGrid(text) : parseHorizontal(text), pitch = kind === 'grid' ? 70 : 62
    result.reference.main = { width: kind === 'grid' ? old.columns * pitch - 10 : Math.max(960, ...old.placements.map(p => (p.x + p.w) * pitch - 10)), height: old.rows * pitch - 10 }
    result.placements = old.placements.map(p => ({ id: p.id, region: 'main', x: p.x * pitch, y: p.y * pitch,
      width: p.w * pitch - 10, height: p.h * pitch - 10,
      preferred: { width: p.preferred.w * pitch - 10, height: p.preferred.h * pitch - 10 } }))
  }
  return parseFreeform(JSON.stringify(result))
}
