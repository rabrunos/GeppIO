/** Pure continuous geometry. No DOM, framework, pixels, grid cells or native access. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Placement extends Rect { id: string }
export interface MinSize { width: number; height: number }
export interface LayoutConstraint { min: MinSize; max: MinSize; resizeX: boolean; resizeY: boolean }
export type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_DIRECTIONS: readonly ResizeDirection[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']
export interface Guide { axis: 'x' | 'y'; value: number; kind?: 'alignment' | 'clearance' | 'size' }
export interface PlanningContext { gesture: 'move' | 'normalize' | ResizeDirection; canvas: MinSize; gapPx?: number }
export const EDIT_GAP_PX = 10 // Provisional owner visual trial; not a permanent spacing contract.
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
export function canvasGap(canvas: MinSize, pixels = EDIT_GAP_PX): MinSize {
  if (![canvas.width, canvas.height, pixels].every(number) || canvas.width <= 0 || canvas.height <= 0 || pixels < 0) throw new Error('Invalid canvas spacing')
  return { width: pixels / canvas.width, height: pixels / canvas.height }
}
/** Projection rule: diagonal-only neighbours do not require invented canvas/corner margins.
 * When interiors overlap on one axis, require clearance on the separating axis. */
export function tooClose(a: Rect, b: Rect, gap: MinSize): boolean {
  const intersectsX = a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
  const intersectsY = a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON
  return (intersectsX && intersectsY)
    || (intersectsY && a.x + a.width + gap.width > b.x + EPSILON && b.x + b.width + gap.width > a.x + EPSILON)
    || (intersectsX && a.y + a.height + gap.height > b.y + EPSILON && b.y + b.height + gap.height > a.y + EPSILON)
}
export function canPlaceWithGap(candidate: Placement, placements: readonly Placement[], gap: MinSize): boolean {
  return validRect(candidate) && placements.every(other => other.id === candidate.id || !tooClose(candidate, other, gap))
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
/** Bounded local contact search, not global packing. Resize compresses on its moving axes
 * before considering lateral escape; moves push locally before shrinking. Legacy decoding
 * stays overlap-only: spacing normalization is an explicit, non-persistent edit preview. */
export function reflow(snapshot: readonly Placement[], id: string, requested: Rect,
  constraints: Readonly<Record<string, LayoutConstraint>>, context?: PlanningContext): ReflowResult {
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
  let gap: MinSize
  try { gap = context ? canvasGap(context.canvas, context.gapPx) : { width: 0, height: 0 } }
  catch { return blocked('invalid-input') }
  const gesture = context?.gesture ?? 'move'
  if (!['move', 'normalize', ...RESIZE_DIRECTIONS].includes(gesture)) return blocked('invalid-input')
  if (gesture !== 'move' && gesture !== 'normalize' && !allowsResize(gesture, constraints[id]!)) return blocked('invalid-input')
  const order = [...original].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const bases = new Map(original.map(p => [p.id, p]))
  const dx = candidate.x !== active.x ? candidate.x - active.x : candidate.width - active.width
  const dy = candidate.y !== active.y ? candidate.y - active.y : candidate.height - active.height
  const primary: ('x' | 'y')[] = gesture === 'normalize' ? ['x', 'y'] : gesture === 'move'
    ? [Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'] : [ ...(/[ew]/.test(gesture) ? ['x' as const] : []), ...(/[ns]/.test(gesture) ? ['y' as const] : []) ]
  const budget = 1024
  let probes = 0
  function search(state: Placement[], locked: Set<string>, phase: number, limit: number): Placement[] | undefined {
    if (++attempts > limit) return undefined
    let anchors = state.filter(p => locked.has(p.id))
    let victim = state.filter(p => !locked.has(p.id) && anchors.some(a => tooClose(p, a, gap)))
      .sort((a, b) => Math.abs(a.x - candidate.x) + Math.abs(a.y - candidate.y) - Math.abs(b.x - candidate.x) - Math.abs(b.y - candidate.y)
        || (a.id < b.id ? -1 : 1))[0]
    // Legacy tight pairs elsewhere also need spacing before a new layout can be saved.
    if (!victim) {
      const pair = state.flatMap((a, i) => state.slice(i + 1).filter(b => tooClose(a, b, gap)).map(b => [a, b] as const))[0]
      if (!pair) return state
      if (locked.has(pair[0].id) && locked.has(pair[1].id)) return undefined
      const anchor = locked.has(pair[1].id) ? pair[1] : pair[0]
      victim = anchor.id === pair[0].id ? pair[1] : pair[0]
      locked = new Set([...locked, anchor.id]); anchors = state.filter(p => locked.has(p.id))
    }
    if (probes >= 65536) return undefined
    const c = constraints[victim.id]!
    const base = bases.get(victim.id)!
    const axes = phase === 0 ? primary : ['x', 'y'] as const
    const adaptive = gesture !== 'move' || phase === 2
    const options: { rect: Placement; rank: number }[] = []
    const seen = new Set<string>()
    function add(p: Placement, rank: number) {
      if (++probes > 65536) return
      // A contact search may reject difficult layouts instead of teleporting to a remote hole.
      if (!fits(p, base) || Math.abs(p.x - base.x) > Math.max(base.width, .15) + gap.width + EPSILON
        || Math.abs(p.y - base.y) > Math.max(base.height, .15) + gap.height + EPSILON
        || anchors.some(a => tooClose(p, a, gap))) return
      const key = JSON.stringify([p.x, p.y, p.width, p.height])
      if (!seen.has(key)) { seen.add(key); options.push({ rect: p, rank }) }
    }
    for (const a of anchors) {
      const source = bases.get(a.id)!
      const compressed = { ...victim }
      let changed = false
      for (const axis of axes) {
        const dimension = axis === 'x' ? 'width' : 'height', clearance = gap[dimension]
        const eligible = axis === 'x' ? c.resizeX : c.resizeY
        const forward = base[axis] >= source[axis] + source[dimension] - EPSILON
        const backward = base[axis] + base[dimension] <= source[axis] + EPSILON
        const before = a[axis] - clearance, after = a[axis] + a[dimension] + clearance
        const push = { ...victim, [axis]: forward ? after : backward ? before - victim[dimension]
          : ((axis === 'x' ? dx : dy) >= 0 ? after : before - victim[dimension]) }
        add(push, primary.includes(axis) ? 2 : 3)
        if (adaptive && eligible && (primary.includes(axis) || phase === 2)) {
          const trim = { ...victim }
          if (forward) { trim[axis] = Math.max(victim[axis], after); trim[dimension] = victim[axis] + victim[dimension] - trim[axis] }
          else if (backward) trim[dimension] = Math.min(victim[dimension], before - victim[axis])
          else continue
          add(trim, primary.includes(axis) ? 0 : 4)
          if (trim[dimension] < c.min[dimension]) add({ ...victim, [axis]: forward ? after : before - c.min[dimension],
            [dimension]: c.min[dimension] }, primary.includes(axis) ? 1 : 4)
          compressed[axis] = trim[axis]; compressed[dimension] = trim[dimension]; changed = true
        }
      }
      if (changed) add(compressed, 0)
    }
    // The final fallback combines nearby contact positions, never canvas corners/global repacking.
    if (phase === 2) {
      const local = [...options]
      for (const a of local) for (const b of local) {
        if (probes >= 65536) break
        add({ ...a.rect, y: b.rect.y, height: b.rect.height }, 5)
      }
    }
    const score = (p: Placement) => {
      const mx = p.x - base.x, my = p.y - base.y
      const reversed = dx * mx + dy * my < -EPSILON ? 2 : 0
      const crossed = original.filter(other => other.id !== base.id && other.id !== id).filter(other =>
        (base.x >= other.x + other.width - EPSILON && p.x + p.width <= other.x + EPSILON)
        || (base.x + base.width <= other.x + EPSILON && p.x >= other.x + other.width - EPSILON)
        || (base.y >= other.y + other.height - EPSILON && p.y + p.height <= other.y + EPSILON)
        || (base.y + base.height <= other.y + EPSILON && p.y >= other.y + other.height - EPSILON)).length
      return crossed * 100 + reversed + Math.abs(mx) + Math.abs(my) + (base.width - p.width + base.height - p.height) * 2
    }
    options.sort((a, b) => a.rank - b.rank || score(a.rect) - score(b.rect)
      || a.rect.x - b.rect.x || a.rect.y - b.rect.y || b.rect.width - a.rect.width || b.rect.height - a.rect.height)
    for (const option of options) {
      if (attempts >= limit) break
      const found = search(state.map(p => p.id === victim.id ? option.rect : p), new Set([...locked, victim.id]), phase, limit)
      if (found) return found
    }
    return undefined
  }
  const start = order.map(p => p.id === id ? candidate : { ...p })
  let found: Placement[] | undefined, limited = false
  for (let phase = 0; phase < 3 && !found; phase++) {
    probes = 0; const limit = attempts + budget
    found = search(start, new Set([id]), phase, limit)
    limited ||= probes >= 65536 || attempts >= limit
  }
  if (!found) return blocked(limited ? 'search-limit' : 'no-space')
  const placements = original.map(p => ({ ...found.find(next => next.id === p.id)! }))
  return { status: 'placed', placements, reason: 'none', attempts,
    moved: placements.filter((p, i) => p.x !== original[i]!.x || p.y !== original[i]!.y).map(p => p.id),
    resized: placements.filter((p, i) => p.width !== original[i]!.width || p.height !== original[i]!.height).map(p => p.id) }
}
export function normalizeSpacing(snapshot: readonly Placement[], constraints: Readonly<Record<string, LayoutConstraint>>, context: PlanningContext): ReflowResult {
  const first = [...snapshot].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1))[0]
  return reflow(snapshot, first?.id ?? '', first ?? { x: 0, y: 0, width: 0, height: 0 }, constraints, { ...context, gesture: 'normalize' })
}
/** Snap by edges/centres of neighbours. Tolerance is normalized from a CSS-pixel threshold. */
export function snapMove(rect: Rect, neighbours: Rect[], tolerance: MinSize, gap: MinSize = { width: 0, height: 0 }): { rect: Rect; guides: Guide[] } {
  const next = { ...rect }; const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    const dimension = axis === 'x' ? 'width' : 'height'
    const threshold = tolerance[dimension]
    if (!number(threshold) || threshold < 0) throw new Error('Invalid snap tolerance')
    const otherAxis = axis === 'x' ? 'y' : 'x', otherSize = axis === 'x' ? 'height' : 'width'
    const targets = [0, 0.5, 1, ...neighbours.flatMap(n => [n[axis], n[axis] + n[dimension] / 2, n[axis] + n[dimension],
      ...(rect[otherAxis] < n[otherAxis] + n[otherSize] - EPSILON && rect[otherAxis] + rect[otherSize] > n[otherAxis] + EPSILON
        ? [n[axis] - gap[dimension], n[axis] + n[dimension] + gap[dimension]] : [])])]
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
/** Resize edge/centre and equal-size snap. Opposite anchors are never translated. */
export function snapResize(rect: Rect, direction: ResizeDirection, constraint: LayoutConstraint,
  neighbours: readonly Rect[], tolerance: MinSize, gap: MinSize): { rect: Rect; guides: Guide[] } {
  if (!allowsResize(direction, constraint) || !validRect(rect) || !neighbours.every(validRect)
    || rect.width < constraint.min.width || rect.height < constraint.min.height
    || rect.width > constraint.max.width || rect.height > constraint.max.height
    || ![tolerance.width, tolerance.height, gap.width, gap.height].every(v => number(v) && v >= 0)) throw new Error('Invalid resize snap')
  let next = { ...rect }
  const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    const dimension = axis === 'x' ? 'width' : 'height'
    const leading = direction.includes(axis === 'x' ? 'w' : 'n')
    if (!leading && !direction.includes(axis === 'x' ? 'e' : 's')) continue
    const threshold = tolerance[dimension]
    if (!number(threshold) || threshold < 0 || !number(gap[dimension]) || gap[dimension] < 0) throw new Error('Invalid resize snap tolerance')
    const anchor = leading ? next[axis] + next[dimension] : next[axis]
    const edge = leading ? next[axis] : next[axis] + next[dimension]
    const options: { edge: number; value: number; kind: NonNullable<Guide['kind']> }[] = []
    for (const target of [0, .5, 1, ...neighbours.flatMap(n => [n[axis], n[axis] + n[dimension] / 2, n[axis] + n[dimension]])]) {
      options.push({ edge: target, value: target, kind: 'alignment' }, { edge: target * 2 - anchor, value: target, kind: 'alignment' })
    }
    for (const neighbour of neighbours) {
      const otherAxis = axis === 'x' ? 'y' : 'x', otherSize = axis === 'x' ? 'height' : 'width'
      if (next[otherAxis] < neighbour[otherAxis] + neighbour[otherSize] - EPSILON && next[otherAxis] + next[otherSize] > neighbour[otherAxis] + EPSILON) {
        for (const target of [neighbour[axis] - gap[dimension], neighbour[axis] + neighbour[dimension] + gap[dimension]]) options.push({ edge: target, value: target, kind: 'clearance' })
      }
      const target = anchor + (leading ? -1 : 1) * neighbour[dimension]
      options.push({ edge: target, value: target, kind: 'size' })
    }
    const candidates = options.filter(o => Math.abs(o.edge - edge) <= threshold
      && (leading ? anchor - o.edge : o.edge - anchor) >= constraint.min[dimension]
      && (leading ? anchor - o.edge : o.edge - anchor) <= constraint.max[dimension]
      && o.edge >= 0 && o.edge <= 1)
    const priority = { clearance: 0, size: 1, alignment: 2 }
    candidates.sort((a, b) => Math.abs(a.edge - edge) - Math.abs(b.edge - edge)
      || priority[a.kind] - priority[b.kind] || a.edge - b.edge)
    const chosen = candidates[0]
    if (chosen) {
      next = resizeDirectional(next, axis === 'x' ? chosen.edge - edge : 0, axis === 'y' ? chosen.edge - edge : 0, direction, constraint)
      guides.push({ axis, value: chosen.value, kind: chosen.kind })
    }
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
