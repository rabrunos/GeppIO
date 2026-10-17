import { clamp, EPSILON } from './geometry.ts'
import { CONSTRAINTS, POLICY } from './policy.ts'
import type { Placement, Region, Size, Snapshot } from './types.ts'

/** Continuous counterpart of the original interval projector. Stable source separations
 * become a DAG, never a packing order. Binary fitting replaces integer decrement loops.
 * There is no viewport history, gravity, coordinate rounding or implicit persistence.
 */
function axisFit(ps: readonly Placement[], horizontal: boolean, reference: number, limit: number) {
  const position = horizontal ? 'x' : 'y', dimension = horizontal ? 'width' : 'height'
  const intervals = [...ps].sort((a, b) => a[position] - b[position] || a.id.localeCompare(b.id))
  const predecessors = intervals.map(b => intervals.map((a, index) => a.id !== b.id && a[position] + a[dimension] <= b[position] + EPSILON ? index : -1).filter(i => i >= 0))
  if (reference === limit && intervals.every(p => p[dimension] >= CONSTRAINTS[p.id]!.min[dimension]
    && p[position] + p[dimension] <= limit + EPSILON)) {
    // A validated direct composition already satisfies two-dimensional clearance.
    // Disjoint orthogonal interiors may have sub-gap axis separation (the diagonal
    // exception). Re-imposing the projection DAG here would move anchored previews.
    return new Map(intervals.map(p => [p.id, { start: p[position], size: p[dimension] }]))
  }
  const resizable = intervals.map(p => horizontal ? CONSTRAINTS[p.id]!.resizeX : CONSTRAINTS[p.id]!.resizeY)
  const minima = intervals.map((p, i) => resizable[i] ? CONSTRAINTS[p.id]!.min[dimension] : p[dimension])
  const ideals = intervals.map((p, i) => resizable[i] ? clamp(p[dimension] * limit / reference, minima[i]!, Math.max(p.preferred[dimension], p[dimension])) : p[dimension])
  function earliest(sizes: number[]) {
    const starts = intervals.map(() => 0)
    for (let j = 0; j < intervals.length; j++) for (const i of predecessors[j]!) starts[j] = Math.max(starts[j]!, starts[i]! + sizes[i]! + POLICY.gap)
    return starts
  }
  const required = (sizes: number[]) => Math.max(0, ...earliest(sizes).map((start, i) => start + sizes[i]!))
  if (required(minima) > limit + EPSILON) return null
  let sizes = ideals
  if (required(ideals) > limit) {
    let lo = 0, hi = 1
    for (let i = 0; i < 48; i++) {
      const factor = (lo + hi) / 2, next = minima.map((min, j) => min + (ideals[j]! - min) * factor)
      if (required(next) <= limit) lo = factor; else hi = factor
    }
    sizes = minima.map((min, j) => min + (ideals[j]! - min) * lo)
  }
  const lower = earliest(sizes), upper = sizes.map(size => limit - size)
  for (let i = intervals.length - 1; i >= 0; i--) for (let j = i + 1; j < intervals.length; j++) {
    if (predecessors[j]!.includes(i)) upper[i] = Math.min(upper[i]!, upper[j]! - sizes[i]! - POLICY.gap)
  }
  const starts = [...lower]
  for (let i = 0; i < intervals.length; i++) {
    const p = intervals[i]!
    for (const predecessor of predecessors[i]!) starts[i] = Math.max(starts[i]!, starts[predecessor]! + sizes[predecessor]! + POLICY.gap)
    const ideal = p[position] / (reference - p[dimension] || 1) * (limit - sizes[i]!)
    starts[i] = clamp(ideal, starts[i]!, Math.max(starts[i]!, upper[i]!))
  }
  return new Map(intervals.map((p, i) => [p.id, { start: Math.max(0, starts[i]!), size: sizes[i]! }]))
}
export interface Projection { placements: Placement[]; feasible: boolean; world: Size }
export function projectRegion(source: Snapshot, region: Region, available: Size, expanded: boolean): Projection {
  expanded = expanded && region === 'main'
  const ps = source.placements.filter(p => p.region === region), reference = source.reference[region]
  const width = clamp(available.width, 0, POLICY.maxCoordinate), height = clamp(available.height, 0, POLICY.maxCoordinate)
  const x = region === 'sidebar' || expanded ? null : axisFit(ps, true, reference.width, width)
  const y = region !== 'main' ? null : axisFit(ps, false, reference.height, height)
  const feasible = (region === 'sidebar' ? ps.every(p => width >= CONSTRAINTS[p.id]!.min.width && width <= CONSTRAINTS[p.id]!.max.width) : expanded || !!x)
    && (region === 'bottom' ? ps.every(p => height >= CONSTRAINTS[p.id]!.min.height && height <= CONSTRAINTS[p.id]!.max.height) : region === 'sidebar' || !!y)
  if (!feasible) return { placements: structuredClone(ps), feasible: false,
    world: region === 'main' ? { width: Math.max(width, reference.width, ...ps.map(p => p.x + p.width)), height: Math.max(height, reference.height) }
      : { width, height: region === 'sidebar' ? Math.max(0, ...ps.map(p => p.y + p.height)) : height } }
  const placements = ps.map(p => ({ ...p,
    x: region === 'sidebar' ? 0 : expanded ? p.x : x!.get(p.id)!.start,
    y: region === 'bottom' ? 0 : region === 'sidebar' ? p.y : y!.get(p.id)!.start,
    width: region === 'sidebar' ? width : expanded ? p.width : x!.get(p.id)!.size,
    height: region === 'bottom' ? height : region === 'sidebar' ? p.height : y!.get(p.id)!.size }))
  return { placements, feasible: true, world: { width: region === 'main' ? Math.max(width, ...placements.map(p => p.x + p.width)) : width,
    height: region === 'sidebar' ? Math.max(0, ...placements.map(p => p.y + p.height)) : height } }
}
