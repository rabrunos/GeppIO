/** Pure continuous geometry. No DOM, framework, pixels, grid cells or native access. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Placement extends Rect { id: string }
export interface MinSize { width: number; height: number }
export interface Guide { axis: 'x' | 'y'; value: number }
export type Theme = 'dark' | 'light'
export interface LayoutSnapshot { schemaVersion: 1; theme: Theme; placements: Placement[] }
export const MAX_LAYOUT_BYTES = 64 * 1024
const EPSILON = 1e-9
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export function validRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(number)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1 + EPSILON && rect.y + rect.height <= 1 + EPSILON
}
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
    && a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON
}
export function canPlace(candidate: Placement, placements: Placement[]): boolean {
  return validRect(candidate) && placements.every(other => other.id === candidate.id || !overlaps(candidate, other))
}
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  if (![dx, dy].every(number) || !validRect(rect)) throw new Error('Invalid movement')
  return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) }
}
export function resizeRect(rect: Rect, dx: number, dy: number, minimum: MinSize): Rect {
  if (![dx, dy, minimum.width, minimum.height].every(number) || !validRect(rect)
    || minimum.width <= 0 || minimum.height <= 0) throw new Error('Invalid resize')
  return { ...rect, width: clamp(rect.width + dx, Math.min(minimum.width, 1 - rect.x), 1 - rect.x),
    height: clamp(rect.height + dy, Math.min(minimum.height, 1 - rect.y), 1 - rect.y) }
}
/** Snap by edges/centres of neighbours. Tolerance is normalized from a CSS-pixel threshold. */
export function snapMove(rect: Rect, neighbours: Rect[], tolerance: MinSize): { rect: Rect; guides: Guide[] } {
  const next = { ...rect }; const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    const dimension = axis === 'x' ? 'width' : 'height'
    const threshold = tolerance[dimension]
    if (!number(threshold) || threshold < 0) throw new Error('Invalid snap tolerance')
    const targets = [0, 0.5, 1, ...neighbours.flatMap(n => [n[axis], n[axis] + n[dimension] / 2, n[axis] + n[dimension]])]
    let distance = threshold; let offset = 0; let guide: number | undefined
    for (const target of targets) for (const fraction of [0, 0.5, 1]) {
      const delta = target - (rect[axis] + rect[dimension] * fraction)
      const position = rect[axis] + delta
      if (Math.abs(delta) <= distance && position >= 0 && position + rect[dimension] <= 1 + EPSILON) {
        distance = Math.abs(delta); offset = delta; guide = target
      }
    }
    if (guide !== undefined) { next[axis] = clamp(rect[axis] + offset, 0, 1 - rect[dimension]); guides.push({ axis, value: guide }) }
  }
  return { rect: next, guides }
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Reject unknown schemas, duplicates, unknown widgets, invalid numbers and overlaps. */
export function decodeLayout(text: string, knownIds: readonly string[], minimums: Readonly<Record<string, MinSize>> = {}): LayoutSnapshot {
  if (new TextEncoder().encode(text).length > MAX_LAYOUT_BYTES) throw new Error('Layout exceeds 64 KiB')
  const value: unknown = JSON.parse(text)
  if (!object(value) || value.schemaVersion !== 1 || !['dark', 'light'].includes(String(value.theme))
    || !Array.isArray(value.placements) || value.placements.length !== knownIds.length) throw new Error('Unsupported layout')
  const seen = new Set<string>()
  const placements: Placement[] = value.placements.map((raw: unknown) => {
    if (!object(raw) || typeof raw.id !== 'string' || !knownIds.includes(raw.id) || seen.has(raw.id)
      || ![raw.x, raw.y, raw.width, raw.height].every(number)) throw new Error('Invalid widget placement')
    seen.add(raw.id)
    const rect: Placement = { id: raw.id, x: raw.x as number, y: raw.y as number, width: raw.width as number, height: raw.height as number }
    const minimum = minimums[rect.id]
    if (!validRect(rect) || (minimum && (rect.width < minimum.width || rect.height < minimum.height))) throw new Error('Invalid widget bounds')
    return rect
  })
  if (!placements.every(p => canPlace(p, placements))) throw new Error('Overlapping layout')
  return { schemaVersion: 1, theme: value.theme as Theme, placements }
}
