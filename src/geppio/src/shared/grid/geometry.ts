import { GRID_POLICY } from './policy.ts'
import { DIRECTIONS } from './types.ts'
import type { Direction, GridBounds, GridConstraint, GridRect } from './types.ts'

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export function validBounds(b: GridBounds): boolean {
  return Number.isInteger(b.columns) && Number.isInteger(b.rows) && b.columns >= 1 && b.rows >= 1
    && b.columns <= GRID_POLICY.maxColumns && b.rows <= GRID_POLICY.maxRows
}
export function validConstraint(c: GridConstraint, b: GridBounds): boolean {
  return [c.min.w, c.min.h, c.max.w, c.max.h].every(Number.isInteger) && c.min.w > 0 && c.min.h > 0
    && c.max.w >= c.min.w && c.max.h >= c.min.h && c.max.w <= b.columns && c.max.h <= b.rows
    && typeof c.resizeX === 'boolean' && typeof c.resizeY === 'boolean'
}
export function validRect(p: GridRect, b: GridBounds, c?: GridConstraint): boolean {
  return validBounds(b) && [p.x, p.y, p.w, p.h].every(Number.isInteger) && p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0
    && p.x + p.w <= b.columns && p.y + p.h <= b.rows
    && (!c || (validConstraint(c, b) && p.w >= c.min.w && p.h >= c.min.h && p.w <= c.max.w && p.h <= c.max.h))
}
export function allowsResize(d: Direction, c: GridConstraint): boolean {
  return DIRECTIONS.includes(d) && (!/[ew]/.test(d) || c.resizeX) && (!/[ns]/.test(d) || c.resizeY)
}
export function moveRect(p: GridRect, dx: number, dy: number, b: GridBounds): GridRect {
  if (![dx, dy].every(Number.isFinite) || !validRect(p, b)) throw new Error('Invalid grid movement')
  return { ...p, x: clamp(p.x + Math.round(dx), 0, b.columns - p.w), y: clamp(p.y + Math.round(dy), 0, b.rows - p.h) }
}
export function resizeRect(p: GridRect, dx: number, dy: number, d: Direction, b: GridBounds, c: GridConstraint): GridRect {
  if (![dx, dy].every(Number.isFinite) || !validRect(p, b, c) || !allowsResize(d, c)) throw new Error('Invalid grid resize')
  const next = { ...p }
  if (d.includes('e')) next.w = clamp(p.w + Math.round(dx), c.min.w, Math.min(c.max.w, b.columns - p.x))
  if (d.includes('w')) { next.w = clamp(p.w - Math.round(dx), c.min.w, Math.min(c.max.w, p.x + p.w)); next.x = p.x + p.w - next.w }
  if (d.includes('s')) next.h = clamp(p.h + Math.round(dy), c.min.h, Math.min(c.max.h, b.rows - p.y))
  if (d.includes('n')) { next.h = clamp(p.h - Math.round(dy), c.min.h, Math.min(c.max.h, p.y + p.h)); next.y = p.y + p.h - next.h }
  return next
}

export interface GridMetrics { cell: number; gutter: number; pitch: number; width: number; height: number; left: number; top: number }
/** Fit BOTH measured dimensions. A unit occupies cell; n units occupy n*pitch-gutter. */
export function fitGrid(width: number, height: number, b: GridBounds, requestedGutter: number = GRID_POLICY.gutter, requestedPitch?: number): GridMetrics {
  if (![width, height, requestedGutter].every(Number.isFinite) || width < 0 || height < 0 || requestedGutter < 0 || !validBounds(b)) throw new Error('Invalid grid measurement')
  if (requestedPitch !== undefined && (!Number.isFinite(requestedPitch) || requestedPitch < 0)) throw new Error('Invalid grid pitch')
  // Keep room for positive cells even in tiny viewports; symmetric gutters remain bounded.
  const gutter = Math.min(requestedGutter, width / (2 * b.columns), height / (2 * b.rows))
  const cell = Math.max(0, Math.min((width - (b.columns - 1) * gutter) / b.columns, (height - (b.rows - 1) * gutter) / b.rows,
    requestedPitch === undefined ? Infinity : requestedPitch - gutter))
  const gridWidth = b.columns * cell + (b.columns - 1) * gutter, gridHeight = b.rows * cell + (b.rows - 1) * gutter
  return { cell, gutter, pitch: cell + gutter, width: gridWidth, height: gridHeight,
    left: Math.max(0, (width - gridWidth) / 2), top: Math.max(0, (height - gridHeight) / 2) }
}
export function pixelRect(p: GridRect, m: GridMetrics) {
  return { left: p.x * m.pitch, top: p.y * m.pitch, width: Math.max(0, p.w * m.pitch - m.gutter), height: Math.max(0, p.h * m.pitch - m.gutter) }
}
