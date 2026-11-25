import { DEFAULT_LAYOUT, MINIMUMS } from '../layout-defaults.ts'
import { decodeLayout, MAX_LAYOUT_BYTES } from '../layout.ts'
import { clamp, validBounds } from './geometry.ts'
import { overlaps, validLayout } from './occupancy.ts'
import { constraintsFor, GRID_IDS, GRID_POLICY } from './policy.ts'
import type { GridBounds, GridPlacement, GridSnapshot } from './types.ts'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function parseGrid(text: string): GridSnapshot {
  if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) throw new Error('Grid input too large')
  const data: unknown = JSON.parse(text)
  if (!object(data) || data.schemaVersion !== 2 || (data.theme !== 'dark' && data.theme !== 'light')) throw new Error('Unsupported grid schema')
  const bounds = { columns: data.columns, rows: data.rows } as GridBounds
  if (!validBounds(bounds) || !Array.isArray(data.placements) || data.placements.length !== GRID_IDS.length) throw new Error('Invalid grid bounds or widget count')
  const placements: GridPlacement[] = data.placements.map((p: unknown) => {
    if (!object(p) || typeof p.id !== 'string' || !GRID_IDS.includes(p.id) || !object(p.preferred)) throw new Error('Invalid grid widget')
    return { id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, preferred: { w: p.preferred.w, h: p.preferred.h } } as GridPlacement
  })
  if (!validLayout(placements, bounds, constraintsFor(bounds))) throw new Error('Invalid grid placement')
  // Stable fixture ordering, discard non-contract fields before rendering or persisting.
  return { schemaVersion: 2, theme: data.theme as GridSnapshot['theme'], ...bounds, placements: GRID_IDS.map(id => placements.find(p => p.id === id)!) }
}
/** Read-only nearest-unit conversion, minima respected. Never changes original v1 bytes.
 * Retain rounded requested sizes; a bounded packing search may relocate but never shrink.
 */
export function migrateV1(text: string, bounds: GridBounds = GRID_POLICY): GridSnapshot {
  if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) throw new Error('Legacy input too large')
  if (!validBounds(bounds)) throw new Error('Invalid migration bounds')
  const old = decodeLayout(text, DEFAULT_LAYOUT.placements.map(p => p.id), MINIMUMS), cs = constraintsFor(bounds)
  const target: GridPlacement[] = GRID_IDS.map(id => {
    const p = old.placements.find(p => p.id === id)!, c = cs[id]!
    const w = Math.max(c.min.w, Math.round(p.width * bounds.columns)), h = Math.max(c.min.h, Math.round(p.height * bounds.rows))
    if (w > c.max.w || h > c.max.h) throw new Error('Legacy size cannot fit grid policy')
    return { id, x: clamp(Math.round(p.x * bounds.columns), 0, bounds.columns - w), y: clamp(Math.round(p.y * bounds.rows), 0, bounds.rows - h), w, h, preferred: { w, h } }
  })
  if (target.reduce((sum, p) => sum + p.w * p.h, 0) > bounds.columns * bounds.rows) throw new Error('Legacy composition cannot fit grid')
  let probes = 0
  // Largest widgets first, constrained deterministic nearest-location packing. A conservative
  // failure is recoverable, never silently interpreted as permission to replace the composition.
  const order = [...target].sort((a, b) => b.w * b.h - a.w * a.h || GRID_IDS.indexOf(a.id) - GRID_IDS.indexOf(b.id))
  function pack(i: number, placed: GridPlacement[]): GridPlacement[] | null {
    if (i === order.length) return placed
    const p = order[i]!, options: GridPlacement[] = []
    for (let y = 0; y + p.h <= bounds.rows; y++) for (let x = 0; x + p.w <= bounds.columns; x++) options.push({ ...p, x, y })
    options.sort((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)) || a.y - b.y || a.x - b.x)
    for (const next of options) {
      if (++probes > 32768) return null
      if (placed.some(q => overlaps(next, q))) continue
      const result = pack(i + 1, [...placed, next]); if (result) return result
    }
    return null
  }
  const fitted = validLayout(target, bounds, cs) ? target : pack(0, [])
  if (!fitted) throw new Error('Legacy conversion blocked within bounded search')
  return { schemaVersion: 2, theme: old.theme, columns: bounds.columns, rows: bounds.rows, placements: GRID_IDS.map(id => fitted.find(p => p.id === id)!) }
}
export function importGrid(text: string): GridSnapshot {
  if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) throw new Error('Grid input too large')
  const data: unknown = JSON.parse(text)
  return object(data) && data.schemaVersion === 1 ? migrateV1(text) : parseGrid(text)
}
