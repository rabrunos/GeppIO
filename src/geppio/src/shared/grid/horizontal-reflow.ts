import { HORIZONTAL_BOUNDS, horizontalConstraints, validHorizontalLayout, validHorizontalRect } from './horizontal.ts'
import { reflowInDomain } from './reflow.ts'
import type { Direction, GridPlacement, GridRect } from './types.ts'

/** Same push/compression/ranking, with finite sparse fallback slots near occupied rectangles.
 * No scan/allocation proportional to empty world columns. Conservative budget failures stay visible.
 */
export function horizontalReflow(snapshot: readonly GridPlacement[], id: string, rect: GridRect, gesture: 'move' | Direction) {
  return reflowInDomain(snapshot, id, rect, HORIZONTAL_BOUNDS, horizontalConstraints(), gesture, {
    validRect: validHorizontalRect, validLayout: validHorizontalLayout,
    *slots(p, ps, size, bounds) {
      const xs = new Set<number>()
      for (let dx = -24; dx <= 24; dx++) { xs.add(p.x + dx); xs.add(rect.x + dx) }
      for (const q of ps) { xs.add(q.x); xs.add(q.x + q.w); xs.add(q.x - size.w) }
      const ordered = [...xs].filter(x => x >= 0 && x + size.w <= bounds.columns).sort((a, b) => a - b)
      for (let y = 0; y + size.h <= bounds.rows; y++) for (const x of ordered) yield [x, y] as const
    }
  })
}
