/** Pure continuous geometry. No DOM, framework, pixels, grid cells or native access. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Placement extends Rect { id: string }
export interface MinSize { width: number; height: number }
export interface LayoutConstraint { min: MinSize; max: MinSize; resizeX: boolean; resizeY: boolean }
export type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_DIRECTIONS: readonly ResizeDirection[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']
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
function validConstraint(c: LayoutConstraint): boolean {
  return [c.min.width, c.min.height, c.max.width, c.max.height].every(number)
    && c.min.width > 0 && c.min.height > 0 && c.max.width >= c.min.width
    && c.max.height >= c.min.height && c.max.width <= 1 && c.max.height <= 1
    && typeof c.resizeX === 'boolean' && typeof c.resizeY === 'boolean'
}
export function allowsResize(direction: ResizeDirection, c: LayoutConstraint): boolean {
  return RESIZE_DIRECTIONS.includes(direction) && validConstraint(c)
    && (!/[ew]/.test(direction) || c.resizeX) && (!/[ns]/.test(direction) || c.resizeY)
}
/** Moving edges are clamped; the opposite edges stay exactly anchored. */
export function resizeDirectional(rect: Rect, dx: number, dy: number, direction: ResizeDirection, c: LayoutConstraint): Rect {
  if (!validRect(rect) || ![dx, dy].every(number) || !allowsResize(direction, c)
    || rect.width < c.min.width || rect.height < c.min.height
    || rect.width > c.max.width || rect.height > c.max.height) throw new Error('Invalid directional resize')
  const next = { ...rect }
  if (direction.includes('e')) next.width = clamp(rect.width + dx, c.min.width, Math.min(c.max.width, 1 - rect.x))
  if (direction.includes('w')) {
    next.width = clamp(rect.width - dx, c.min.width, Math.min(c.max.width, rect.x + rect.width))
    next.x = rect.x + rect.width - next.width
  }
  if (direction.includes('s')) next.height = clamp(rect.height + dy, c.min.height, Math.min(c.max.height, 1 - rect.y))
  if (direction.includes('n')) {
    next.height = clamp(rect.height - dy, c.min.height, Math.min(c.max.height, rect.y + rect.height))
    next.y = rect.y + rect.height - next.height
  }
  return next
}

export interface ReflowResult {
  status: 'placed' | 'blocked'; placements: Placement[]; moved: string[]; resized: string[]
  reason: 'none' | 'invalid-input' | 'no-space' | 'search-limit'; attempts: number
}
/** A bounded heuristic, not exhaustive packing. Locks the active widget, then each impacted
 * neighbour while exploring alternative relocations. Every call uses the gesture-start snapshot.
 * A complete displacement-only pass precedes adaptive shrinking. No intermediate state escapes. */
export function reflow(snapshot: readonly Placement[], id: string, requested: Rect,
  constraints: Readonly<Record<string, LayoutConstraint>>): ReflowResult {
  const original = snapshot.map(p => ({ ...p }))
  let attempts = 0
  const blocked = (reason: ReflowResult['reason']): ReflowResult => ({ status: 'blocked', placements: original,
    moved: [], resized: [], reason, attempts })
  const fits = (p: Placement, base: Placement): boolean => {
    const c = constraints[p.id]
    return !!c && validConstraint(c) && validRect(p) && p.width >= c.min.width && p.height >= c.min.height
      && p.width <= c.max.width && p.height <= c.max.height
      && (c.resizeX || p.width === base.width) && (c.resizeY || p.height === base.height)
  }
  const active = original.find(p => p.id === id)
  if (!active || original.length > 16 || new Set(original.map(p => p.id)).size !== original.length
    || !original.every(p => fits(p, p) && canPlace(p, original))) return blocked('invalid-input')
  const candidate: Placement = { id, x: requested.x, y: requested.y, width: requested.width, height: requested.height }
  if (!fits(candidate, active)) return blocked('invalid-input')
  const order = [...original].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const dx = candidate.x !== active.x ? candidate.x - active.x : candidate.width - active.width
  const dy = candidate.y !== active.y ? candidate.y - active.y : candidate.height - active.height
  const budget = 2048
  let probes = 0
  function search(state: Placement[], locked: Set<string>, adaptive: boolean, limit: number): Placement[] | undefined {
    if (++attempts > limit) return undefined
    const anchors = state.filter(p => locked.has(p.id))
    const victim = state.find(p => !locked.has(p.id) && anchors.some(a => overlaps(p, a)))
    if (!victim) return state.every(p => canPlace(p, state)) ? state : undefined
    if (probes >= 65536) return undefined
    const c = constraints[victim.id]!
    // Contact coordinates include arbitrary fractions; they are not grid cells.
    const widths = [victim.width], heights = [victim.height]
    if (adaptive && c.resizeX) widths.push(c.min.width, ...anchors.flatMap(a => [a.x - victim.x, 1 - a.x - a.width,
      ...state.map(other => other.x - a.x - a.width)]))
    if (adaptive && c.resizeY) heights.push(c.min.height, ...anchors.flatMap(a => [a.y - victim.y, 1 - a.y - a.height,
      ...state.map(other => other.y - a.y - a.height)]))
    const sizes = (values: number[], min: number, current: number) => [...new Set(values.filter(v => v >= min && v <= current))]
    const options: Placement[] = []
    for (const width of sizes(widths, c.min.width, victim.width)) for (const height of sizes(heights, c.min.height, victim.height)) {
      const xs = [victim.x, victim.x + victim.width - width, 0, 1 - width, ...anchors.flatMap(a => [a.x - width, a.x + a.width])]
      const ys = [victim.y, victim.y + victim.height - height, 0, 1 - height, ...anchors.flatMap(a => [a.y - height, a.y + a.height])]
      for (const x of new Set(xs)) for (const y of new Set(ys)) {
        if (++probes > 65536) return undefined
        const p = { id: victim.id, x, y, width, height }
        if (fits(p, victim) && anchors.every(a => !overlaps(a, p))) options.push(p)
      }
    }
    const score = (p: Placement) => {
      const mx = p.x - victim.x, my = p.y - victim.y
      const reverse = (dx * mx + dy * my < -EPSILON) ? .05 : 0
      return (victim.width - p.width + victim.height - p.height) * 4 + Math.abs(mx) + Math.abs(my) + reverse
    }
    options.sort((a, b) => score(a) - score(b) || a.x - b.x || a.y - b.y || b.width - a.width || b.height - a.height)
    for (const option of options) {
      if (attempts >= limit) break
      const found = search(state.map(p => p.id === victim.id ? option : p), new Set([...locked, victim.id]), adaptive, limit)
      if (found) return found
    }
    return undefined
  }
  const start = order.map(p => p.id === id ? candidate : { ...p })
  let found = search(start, new Set([id]), false, budget)
  const displacementLimited = probes >= 65536 || attempts >= budget
  const adaptiveLimit = attempts + budget
  if (!found) { probes = 0; found = search(start, new Set([id]), true, adaptiveLimit) }
  if (!found) return blocked(displacementLimited || probes >= 65536 || attempts >= adaptiveLimit ? 'search-limit' : 'no-space')
  const placements = original.map(p => ({ ...found.find(next => next.id === p.id)! }))
  return { status: 'placed', placements, reason: 'none', attempts,
    moved: placements.filter((p, i) => p.x !== original[i]!.x || p.y !== original[i]!.y).map(p => p.id),
    resized: placements.filter((p, i) => p.width !== original[i]!.width || p.height !== original[i]!.height).map(p => p.id) }
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
