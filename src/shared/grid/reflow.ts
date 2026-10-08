import { allowsResize, validRect } from './geometry.ts'
import { overlaps, validLayout } from './occupancy.ts'
import { GRID_POLICY } from './policy.ts'
import type { Direction, GridBounds, GridConstraints, GridPlacement, GridRect, GridSize } from './types.ts'

export interface ReflowResult { status: 'valid' | 'blocked'; placements: GridPlacement[]; reason?: 'invalid' | 'space' | 'budget'; states: number }
const same = (a: GridRect, b: GridRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const distance = (a: GridRect, b: GridRect) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const lex = (a: readonly number[], b: readonly number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0 }

/** Original bounded solver. No gravity, whole-canvas compaction or mutable caller state.
 * Phases: forward push; same-axis boundary compression; preferred-size direct slots;
 * bounded multi-widget relocation. Compare complete solutions, not greedy partial packs.
 */
export function reflow(snapshot: readonly GridPlacement[], id: string, rect: GridRect, bounds: GridBounds, cs: GridConstraints, gesture: 'move' | Direction): ReflowResult {
  const unchanged = () => structuredClone([...snapshot])
  const original = snapshot.find(p => p.id === id), constraint = cs[id]
  if (!original || !constraint || snapshot.length > GRID_POLICY.maxWidgets || !validLayout(snapshot, bounds, cs) || !validRect(rect, bounds, constraint)
    || (gesture !== 'move' && !allowsResize(gesture, constraint))
    || (gesture === 'move' && (rect.w !== original.w || rect.h !== original.h))
    || (!constraint.resizeX && rect.w !== original.w) || (!constraint.resizeY && rect.h !== original.h)) {
    return { status: 'blocked', reason: 'invalid', placements: unchanged(), states: 0 }
  }
  if (same(original, rect)) return { status: 'valid', placements: unchanged(), states: 0 }
  const requested = { ...original, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    preferred: gesture === 'move' ? { ...original.preferred } : { w: /[ew]/.test(gesture) ? rect.w : original.preferred.w, h: /[ns]/.test(gesture) ? rect.h : original.preferred.h } }
  const start = snapshot.map(p => p.id === id ? requested : structuredClone(p))
  let states = 0, probes = 0, exhausted = false
  const maxStates = 4096, maxProbes = 131072
  const dx = rect.x - original.x || rect.w - original.w, dy = rect.y - original.y || rect.h - original.h
  const axes = gesture === 'move' ? (Math.abs(dx) >= Math.abs(dy) ? ['x'] : ['y'])
    : [...(gesture.includes('e') || gesture.includes('w') ? ['x'] : []), ...(gesture.includes('n') || gesture.includes('s') ? ['y'] : [])]
  function score(ps: GridPlacement[]): number[] {
    let moved = 0, travel = 0, order = 0, size = 0
    ps.forEach((p, i) => {
      const old = snapshot[i]!
      if (p.id === id) return
      if (!same(p, old)) moved++
      travel += distance(p, old)
      size += Math.abs(p.w - old.preferred.w) + Math.abs(p.h - old.preferred.h)
      snapshot.forEach((q, j) => { if (j <= i || q.id === id) return
        const other = ps[j]!
        if ((old.x - q.x) * (p.x - other.x) < 0 || (old.y - q.y) * (p.y - other.y) < 0) order++
      })
    })
    return [moved, travel, order, size]
  }
  for (let phase = 0; phase < 4; phase++) {
    let best: GridPlacement[] | undefined, bestScore: number[] | undefined
    const phaseStart = states, seen = new Set<string>()
    function candidates(p: GridPlacement, ps: GridPlacement[]): GridPlacement[] {
      const c = cs[p.id]!, options: GridPlacement[] = [], keys = new Set<string>()
      const add = (x: number, y: number, size: GridSize) => {
        if (++probes > maxProbes) { exhausted = true; return }
        const next = { ...p, x, y, w: size.w, h: size.h }, key = `${x},${y},${size.w},${size.h}`
        if (keys.has(key) || !validRect(next, bounds, c)) return
        if ((!c.resizeX && next.w !== p.w) || (!c.resizeY && next.h !== p.h)) return
        keys.add(key); options.push(next)
      }
      if (phase < 2) {
        for (const axis of axes) {
          const sign = axis === 'x' ? (gesture.includes('w') ? -1 : Math.sign(dx) || 1) : (gesture.includes('n') ? -1 : Math.sign(dy) || 1)
          for (const obstacle of ps) {
            if (obstacle.id === p.id) continue
            const position = axis === 'x' ? (sign > 0 ? obstacle.x + obstacle.w : obstacle.x - p.w)
              : (sign > 0 ? obstacle.y + obstacle.h : obstacle.y - p.h)
            const travel = position - (axis === 'x' ? p.x : p.y)
            if (travel * sign < 0 || Math.abs(travel) > (axis === 'x' ? p.w : p.h)) continue
            add(axis === 'x' ? position : p.x, axis === 'y' ? position : p.y, p)
            if (phase === 1) {
              // Compress only along the impacted axis; hold its far edge until a boundary push is needed.
              if (axis === 'x' && c.resizeX) {
                const far = sign > 0 ? p.x + p.w : p.x
                const w = sign > 0 ? far - position : obstacle.x - far
                if (w >= c.min.w) add(sign > 0 ? position : far, p.y, { w, h: p.h })
                else add(sign > 0 ? position : obstacle.x - c.min.w, p.y, { w: c.min.w, h: p.h })
              }
              if (axis === 'y' && c.resizeY) {
                const far = sign > 0 ? p.y + p.h : p.y
                const h = sign > 0 ? far - position : obstacle.y - far
                if (h >= c.min.h) add(p.x, sign > 0 ? position : far, { w: p.w, h })
                else add(p.x, sign > 0 ? position : obstacle.y - c.min.h, { w: p.w, h: c.min.h })
              }
            }
          }
        }
      } else {
        const sizes = phase === 2 ? [p.preferred] : [p.preferred, { w: p.w, h: p.h },
          { w: c.resizeX && axes.includes('x') ? c.min.w : p.w, h: c.resizeY && axes.includes('y') ? c.min.h : p.h }]
        for (const size of sizes) for (let y = 0; y + size.h <= bounds.rows; y++) for (let x = 0; x + size.w <= bounds.columns; x++) add(x, y, size)
      }
      return options.sort((a, b) => lex([distance(a, p), Math.abs(a.w - p.preferred.w) + Math.abs(a.h - p.preferred.h), a.y, a.x, -a.w, -a.h],
        [distance(b, p), Math.abs(b.w - p.preferred.w) + Math.abs(b.h - p.preferred.h), b.y, b.x, -b.w, -b.h]))
    }
    function visit(ps: GridPlacement[], fixed: ReadonlySet<string>) {
      if (states - phaseStart >= maxStates || probes >= maxProbes) { exhausted = true; return }
      states++
      const key = ps.map(p => `${p.x},${p.y},${p.w},${p.h}`).join(';') + '|' + [...fixed].sort().join(',')
      if (seen.has(key)) return
      seen.add(key)
      // At every step only one unassigned widget is changed; fixed widgets cannot cycle.
      const conflict = ps.find(p => !fixed.has(p.id) && ps.some(q => fixed.has(q.id) && overlaps(p, q)))
      if (!conflict) {
        if (!validLayout(ps, bounds, cs)) return
        const rank = score(ps)
        if (!bestScore || lex(rank, bestScore) < 0) { best = ps; bestScore = rank }
        return
      }
      if (bestScore && [...fixed].filter(key => key !== id).length >= bestScore[0]!) return
      for (const next of candidates(conflict, ps)) {
        if (ps.some(p => fixed.has(p.id) && overlaps(p, next))) continue
        if (phase === 2 && ps.some(p => p.id !== next.id && overlaps(p, next))) continue
        visit(ps.map(p => p.id === next.id ? next : p), new Set([...fixed, next.id]))
      }
    }
    visit(start, new Set([id]))
    if (best) return { status: 'valid', placements: best, states }
    if (probes >= maxProbes) break
  }
  return { status: 'blocked', reason: exhausted ? 'budget' : 'space', placements: unchanged(), states }
}
