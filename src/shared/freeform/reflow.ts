import { allowsResize, collides, distance, EPSILON, same, validLayout, validRect } from './geometry.ts'
import { POLICY, surfaceLimit } from './policy.ts'
import type { Constraints, Direction, Placement, Rect, Size, Surface } from './types.ts'

export interface Result { status: 'valid' | 'blocked'; placements: Placement[]; reason?: 'invalid' | 'space' | 'budget'; states: number }
const lex = (a: readonly number[], b: readonly number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0 }

/** Adapted from GeppIO's approved grid solver: complete-solution ranking, forward push,
 * impacted-axis compression, preferred contact slots, bounded rearrangement. Continuous
 * contact edges replace integer slot enumeration. Empty space never attracts widgets.
 */
export function reflow(snapshot: readonly Placement[], id: string, rect: Rect, surface: Surface, cs: Constraints, gesture: 'move' | Direction): Result {
  const unchanged = () => structuredClone([...snapshot]), original = snapshot.find(p => p.id === id), c = cs[id]
  if (!original || !c || !validLayout(snapshot, surface, cs) || !validRect(rect, surface, c)
    || (gesture !== 'move' && !allowsResize(gesture, c))
    || (gesture === 'move' && (rect.width !== original.width || rect.height !== original.height))
    || (!c.resizeX && rect.width !== original.width) || (!c.resizeY && rect.height !== original.height)) {
    return { status: 'blocked', reason: 'invalid', placements: unchanged(), states: 0 }
  }
  if (same(original, rect)) return { status: 'valid', placements: unchanged(), states: 0 }
  const requested = { ...original, ...rect, preferred: gesture === 'move' ? { ...original.preferred } : {
    width: /[ew]/.test(gesture) ? rect.width : original.preferred.width,
    height: /[ns]/.test(gesture) ? rect.height : original.preferred.height } }
  const start = snapshot.map(p => p.id === id ? requested : structuredClone(p))
  const limit = surfaceLimit(surface), gap = POLICY.gap
  const dx = rect.x - original.x || rect.width - original.width, dy = rect.y - original.y || rect.height - original.height
  const axes: ('x' | 'y')[] = surface.region === 'sidebar' ? ['y'] : surface.region === 'bottom' ? ['x']
    : gesture === 'move' ? [Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y']
      : [...(/[ew]/.test(gesture) ? ['x' as const] : []), ...(/[ns]/.test(gesture) ? ['y' as const] : [])]
  let states = 0, probes = 0, exhausted = false
  const maxStates = 4096, maxProbes = 131072
  function score(ps: Placement[]): number[] {
    let moved = 0, travel = 0, order = 0, size = 0
    ps.forEach((p, i) => {
      const old = snapshot[i]!
      if (p.id === id) return
      if (!same(p, old)) moved++
      travel += distance(p, old)
      size += Math.abs(p.width - old.preferred.width) + Math.abs(p.height - old.preferred.height)
      snapshot.forEach((q, j) => {
        if (j <= i || q.id === id) return
        const other = ps[j]!
        if ((old.x - q.x) * (p.x - other.x) < -EPSILON || (old.y - q.y) * (p.y - other.y) < -EPSILON) order++
      })
    })
    return [moved, travel, order, size]
  }
  function restore(ps: Placement[]): Placement[] {
    // Restore in place first, then at nearby contact edges. Never push an unrelated widget
    // merely to recover a preference; rank shortest travel and preserve spatial order.
    const next = structuredClone(ps)
    for (const p of next) {
      const before = snapshot.find(q => q.id === p.id)!
      // Do not undo this gesture's newly required compression through a lateral escape.
      // Recovery applies to existing compression when a later intention frees space.
      if ((before.width >= before.preferred.width && before.height >= before.preferred.height)
        || p.width < before.width - EPSILON || p.height < before.height - EPSILON) continue
      if (p.id === id || (p.width >= p.preferred.width && p.height >= p.preferred.height)) continue
      const constraint = cs[p.id]!, target = { width: constraint.resizeX ? Math.max(p.width, p.preferred.width) : p.width,
        height: constraint.resizeY ? Math.max(p.height, p.preferred.height) : p.height }
      const xs = surface.region === 'sidebar' ? [0] : [p.x, p.x + p.width - target.width,
        ...next.filter(q => q.id !== p.id).flatMap(q => [q.x + q.width + gap, q.x - target.width - gap])]
      const ys = surface.region === 'bottom' ? [0] : [p.y, p.y + p.height - target.height,
        ...next.filter(q => q.id !== p.id).flatMap(q => [q.y + q.height + gap, q.y - target.height - gap])]
      const options = xs.flatMap(x => ys.map(y => ({ ...p, ...target, x, y }))).filter(q => validRect(q, surface, constraint)
        && distance(q, p) <= Math.max(p.width, p.height) + gap && next.every(other => other.id === p.id || !collides(q, other))
        && snapshot.every(old => old.id === p.id || old.id === id || !(
          (p.x - old.x) * (q.x - old.x) < -EPSILON || (p.y - old.y) * (q.y - old.y) < -EPSILON)))
      options.sort((a, b) => distance(a, p) - distance(b, p) || a.y - b.y || a.x - b.x)
      if (options[0]) Object.assign(p, options[0])
      else {
        // Partial recovery can use any currently available slack without moving others.
        for (const dimension of ['width', 'height'] as const) {
          if (!(dimension === 'width' ? constraint.resizeX : constraint.resizeY)) continue
          let lo = p[dimension], hi = Math.min(target[dimension], limit[dimension] - p[dimension === 'width' ? 'x' : 'y'])
          if (hi - lo <= EPSILON) continue
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2, q = { ...p, [dimension]: mid }
            if (validRect(q, surface, constraint) && next.every(other => other.id === p.id || !collides(q, other))) lo = mid
            else hi = mid
          }
          if (Math.abs(lo - target[dimension]) < EPSILON) lo = target[dimension]
          if (lo - p[dimension] > EPSILON) p[dimension] = lo
        }
      }
    }
    return next
  }
  for (let phase = 0; phase < 4; phase++) {
    let best: Placement[] | undefined, bestScore: number[] | undefined
    const phaseStart = states, seen = new Set<string>()
    function candidates(p: Placement, ps: Placement[]): Placement[] {
      const constraint = cs[p.id]!, options: Placement[] = [], keys = new Set<string>()
      const add = (x: number, y: number, size: Size) => {
        if (++probes > maxProbes) { exhausted = true; return }
        const next = { ...p, x, y, width: size.width, height: size.height }, key = `${x},${y},${size.width},${size.height}`
        if (keys.has(key) || !validRect(next, surface, constraint)
          || (!constraint.resizeX && next.width !== p.width) || (!constraint.resizeY && next.height !== p.height)
          || (surface.region === 'sidebar' && x !== 0) || (surface.region === 'bottom' && y !== 0)) return
        keys.add(key); options.push(next)
      }
      if (phase < 2) {
        for (const axis of axes) {
          const dimension = axis === 'x' ? 'width' : 'height'
          const sign = axis === 'x' ? (gesture.includes('w') ? -1 : Math.sign(dx) || 1) : (gesture.includes('n') ? -1 : Math.sign(dy) || 1)
          for (const obstacle of ps) {
            if (obstacle.id === p.id) continue
            const position = sign > 0 ? obstacle[axis] + obstacle[dimension] + gap : obstacle[axis] - p[dimension] - gap
            const travel = position - p[axis]
            if (travel * sign < -EPSILON || Math.abs(travel) > p[dimension] + gap + EPSILON) continue
            add(axis === 'x' ? position : p.x, axis === 'y' ? position : p.y, p)
            if (phase === 1 && (axis === 'x' ? constraint.resizeX : constraint.resizeY)) {
              const far = sign > 0 ? p[axis] + p[dimension] : p[axis]
              const size = sign > 0 ? far - position : obstacle[axis] - gap - far
              const minimum = constraint.min[dimension], length = Math.max(minimum, size)
              const at = sign > 0 ? position : obstacle[axis] - gap - length
              add(axis === 'x' ? at : p.x, axis === 'y' ? at : p.y, { ...p, [dimension]: length })
            }
          }
        }
      } else {
        const preferred = { width: constraint.resizeX ? Math.max(p.width, p.preferred.width) : p.width,
          height: constraint.resizeY ? Math.max(p.height, p.preferred.height) : p.height }
        const sizes = phase === 2 ? [preferred] : [preferred, p,
          { width: constraint.resizeX && axes.includes('x') ? constraint.min.width : p.width,
            height: constraint.resizeY && axes.includes('y') ? constraint.min.height : p.height }]
        for (const size of sizes) {
          // Sparse continuous contact combinations: at most O(widget count²), independent
          // of world length. Bounded local travel prevents distant-hole teleportation.
          const xs = surface.region === 'sidebar' ? [0] : [p.x, 0, limit.width - size.width,
            ...ps.filter(q => q.id !== p.id).flatMap(q => [q.x, q.x + q.width + gap, q.x - size.width - gap])]
          const ys = surface.region === 'bottom' ? [0] : [p.y, 0, limit.height - size.height,
            ...ps.filter(q => q.id !== p.id).flatMap(q => [q.y, q.y + q.height + gap, q.y - size.height - gap])]
          for (const x of xs) for (const y of ys) {
            if (distance({ ...p, x, y }, p) <= Math.max(p.width, p.height) * 2 + gap) add(x, y, size)
          }
        }
      }
      return options.sort((a, b) => lex([distance(a, p), Math.abs(a.width - p.preferred.width) + Math.abs(a.height - p.preferred.height), a.y, a.x, -a.width, -a.height],
        [distance(b, p), Math.abs(b.width - p.preferred.width) + Math.abs(b.height - p.preferred.height), b.y, b.x, -b.width, -b.height]))
    }
    function visit(ps: Placement[], fixed: ReadonlySet<string>) {
      if (states - phaseStart >= maxStates || probes >= maxProbes) { exhausted = true; return }
      states++
      const key = ps.map(p => `${p.x},${p.y},${p.width},${p.height}`).join(';') + '|' + [...fixed].sort().join(',')
      if (seen.has(key)) return
      seen.add(key)
      const conflict = ps.find(p => !fixed.has(p.id) && ps.some(q => fixed.has(q.id) && collides(p, q)))
      if (!conflict) {
        if (!validLayout(ps, surface, cs)) return
        const rank = score(ps)
        if (!bestScore || lex(rank, bestScore) < 0) { best = ps; bestScore = rank }
        return
      }
      if (bestScore && [...fixed].filter(key => key !== id).length > bestScore[0]!) return
      for (const next of candidates(conflict, ps)) {
        if (ps.some(p => fixed.has(p.id) && collides(p, next))) continue
        if (phase === 2 && ps.some(p => p.id !== next.id && collides(p, next))) continue
        visit(ps.map(p => p.id === next.id ? next : p), new Set([...fixed, next.id]))
      }
    }
    visit(start, new Set([id]))
    if (best) return { status: 'valid', placements: restore(best), states }
    if (probes >= maxProbes) break
  }
  return { status: 'blocked', reason: exhausted ? 'budget' : 'space', placements: unchanged(), states }
}
