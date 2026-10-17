import { tooClose } from '../layout.ts'
import { CONSTRAINTS, POLICY, surfaceLimit } from './policy.ts'
import { DIRECTIONS } from './types.ts'
import type { Constraint, Constraints, Direction, Placement, Rect, Surface } from './types.ts'

export const EPSILON = 1e-7
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
export const distance = (a: Rect, b: Rect) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
/** Reuse the original project's projection-based clearance, including its diagonal exception. */
export const collides = (a: Rect, b: Rect) => tooClose(a, b, { width: POLICY.gap, height: POLICY.gap })
export function allowsResize(d: Direction, c: Constraint) {
  return DIRECTIONS.includes(d) && (!/[ew]/.test(d) || c.resizeX) && (!/[ns]/.test(d) || c.resizeY)
}
export function validRect(p: Rect, s: Surface, c: Constraint): boolean {
  const limit = surfaceLimit(s)
  return [p.x, p.y, p.width, p.height].every(Number.isFinite) && p.x >= 0 && p.y >= 0
    && p.width >= c.min.width && p.height >= c.min.height && p.width <= c.max.width && p.height <= c.max.height
    && p.x + p.width <= limit.width + EPSILON && p.y + p.height <= limit.height + EPSILON
}
export function validLayout(ps: readonly Placement[], s: Surface, cs: Constraints): boolean {
  return ps.length <= POLICY.maxWidgets && new Set(ps.map(p => p.id)).size === ps.length
    && ps.every((p, i) => !!cs[p.id] && CONSTRAINTS[p.id]!.regions.includes(s.region) && p.region === s.region
      && validRect(p, s, cs[p.id]!) && ps.slice(i + 1).every(q => !collides(p, q)))
}
/** Opposite edges remain anchored. Pointer deltas stay in CSS pixels, without rounding. */
export function candidate(p: Placement, dx: number, dy: number, kind: 'move' | Direction, s: Surface, c: Constraint): Rect {
  if (![dx, dy].every(Number.isFinite)) throw new Error('Invalid pointer delta')
  const limit = surfaceLimit(s), next = { ...p }
  if (kind === 'move') return { ...p,
    x: s.region === 'sidebar' ? 0 : clamp(p.x + dx, 0, limit.width - p.width),
    y: s.region === 'bottom' ? 0 : clamp(p.y + dy, 0, limit.height - p.height) }
  if (!allowsResize(kind, c)) return next
  if (kind.includes('e')) next.width = clamp(p.width + dx, c.min.width, Math.min(c.max.width, limit.width - p.x))
  if (kind.includes('w')) { next.width = clamp(p.width - dx, c.min.width, Math.min(c.max.width, p.x + p.width)); next.x = p.x + p.width - next.width }
  if (kind.includes('s')) next.height = clamp(p.height + dy, c.min.height, Math.min(c.max.height, limit.height - p.y))
  if (kind.includes('n')) { next.height = clamp(p.height - dy, c.min.height, Math.min(c.max.height, p.y + p.height)); next.y = p.y + p.height - next.height }
  return next
}
