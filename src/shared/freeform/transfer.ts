import { clamp, validLayout } from './geometry.ts'
import { CONSTRAINTS, constraintsFor, POLICY, surfaceLimit } from './policy.ts'
import { reflow } from './reflow.ts'
import type { Constraints, Rect, Region, Snapshot, Surface } from './types.ts'

/** Minimal eligibility route, not a docking/plugin SDK. A failed transfer is atomic.
 * The renderer keeps the same mounted frame/content identity across region changes.
 */
export function transfer<T extends Snapshot>(snapshot: T, id: string, target: Surface, at?: Pick<Rect, 'x' | 'y'>, constraints: Constraints = CONSTRAINTS): T | null {
  const p = snapshot.placements.find(p => p.id === id), c = constraints[id]
  if (!p || !c?.regions.includes(target.region)) return null
  const limit = surfaceLimit(target), cs = constraintsFor(target, constraints)
  if (target.width < c.min.width || (target.region !== 'sidebar' && target.height < c.min.height)) return null
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
  const budget = { probes: 8192, states: 2048 }
  const accept = (placements: typeof snapshot.placements): T => ({ ...snapshot, reference: { ...snapshot.reference, [target.region]: { width: target.width,
    height: target.region === 'sidebar' ? Math.max(target.height, ...placements.map(q => q.y + q.height)) : target.height } },
    placements: snapshot.placements.map(q => placements.find(next => next.id === q.id) ?? q) })
  for (const seed of seeds) {
    if (!validLayout([...peers, seed], target, cs)) continue
    if (budget.probes <= 0 || budget.states <= 0) return null
    const result = reflow([...peers, seed], id, moved, target, cs, 'move', budget)
    budget.probes -= result.probes; budget.states -= result.states
    if (result.status !== 'valid') continue
    return accept(result.placements)
  }
  if (budget.probes <= 0 || budget.states <= 0) return null
  const insertion = reflow([...peers, moved], id, moved, target, cs, 'insert', budget)
  if (insertion.status === 'valid') return accept(insertion.placements)
  return null
}
export const REGION_LABELS: Record<Region, string> = { main: 'Main', sidebar: 'Sidebar', bottom: 'Bottom' }
