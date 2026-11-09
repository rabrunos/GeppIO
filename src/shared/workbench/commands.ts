import { validLayout, collides } from '../freeform/geometry.ts'
import { constraintInRegion, constraintsFor, POLICY } from '../freeform/policy.ts'
import { projectRegion } from '../freeform/projection.ts'
import { transfer } from '../freeform/transfer.ts'
import type { Placement, Region, Size, Surface } from '../freeform/types.ts'
import { HOME, LIMITS, activePlacements, constraintsForViews, evaluatePlacement, modelId, sidebarInsertion } from './model.ts'
import type { Registry, UserBar, WorkbenchSnapshot } from './model.ts'
import { panelIds, validatePresentationEdges } from './presentations.ts'

/** Repack every bar after explicit intentions, preserving each bar's stable order.
 * Projection uses the same rule without changing saved bytes.
 */
export function reconcileBarHeights(source: WorkbenchSnapshot): WorkbenchSnapshot | null {
  const bars: UserBar[] = []
  for (const bar of source.organization.bars) {
    const placements = activePlacements({ ...source, organization: { ...source.organization, activeBar: bar.id } }).filter(p => p.region === 'sidebar').sort((a, b) => a.y - b.y)
    const positions = { ...bar.positions }; let end = -POLICY.gap
    for (const p of placements) {
      const y = end + POLICY.gap, typeId = source.organization.views.find(view => view.id === p.id)!.typeId
      if (y + p.height > POLICY.maxCoordinate) return null
      positions[typeId] = y
      end = y + p.height
    }
    bars.push({ ...bar, positions })
  }
  const next = { ...source, organization: { ...source.organization, bars } }
  const active = activePlacements(next).filter(p => p.region === 'sidebar')
  return { ...next, placements: next.placements.map(p => active.find(q => q.id === p.id) ?? p),
    reference: { ...next.reference, sidebar: { ...next.reference.sidebar, height: Math.max(next.reference.sidebar.height, ...active.map(p => p.y + p.height)) } } }
}

function insertSidebar(source: WorkbenchSnapshot, registry: Registry, id: string, target: Surface, y?: number, size?: Size): WorkbenchSnapshot | null {
  if (y !== undefined && !Number.isFinite(y)) return null
  const next = structuredClone(source), placement = next.placements.find(p => p.id === id)!
  const typeId = next.organization.views.find(view => view.id === id)!.typeId
  const c = constraintInRegion(registry.get(typeId)!.constraint, 'sidebar')
  if (size && (size.width < c.min.width || size.width > c.max.width)) return null
  const insertion = sidebarInsertion(source, id, y)
  Object.assign(placement, { region: 'sidebar', x: 0, width: target.width, height: size?.height ?? Math.max(c.min.height, Math.min(c.max.height, placement.height)) })
  const ordered = [...insertion.peers]; ordered.splice(insertion.index, 0, placement)
  const bar = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
  bar.members = ordered.map(p => next.organization.views.find(view => view.id === p.id)!.typeId)
  let end = 0; bar.positions = {}
  for (const p of ordered) { bar.positions[next.organization.views.find(view => view.id === p.id)!.typeId] = end; end += p.height + POLICY.gap }
  placement.y = bar.positions[typeId]!
  placement.preferred = { width: placement.width, height: placement.height }
  next.reference.sidebar = { width: target.width, height: Math.max(target.height, end - POLICY.gap) }
  if (target.width < c.min.width || target.width > c.max.width || !validLayout(activePlacements(next).filter(p => p.region === 'sidebar'), target, constraintsFor(target, constraintsForViews(next, registry)))) return null
  return reconcileBarHeights(next)
}

export function addWidget(source: WorkbenchSnapshot, registry: Registry, typeId: string, surface: Surface,
  at?: { x: number; y: number }, disabled?: ReadonlySet<string>, slotSize?: Size): WorkbenchSnapshot | null {
  if (!evaluatePlacement(source, registry, typeId, surface.region, 'catalog', [], disabled).allowed) return null
  let next = structuredClone(source)
  const type = registry.get(typeId)!
  let view = next.organization.views.find(view => view.typeId === typeId && (type.presence === 'single-view'
    || next.placements.some(p => p.id === view.id && p.region === surface.region)))
  if (!view) {
    view = next.organization.views.find(view => view.typeId === typeId && !next.placements.some(p => p.id === view.id))
    if (!view) {
      if (next.organization.views.length >= POLICY.maxWidgets) return null
      const id = `${type.id}:view:${surface.region}`
      if (next.organization.views.some(view => view.id === id)) return null
      view = { id, typeId, modelId: modelId(typeId) }; next.organization.views.push(view)
    }
  }
  const existing = next.placements.find(p => p.id === view.id)
  if (existing && existing.region !== surface.region && type.presence === 'single-view' && !slotSize) return moveView(source, registry, existing.id, surface, at)
  if (existing && slotSize) {
    next = removePresence(next, existing.id)
    next.placements = next.placements.filter(p => p.id !== existing.id)
  }
  if (surface.region === 'sidebar') {
    const bar = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
    const peers = activePlacements(next).filter(p => p.region === 'sidebar')
    bar.positions ??= {}
    bar.positions[typeId] ??= at?.y ?? Math.max(0, ...peers.map(p => p.y + p.height + POLICY.gap))
    if (!bar.members.includes(typeId)) bar.members.push(typeId)
    if (existing?.region === 'sidebar' && !slotSize) return insertSidebar(next, registry, existing.id, surface, at?.y)
  }
  if (!existing || slotSize) next.placements.push({ id: view.id, region: surface.region, x: slotSize ? at?.x ?? 0 : 0, y: slotSize ? at?.y ?? 0 : 0,
    ...(slotSize ?? type.constraint.default), preferred: { ...(slotSize ?? type.constraint.default) } })
  if (surface.region === 'sidebar') return insertSidebar(next, registry, view.id, surface, at?.y, slotSize)
  if (slotSize) {
    // A reserved rectangle is an explicit placement/size intention, not a move
    // pretending to resize its default seed. The solver's move invariant stays intact.
    return exactPlacement(next, registry, view.id, surface, at, slotSize)
  }
  return transferActive(next, registry, view.id, surface, at)
}
function transferActive(source: WorkbenchSnapshot, registry: Registry, id: string, target: Surface, at?: { x: number; y: number }) {
  const panels = panelIds(source)
  const active = activePlacements(source).filter(p => !panels.has(p.id) || p.id === id), activeIds = new Set(active.map(p => p.id))
  const original = source.placements.find(p => p.id === id)!
  const solverSource = { ...source, placements: [...active.filter(p => p.id !== id), original] }
  const moved = transfer(solverSource, id, target, at, constraintsForViews(source, registry))
  if (!moved) return null
  const placements = source.placements.map(p => moved.placements.find(q => q.id === p.id) ?? p)
  for (const p of moved.placements) if (!placements.some(q => q.id === p.id)) placements.push(p)
  const result = { ...moved, placements }
  try { validatePresentationEdges(result) } catch { return null }
  if (target.region === 'sidebar') {
    const bar = result.organization.bars.find(bar => bar.id === result.organization.activeBar)!
    bar.positions ??= {}
    for (const p of moved.placements.filter(p => p.region === 'sidebar' && (activeIds.has(p.id) || p.id === id))) {
      const typeId = source.organization.views.find(view => view.id === p.id)!.typeId
      bar.positions[typeId] = p.y
    }
    result.reference.sidebar.height = Math.max(result.reference.sidebar.height, ...placements.filter(p => p.region === 'sidebar').map(p => p.y + p.height))
  }
  return reconcileBarHeights(result)
}
/** Movement changes only the source association and the chosen destination bar. */
export function moveView(source: WorkbenchSnapshot, registry: Registry, id: string, target: Surface, at?: { x: number; y: number }, sourceBar = source.organization.activeBar, slotSize?: Size, disabled?: ReadonlySet<string>): WorkbenchSnapshot | null {
  const view = source.organization.views.find(view => view.id === id), placement = source.placements.find(p => p.id === id)
  if (!view || !placement) return null
  const type = registry.get(view.typeId)
  if (!type) return null
  const next = structuredClone(source), destination = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
  const otherSidebar = next.placements.find(p => p.id !== id && p.region === 'sidebar' && next.organization.views.find(view => view.id === p.id)?.typeId === type.id)
  if (target.region === 'sidebar' && destination.members.includes(type.id) && (placement.region !== 'sidebar' || sourceBar !== destination.id)) return null
  if (!evaluatePlacement(source, registry, type.id, target.region, 'move', [id, ...(otherSidebar ? [otherSidebar.id] : [])], disabled).allowed) return null
  if (placement.region === 'sidebar' && (sourceBar !== destination.id || target.region !== 'sidebar')) {
    const origin = next.organization.bars.find(bar => bar.id === sourceBar)
    if (origin) { origin.members = origin.members.filter(member => member !== type.id); if (origin.positions) delete origin.positions[type.id] }
    if (type.presence === 'multiple-areas' && target.region !== 'sidebar' && next.organization.bars.some(bar => bar.members.includes(type.id))) return addWidget(next, registry, type.id, target, at, disabled, slotSize)
  }
  if (target.region === 'sidebar' && otherSidebar) {
    next.placements = next.placements.filter(p => p.id !== id)
    if (!destination.members.includes(type.id)) destination.members.push(type.id)
    destination.positions ??= {}; destination.positions[type.id] ??= Math.max(0, ...activePlacements(next).filter(p => p.region === 'sidebar' && p.id !== otherSidebar.id).map(p => p.y + p.height + POLICY.gap))
    return insertSidebar(next, registry, otherSidebar.id, target, at?.y, slotSize)
  }
  if (target.region === 'sidebar') return insertSidebar(next, registry, id, target, at?.y, slotSize)
  const moved = slotSize ? exactPlacement(next, registry, id, target, at, slotSize) : transferActive(next, registry, id, target, at)
  return moved
}
/** An explicit rectangle never goes through default-size insertion or solver resize. */
function exactPlacement(source: WorkbenchSnapshot, registry: Registry, id: string, target: Surface, at: { x: number; y: number } | undefined, size: Size): WorkbenchSnapshot | null {
  const next = structuredClone(source), placement = next.placements.find(p => p.id === id)
  if (!placement || !at) return null
  Object.assign(placement, { x: at.x, y: at.y, width: size.width, height: size.height, region: target.region, preferred: { width: size.width, height: size.height } })
  next.reference[target.region] = { width: target.width, height: target.region === 'sidebar' ? Math.max(target.height, at.y + size.height) : target.height }
  if (target.region === 'sidebar') {
    const bar = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
    bar.positions ??= {}; bar.positions[next.organization.views.find(view => view.id === id)!.typeId] = at.y
  }
  try { validatePresentationEdges(next) } catch { return null }
  const panels = panelIds(next)
  if (!validLayout(activePlacements(next).filter(p => p.region === target.region && !panels.has(p.id)), target, constraintsFor(target, constraintsForViews(next, registry)))) return null
  return target.region === 'sidebar' ? reconcileBarHeights(next) : next
}
export function removePresence(source: WorkbenchSnapshot, id: string): WorkbenchSnapshot {
  const next = structuredClone(source), placement = next.placements.find(p => p.id === id), view = next.organization.views.find(v => v.id === id)
  if (!placement || !view) return source
  if (placement.region === 'sidebar') {
    const bar = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
    bar.members = bar.members.filter(typeId => typeId !== view.typeId)
    if (bar.positions) delete bar.positions[view.typeId]
    if (next.organization.bars.some(bar => bar.members.includes(view.typeId))) return next
  }
  next.placements = next.placements.filter(p => p.id !== id)
  return next
}
export function updateBar(source: WorkbenchSnapshot, bar: UserBar): WorkbenchSnapshot | null {
  const next = structuredClone(source), old = next.organization.bars.find(item => item.id === bar.id)
  if (!bar.name.trim() || bar.name.length > 100 || new Set(bar.members).size !== bar.members.length) return null
  if (bar.id === HOME && bar.archived) return null
  if (old) next.organization.bars[next.organization.bars.indexOf(old)] = structuredClone(bar)
  else next.organization.bars.push(structuredClone(bar))
  const activeCount = (snapshot: WorkbenchSnapshot) => snapshot.organization.bars.filter(bar => !bar.archived && bar.id !== HOME).length
  if (next.organization.bars.length > LIMITS.savedBars + 1 || (activeCount(next) > LIMITS.activeBars && activeCount(next) > activeCount(source))) return null
  if (next.organization.activeBar === bar.id && bar.archived) next.organization.activeBar = HOME
  return next
}
/** A complete bar edit is one intention. Build from the supplied baseline only. */
export function configureBar(source: WorkbenchSnapshot, registry: Registry, bar: UserBar, surface: Surface, disabled?: ReadonlySet<string>): WorkbenchSnapshot | null {
  if (bar.members.some(id => !registry.get(id) || constraintInRegion(registry.get(id)!.constraint, 'sidebar').min.width > surface.width)) return null
  const canonical = { ...surface, width: source.reference.sidebar.width }
  let next = updateBar(source, { ...bar, members: [] })
  if (!next) return null
  next.organization.activeBar = bar.id
  for (const typeId of bar.members) {
    const added = addWidget(next, registry, typeId, canonical, undefined, disabled)
    if (!added) return null
    next = added
  }
  const saved = next.organization.bars.find(item => item.id === bar.id)!
  if (saved.positions) saved.positions = Object.fromEntries(Object.entries(saved.positions).filter(([id]) => saved.members.includes(id)))
  return next
}
export function deleteBar(source: WorkbenchSnapshot, id: string): WorkbenchSnapshot | null {
  if (id === HOME || !source.organization.bars.find(bar => bar.id === id)?.archived) return null
  return { ...source, organization: { ...source.organization, bars: source.organization.bars.filter(bar => bar.id !== id) } }
}
export function reorderBar(source: WorkbenchSnapshot, id: string, offset: number): WorkbenchSnapshot | null {
  const next = structuredClone(source), bars = next.organization.bars, from = bars.findIndex(bar => bar.id === id), to = from + offset
  if (id === HOME || from < 1 || to < 1 || to >= bars.length) return null
  bars.splice(to, 0, bars.splice(from, 1)[0]!)
  return next
}
/** Two destinations are checked together. Rectangles belong to slots, views retain data. */
export function swapViews(source: WorkbenchSnapshot, registry: Registry, a: string, b: string): WorkbenchSnapshot | null {
  const active = activePlacements(source)
  const first = active.find(p => p.id === a), second = active.find(p => p.id === b)
  if (!first || !second || a === b) return null
  const one = source.organization.views.find(view => view.id === a)!, two = source.organization.views.find(view => view.id === b)!
  if (!evaluatePlacement(source, registry, one.typeId, second.region, 'swap', [a, b]).allowed
    || !evaluatePlacement(source, registry, two.typeId, first.region, 'swap', [a, b]).allowed) return null
  const next = structuredClone(source)
  next.placements = next.placements.map(p => p.id === a ? { ...second, id: a, preferred: { width: second.width, height: second.height } }
    : p.id === b ? { ...first, id: b, preferred: { width: first.width, height: first.height } } : p)
  const bar = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
  if (first.region === 'sidebar' || second.region === 'sidebar') {
    bar.members = bar.members.map(id => first.region === 'sidebar' && id === one.typeId ? two.typeId
      : second.region === 'sidebar' && id === two.typeId ? one.typeId : id)
    if (new Set(bar.members).size !== bar.members.length) return null
    bar.positions ??= {}
    if (first.region === 'sidebar') { delete bar.positions[one.typeId]; bar.positions[two.typeId] = first.y }
    if (second.region === 'sidebar') { delete bar.positions[two.typeId]; bar.positions[one.typeId] = second.y }
    // Simultaneous Sidebar swaps must retain both new positions.
    if (first.region === 'sidebar' && second.region === 'sidebar') { bar.positions[one.typeId] = second.y; bar.positions[two.typeId] = first.y }
    bar.members.sort((a, b) => (bar.positions![a] ?? 0) - (bar.positions![b] ?? 0))
    for (const [placement, destination, record] of [[first, second, one], [second, first, two]] as const) {
      if (placement.region !== 'sidebar' || destination.region === 'sidebar' || !next.organization.bars.some(other => other.id !== bar.id && other.members.includes(record.typeId))) continue
      const type = registry.get(record.typeId)!, id = `${type.id}:view:sidebar`
      if (type.presence === 'single-view') continue
      if (next.organization.views.length >= POLICY.maxWidgets || next.organization.views.some(view => view.id === id)) return null
      next.organization.views.push({ id, typeId: type.id, modelId: modelId(type.id) })
      next.placements.push({ ...placement, id })
    }
  }
  const cs = constraintsForViews(next, registry)
  for (const region of new Set([first.region, second.region])) {
    const surface = { ...source.reference[region], region, expanded: region === 'main' }
    if (!validLayout(activePlacements(next).filter(p => p.region === region), surface, constraintsFor(surface, cs))) return null
  }
  return next
}
export interface ResizePair { kind: 'resizePair'; first: string; second: string; axis: 'x' | 'y'; delta: number }
/** Only this typed command may run an implicit normal-mode geometry transaction. */
export function resizePair(source: WorkbenchSnapshot, registry: Registry, intent: ResizePair): WorkbenchSnapshot | null {
  const active = activePlacements(source), a = active.find(p => p.id === intent.first), b = active.find(p => p.id === intent.second)
  if (!a || !b || a.region !== b.region || !Number.isFinite(intent.delta)) return null
  const horizontal = intent.axis === 'x', start = horizontal ? 'x' : 'y', extent = horizontal ? 'width' : 'height'
  if ((a.region === 'sidebar' && horizontal) || (a.region === 'bottom' && !horizontal)
    || Math.abs(b[start] - a[start] - a[extent] - POLICY.gap) > .1) return null
  const orthogonal = horizontal ? 'y' : 'x', other = horizontal ? 'height' : 'width'
  if (a[orthogonal] >= b[orthogonal] + b[other] || b[orthogonal] >= a[orthogonal] + a[other]) return null
  const first = { ...a, [extent]: a[extent] + intent.delta }, second = { ...b, [start]: b[start] + intent.delta, [extent]: b[extent] - intent.delta }
  first.preferred = { width: first.width, height: first.height }; second.preferred = { width: second.width, height: second.height }
  let next: WorkbenchSnapshot = { ...source, organization: { ...source.organization, bars: source.organization.bars.map(bar => ({ ...bar, positions: { ...bar.positions } })) }, placements: source.placements.map(p => p.id === a.id ? first : p.id === b.id ? second : p) }
  if (a.region === 'sidebar') {
    const bar = next.organization.bars.find(bar => bar.id === next.organization.activeBar)!
    bar.positions![source.organization.views.find(view => view.id === a.id)!.typeId] = first.y
    bar.positions![source.organization.views.find(view => view.id === b.id)!.typeId] = second.y
    const reconciled = reconcileBarHeights(next)
    if (!reconciled) return null
    next = reconciled
  }
  const surface: Surface = { ...source.reference[a.region], region: a.region, expanded: a.region === 'main' }
  return validLayout(activePlacements(next).filter(p => p.region === a.region), surface, constraintsFor(surface, constraintsForViews(next, registry))) ? next : null
}
/** Project a composition against the actual continuous constraints, preserving omitted regions. */
export function fitTargets(source: WorkbenchSnapshot, registry: Registry, targets: Placement[], reference: WorkbenchSnapshot['reference'], scopes: Region[]): WorkbenchSnapshot | null {
  const candidate = { ...source, reference, placements: targets }, cs = constraintsForViews(source, registry)
  const result: Placement[] = source.placements.filter(p => !scopes.includes(p.region))
  for (const region of scopes) {
    const projected = projectRegion(candidate, region, source.reference[region], false, cs)
    const surface = { ...source.reference[region], region, expanded: false }
    if (!projected.feasible || !validLayout(projected.placements, surface, constraintsFor(surface, cs))) return null
    result.push(...projected.placements)
  }
  if (result.some((p, i) => result.slice(i + 1).some(q => p.id === q.id || (p.region === q.region && collides(p, q))))) return null
  const next = { ...source, placements: result }
  try { validatePresentationEdges(next) } catch { return null }
  return next
}
