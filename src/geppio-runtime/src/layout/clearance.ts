import type { Rect, Size } from './types.ts'
const EPSILON = 1e-9
/** Projection rule: diagonal-only neighbours do not require invented canvas/corner margins.
 * When interiors overlap on one axis, require clearance on the separating axis. */
export function tooClose(a: Rect, b: Rect, gap: Size): boolean {
  const intersectsX = a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
  const intersectsY = a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON
  return (intersectsX && intersectsY)
    || (intersectsY && a.x + a.width + gap.width > b.x + EPSILON && b.x + b.width + gap.width > a.x + EPSILON)
    || (intersectsX && a.y + a.height + gap.height > b.y + EPSILON && b.y + b.height + gap.height > a.y + EPSILON)
}
