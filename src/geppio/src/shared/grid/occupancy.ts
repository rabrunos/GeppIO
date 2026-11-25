import { validRect } from './geometry.ts'
import type { GridBounds, GridConstraints, GridPlacement, GridRect } from './types.ts'

export function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
export function validLayout(ps: readonly GridPlacement[], bounds: GridBounds, cs: GridConstraints): boolean {
  return ps.length > 0 && new Set(ps.map(p => p.id)).size === ps.length && ps.every((p, i) => !!cs[p.id]
    && validRect(p, bounds, cs[p.id]) && Number.isInteger(p.preferred?.w) && Number.isInteger(p.preferred?.h)
    && p.preferred.w >= cs[p.id]!.min.w && p.preferred.h >= cs[p.id]!.min.h
    && p.preferred.w >= p.w && p.preferred.h >= p.h
    && p.preferred.w <= cs[p.id]!.max.w && p.preferred.h <= cs[p.id]!.max.h
    && ps.slice(i + 1).every(q => !overlaps(p, q)))
}
