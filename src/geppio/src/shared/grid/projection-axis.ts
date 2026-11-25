import { constraintsFor } from './policy.ts'
import type { GridSnapshot } from './types.ts'

/** Bounded one-axis interval fitting; every source separation and edge affinity remains mandatory. */
export function projectionAxis(source: GridSnapshot, horizontal: boolean) {
  const extent = horizontal ? source.columns : source.rows, cs = constraintsFor(source)
  const intervals = source.placements.map(p => ({ id: p.id, start: horizontal ? p.x : p.y, size: horizontal ? p.w : p.h,
    preferred: horizontal ? p.preferred.w : p.preferred.h, minimum: horizontal ? cs[p.id]!.min.w : cs[p.id]!.min.h }))
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const predecessors = intervals.map(b => intervals.map((a, i) => a.id !== b.id && a.start + a.size <= b.start
    ? { index: i, gap: a.start + a.size < b.start ? 1 : 0 } : null).filter(p => p !== null))
  let probes = 0
  function earliest(sizes: number[]) {
    const starts: number[] = intervals.map(p => p.start > 0 ? 1 : 0)
    for (let j = 0; j < intervals.length; j++) for (const p of predecessors[j]!) {
      probes++; starts[j] = Math.max(starts[j]!, starts[p.index]! + sizes[p.index]! + p.gap)
    }
    return starts
  }
  function required(sizes: number[]) {
    const starts = earliest(sizes)
    return Math.max(...intervals.map((p, i) => starts[i]! + sizes[i]! + (p.start + p.size < extent ? 1 : 0)))
  }
  const minimum = required(intervals.map(p => p.minimum))
  return { minimum,
    fit(limit: number): Map<string, { start: number; size: number }> {
      const ideals = intervals.map(p => p.size * limit / extent)
      const sizes = intervals.map((p, i) => Math.min(p.preferred, Math.max(p.minimum, Math.round(ideals[i]!))))
      // Compress only eligible intervals, one unit at a time, before ever moving a separated neighbour.
      while (required(sizes) > limit) {
        let best = -1, bestRequired = Infinity, bestCost = Infinity
        for (let i = 0; i < sizes.length; i++) {
          if (sizes[i]! <= intervals[i]!.minimum) continue
          sizes[i]!--; const need = required(sizes); sizes[i]!++
          const cost = (ideals[i]! - sizes[i]! + .5) / intervals[i]!.size
          if (need < bestRequired || (need === bestRequired && cost < bestCost)) { best = i; bestRequired = need; bestCost = cost }
        }
        if (best < 0) throw new Error('Infeasible spatial projection')
        sizes[best]!--
      }
      const lower = earliest(sizes), upper = intervals.map((p, i) => limit - sizes[i]! - (p.start + p.size < extent ? 1 : 0))
      for (let i = intervals.length - 1; i >= 0; i--) {
        if (intervals[i]!.start === 0) upper[i] = 0
        for (let j = i + 1; j < intervals.length; j++) {
          const relation = predecessors[j]!.find(p => p.index === i)
          if (relation) upper[i] = Math.min(upper[i]!, upper[j]! - sizes[i]! - relation.gap)
        }
      }
      const starts = [...lower]
      for (let i = 0; i < intervals.length; i++) {
        const p = intervals[i]!
        for (const predecessor of predecessors[i]!) starts[i] = Math.max(starts[i]!, starts[predecessor.index]! + sizes[predecessor.index]! + predecessor.gap)
        const ideal = p.start + p.size === extent ? limit - sizes[i]!
          : Math.round(p.start / (extent - p.size || 1) * (limit - sizes[i]!))
        starts[i] = Math.min(upper[i]!, Math.max(starts[i]!, ideal))
        if (starts[i]! < lower[i]!) throw new Error('Infeasible spatial interval')
      }
      return new Map(intervals.map((p, i) => [p.id, { start: starts[i]!, size: sizes[i]! }]))
    },
    get probes() { return probes }
  }
}
