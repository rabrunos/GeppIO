import { clamp, validLayout } from './geometry.ts'
import { CONSTRAINTS, constraintsFor, POLICY, surfaceLimit } from './policy.ts'
import { reflow } from './reflow.ts'
import type { Rect, Region, Snapshot, Surface } from './types.ts'

/** Minimal eligibility route, not a docking/plugin SDK. A failed transfer is atomic.
 * The renderer keeps the same mounted frame/content identity across region changes.
 */
export function transfer(snapshot: Snapshot, id: string, target: Surface, at?: Pick<Rect, 'x' | 'y'>): Snapshot | null {
  const p = snapshot.placements.find(p => p.id === id), c = CONSTRAINTS[id]
  if (!p || !c?.regions.includes(target.region)) return null
  const limit = surfaceLimit(target), cs = constraintsFor(target)
  if (target.width < c.min.width || target.height < c.min.height) return null
  const width = target.region === 'sidebar' ? target.width : clamp(p.preferred.width, c.min.width, Math.min(c.max.width, limit.width))
  const height = target.region === 'bottom' ? target.height : clamp(p.preferred.height, c.min.height, Math.min(c.max.height, limit.height))
  const moved = { ...p, region: target.region, width, height,
    x: target.region === 'sidebar' ? 0 : clamp(at?.x ?? 0, 0, limit.width - width),
    y: target.region === 'bottom' ? 0 : clamp(at?.y ?? 0, 0, limit.height - height) }
  const peers = snapshot.placements.filter(q => q.id !== id && q.region === target.region)
  if (!validLayout(peers, target, cs)) return null
  // Insert an initially unoccupied seed, then use the same contact solver for displacement.
  const seeds = [{ ...moved, x: moved.x, y: moved.y }, ...peers.flatMap(q => [
    { ...moved, x: target.region === 'sidebar' ? 0 : q.x + q.width + POLICY.gap, y: moved.y },
    { ...moved, x: moved.x, y: target.region === 'bottom' ? 0 : q.y + q.height + POLICY.gap }
  ])]
  for (const seed of seeds) {
    if (!validLayout([...peers, seed], target, cs)) continue
    const result = reflow([...peers, seed], id, moved, target, cs, 'move')
    if (result.status !== 'valid') continue
    return { ...snapshot, reference: { ...snapshot.reference, [target.region]: { width: target.width, height: target.height } },
      placements: snapshot.placements.map(q => result.placements.find(next => next.id === q.id) ?? q) }
  }
  return null
}
export const REGION_LABELS: Record<Region, string> = { main: 'Main', sidebar: 'Sidebar', bottom: 'Bottom' }
