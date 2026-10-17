import { collides, EPSILON } from './geometry.ts'
import { CONSTRAINTS, IDS, POLICY } from './policy.ts'
import { REGIONS } from './types.ts'
import type { Placement, References, Size, Snapshot } from './types.ts'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
function size(v: unknown, max: number): Size {
  if (!object(v) || !number(v.width) || !number(v.height) || v.width <= 0 || v.height <= 0 || v.width > max || v.height > max) throw new Error('Invalid pixel size')
  return { width: v.width, height: v.height }
}
/** Imported data cannot change executable widget minima, permissions or registry membership.
 * constraintVersion binds pixels to the bundled sizing contract. Future versions fail closed.
 */
export function parseFreeform(text: string): Snapshot {
  if (text.length > POLICY.maxBytes || new TextEncoder().encode(text).length > POLICY.maxBytes) throw new Error('Layout exceeds 64 KiB')
  const data: unknown = JSON.parse(text)
  if (!object(data) || data.schemaVersion !== 1 || data.engine !== 'freeform' || data.constraintVersion !== 1
    || !object(data.reference) || !Array.isArray(data.placements) || data.placements.length !== IDS.length) throw new Error('Unsupported freeform layout')
  const reference = Object.fromEntries(REGIONS.map(region => [region, size((data.reference as Record<string, unknown>)[region], POLICY.maxCoordinate)])) as References
  const seen = new Set<string>()
  const placements = data.placements.map((p: unknown): Placement => {
    if (!object(p) || typeof p.id !== 'string' || !IDS.includes(p.id) || seen.has(p.id) || !REGIONS.includes(p.region as Placement['region'])
      || !number(p.x) || !number(p.y) || p.x < 0 || p.y < 0) throw new Error('Invalid widget identity/region/position')
    seen.add(p.id)
    const c = CONSTRAINTS[p.id]!, region = p.region as Placement['region'], dimensions = size(p, POLICY.maxSize), preferred = size(p.preferred, POLICY.maxSize)
    if (!c.regions.includes(region) || dimensions.width < c.min.width || dimensions.height < c.min.height
      || preferred.width < c.min.width || preferred.height < c.min.height || dimensions.width > c.max.width || dimensions.height > c.max.height
      || p.x + dimensions.width > POLICY.maxCoordinate || p.y + dimensions.height > reference[region].height + EPSILON
      || (region === 'sidebar' && (p.x !== 0 || dimensions.width !== reference.sidebar.width))
      || (region === 'bottom' && (p.y !== 0 || dimensions.height !== reference.bottom.height))) throw new Error('Invalid widget constraints')
    return { id: p.id, region, x: p.x, y: p.y, ...dimensions, preferred }
  })
  if (placements.some((p, i) => placements.slice(i + 1).some(q => p.region === q.region && collides(p, q)))) throw new Error('Invalid widget clearance')
  return { schemaVersion: 1, engine: 'freeform', constraintVersion: 1, reference, placements: IDS.map(id => placements.find(p => p.id === id)!) }
}
