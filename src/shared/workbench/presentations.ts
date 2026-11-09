import type { Constraints, Placement, Rect, Region, Size } from '../freeform/types.ts'
import { projectRegion } from '../freeform/projection.ts'
import { clamp, collides, validLayout, validRect } from '../freeform/geometry.ts'
import { POLICY } from '../freeform/policy.ts'
import { constraintsForViews, widgetRegistry } from './model.ts'
import type { Registry, View, WidgetType, WorkbenchSnapshot } from './model.ts'

export const PILOT_VIEW = 'properties'
export const EDGES = ['top', 'bottom', 'left', 'right'] as const
export type Edge = typeof EDGES[number]
export type Presentation = 'normal' | 'docked' | 'overlay'
export interface WidgetPresentation {
  viewId: string; typeId: string; modelId: string; owner: string;
  presentation: Presentation; open: boolean; anchor: Edge | null; preferred: Size; position: { x: number; y: number }
}
export type PresentationPatch = Partial<Pick<WidgetPresentation, 'presentation' | 'open' | 'anchor' | 'preferred' | 'position'>>
export interface Presentations { version: 2; entries: WidgetPresentation[] }
export const PANEL_MIN = { width: 240, height: 220 }
export const PANEL_BAR_HEIGHT = 31
export const PANEL_GAP = 10
export const horizontal = (anchor: Edge | null) => anchor === 'top' || anchor === 'bottom'
export function availablePresentations(type: WidgetType, region: Region): readonly Presentation[] {
  return type.constraint.regions.includes(region) ? type.presentations?.[region] ?? ['normal'] : ['normal']
}
export function defaultPresentation(view: View = { id: PILOT_VIEW, typeId: 'host:properties', modelId: 'model:host:properties' }, registry: Registry = widgetRegistry()): WidgetPresentation {
  return { viewId: view.id, typeId: view.typeId, modelId: view.modelId, owner: registry.get(view.typeId)?.owner ?? 'host',
    presentation: 'normal', open: true, anchor: null, preferred: { width: 320, height: 260 },
    position: { x: 24, y: 24 + Math.max(0, ['host:summary', 'host:queue', 'host:properties', 'host:activity'].indexOf(view.typeId)) * 41 } }
}
export function presentationFor(snapshot: WorkbenchSnapshot, id = PILOT_VIEW, registry: Registry = widgetRegistry()) {
  return snapshot.organization.presentations?.entries.find(entry => entry.viewId === id)
    ?? defaultPresentation(snapshot.organization.views.find(view => view.id === id), registry)
}
export function panelIds(source: WorkbenchSnapshot) {
  return new Set(source.organization.presentations?.entries.filter(entry => entry.presentation !== 'normal'
    && source.placements.some(p => p.id === entry.viewId && p.region === 'main')).map(entry => entry.viewId))
}
/** Nested v2 is the only format change. Legacy bottom-only preferences are read without writing. */
export function parsePresentations(value: unknown, views: readonly View[], registry: Registry = widgetRegistry()): Presentations {
  if (value === undefined) return { version: 2, entries: [] }
  const source = value as { version: number; entries: WidgetPresentation[] }
  if (!source || ![1, 2].includes(source.version) || !Array.isArray(source.entries)
    || source.entries.length > (source.version === 1 ? 1 : POLICY.maxWidgets)) throw new Error('Unsupported presentations')
  const seen = new Set<string>()
  const entries = source.entries.map(item => {
    const view = item && views.find(view => view.id === item.viewId), type = view && registry.get(view.typeId)
    if (!item || !view || !type || item.typeId !== view.typeId || item.modelId !== view.modelId || item.owner !== type.owner
      || !availablePresentations(type, 'main').includes(item.presentation) || !type.presentations?.main || seen.has(item.viewId)
      || !['normal', 'docked', 'overlay'].includes(item.presentation) || typeof item.open !== 'boolean'
      || (source.version === 1 ? item.viewId !== PILOT_VIEW || item.anchor !== 'bottom' :
        item.anchor !== null && !EDGES.includes(item.anchor))
      || (item.presentation === 'docked' && item.anchor === null)
      || (source.version === 2 && item.presentation === 'normal' && item.anchor !== null)
      || !item.preferred || !(['width', 'height'] as const).every(axis => typeof item.preferred[axis] === 'number'
        && Number.isFinite(item.preferred[axis]) && item.preferred[axis] >= PANEL_MIN[axis] && item.preferred[axis] <= POLICY.maxSize)
      || (source.version === 2 && (!item.position || ![item.position.x, item.position.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= POLICY.maxCoordinate)))) throw new Error('Invalid presentation association or geometry')
    seen.add(item.viewId)
    return { viewId: item.viewId, typeId: item.typeId, modelId: item.modelId, owner: item.owner, presentation: item.presentation,
      open: item.open, anchor: item.presentation === 'normal' ? null : item.anchor, preferred: { ...item.preferred },
      position: source.version === 1 ? { x: 24, y: 24 } : { ...item.position } }
  })
  return { version: 2, entries }
}
/** Inactive preferences may share an edge. Reactivation must pass this same boundary. */
export function validatePresentationEdges(source: WorkbenchSnapshot) {
  const used = new Set<string>()
  for (const entry of source.organization.presentations?.entries ?? []) if (entry.presentation !== 'normal' && entry.anchor
    && source.placements.some(p => p.id === entry.viewId && p.region === 'main')) {
    const key = entry.anchor
    if (used.has(key)) throw new Error('Occupied presentation edge')
    used.add(key)
  }
}
export function changePresentation(source: WorkbenchSnapshot, patch: PresentationPatch, registry: Registry = widgetRegistry(), id = PILOT_VIEW) {
  const view = source.organization.views.find(view => view.id === id), placement = source.placements.find(p => p.id === id)
  const type = view && registry.get(view.typeId), before = presentationFor(source, id, registry)
  if (!view || !type || !placement || !type.presentations?.main || placement.region !== 'main'
    || !availablePresentations(type, placement.region).includes(patch.presentation ?? before.presentation)) throw new Error('Unavailable presentation')
  const entry = { ...before, ...patch }
  if (patch.presentation && patch.presentation !== before.presentation && patch.open === undefined) entry.open = true
  if (patch.presentation === 'normal') { entry.open = true; entry.anchor = null }
  if (patch.presentation && patch.presentation !== 'normal' && !Object.hasOwn(patch, 'anchor')) throw new Error('Anchor required')
  const previous = source.organization.presentations?.entries ?? []
  const entries = previous.some(e => e.viewId === id) ? previous.map(e => e.viewId === id ? entry : e) : [...previous, entry]
  const presentations = parsePresentations({ version: 2, entries }, source.organization.views, registry)
  const next = { ...source, organization: { ...source.organization, presentations } }
  validatePresentationEdges(next)
  return next
}
export interface PanelGeometry { expanded: Rect; collapsed: Rect; shown: boolean; adapted: boolean; state: WidgetPresentation }
export interface PresentationLayout { panels: Record<string, PanelGeometry>; normal: Rect; reservations: Record<Edge, number>; adapted: boolean; feasible: boolean }
/** One pure arrangement: horizontal edges own corners; absent edges reserve zero.
 * Clamp requested extents together, then collapse in reverse edge priority.
 * Explicit preferences remain untouched by viewport adaptation.
 */
export function arrangePresentations(source: WorkbenchSnapshot, size: Size, constraints: Constraints, expanded = false, scrollbarHeight = 0, hypothetical = true): PresentationLayout {
  const width = Math.max(0, size.width), height = Math.max(0, size.height), ids = panelIds(source)
  const entries = (source.organization.presentations?.entries ?? []).filter(entry => ids.has(entry.viewId))
  const anchored = EDGES.flatMap(edge => entries.filter(entry => entry.anchor === edge))
  const docked = anchored.filter(entry => entry.presentation === 'docked')
  const floating = entries.filter(entry => entry.presentation === 'overlay'), free = floating.filter(entry => entry.anchor === null)
  const peers = { ...source, placements: source.placements.filter(p => !ids.has(p.id) && constraints[p.id]) }
  const open = new Set(docked.filter(e => e.open).map(e => e.viewId))
  const extent = (entry: WidgetPresentation, factor: number) => {
    const axis = horizontal(entry.anchor) ? 'height' : 'width'
    return open.has(entry.viewId) ? PANEL_MIN[axis] + (entry.preferred[axis] - PANEL_MIN[axis]) * factor : PANEL_BAR_HEIGHT
  }
  function budget(factor: number) {
    const reservations = Object.fromEntries(EDGES.map(edge => [edge, 0])) as Record<Edge, number>
    for (const entry of anchored) reservations[entry.anchor!] = extent(entry, factor) + PANEL_GAP
    return { reservations, normal: { x: reservations.left, y: reservations.top,
      width: Math.max(0, width - reservations.left - reservations.right), height: Math.max(0, height - reservations.top - reservations.bottom) } }
  }
  function fits(factor: number) {
    const { normal, reservations } = budget(factor)
    if (normal.width < 32 || normal.height < 32) return false
    if (floating.some(e => e.anchor && !horizontal(e.anchor)) && normal.height < 150) return false
    if (floating.some(e => horizontal(e.anchor)) && normal.width < 160) return false
    if (free.length && (normal.width < 160 || normal.height < free.length * (PANEL_BAR_HEIGHT + PANEL_GAP) - PANEL_GAP)) return false
    if (anchored.some(e => !horizontal(e.anchor)) && height - reservations.top - reservations.bottom < 150) return false
    if (docked.some(e => open.has(e.viewId) && (horizontal(e.anchor) ? width < PANEL_MIN.width : height - reservations.top - reservations.bottom < PANEL_MIN.height))) return false
    return projectRegion(peers, 'main', { width: Math.floor(normal.width), height: Math.floor(normal.height - scrollbarHeight - (scrollbarHeight > 0 ? 1 : 0)) }, expanded, constraints).feasible
  }
  for (const entry of [...docked].reverse()) { if (fits(0)) break; open.delete(entry.viewId) }
  let factor = 1
  if (!fits(1)) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }; factor = lo }
  const { normal, reservations } = budget(factor), panels: Record<string, PanelGeometry> = {}
  for (const state of entries) {
    const isDocked = state.presentation === 'docked', axisHorizontal = horizontal(state.anchor)
    const area: Rect = state.anchor ? { x: 0, y: reservations.top, width, height: Math.max(0, height - reservations.top - reservations.bottom) } : normal
    let w = Math.min(area.width, state.preferred.width), h = Math.min(area.height, state.preferred.height)
    if (state.anchor && axisHorizontal) { w = width; h = Math.min(height - (state.anchor === 'top' ? reservations.bottom : reservations.top), state.preferred.height) }
    if (state.anchor && !axisHorizontal) w = Math.min(width - (state.anchor === 'left' ? reservations.right : reservations.left), state.preferred.width)
    if (state.anchor && !axisHorizontal) h = area.height
    if (isDocked && open.has(state.viewId)) { if (axisHorizontal) h = extent(state, factor); else w = extent(state, factor) }
    let x = area.x, y = area.y
    if (state.anchor && axisHorizontal) y = state.anchor === 'top' ? 0 : height - h
    else if (state.anchor === 'bottom') y = area.y + area.height - h
    if (state.anchor === 'right') x = area.x + area.width - w
    if (state.anchor === null) { x = clamp(state.position.x, area.x, area.x + area.width - w); y = clamp(state.position.y, area.y, area.y + area.height - h) }
    const rect = { x, y, width: w, height: h }, collapsed = { ...rect }
    if (state.anchor === null) { collapsed.width = Math.min(208, area.width); collapsed.height = Math.min(PANEL_BAR_HEIGHT, area.height) }
    else if (axisHorizontal) { collapsed.height = Math.min(PANEL_BAR_HEIGHT, height); if (state.anchor === 'bottom') collapsed.y = height - collapsed.height }
    else { collapsed.width = Math.min(PANEL_BAR_HEIGHT, width); if (state.anchor === 'right') collapsed.x = area.x + area.width - collapsed.width }
    const shown = isDocked ? open.has(state.viewId) : w >= PANEL_MIN.width && h >= PANEL_MIN.height
    panels[state.viewId] = { expanded: rect, collapsed, shown, state,
      adapted: (isDocked ? state.open && !shown : !shown) || (shown && (axisHorizontal ? h < state.preferred.height : state.anchor ? w < state.preferred.width : w < state.preferred.width || h < state.preferred.height)) }
    if (hypothetical && isDocked && !state.open) {
      // Evaluate the same joint policy as an actual reopen, with bounded recursion.
      const reopening = { ...source, organization: { ...source.organization, presentations: { version: 2 as const,
        entries: source.organization.presentations!.entries.map(e => e.viewId === state.viewId ? { ...e, open: true } : e) } } }
      panels[state.viewId]!.expanded = arrangePresentations(reopening, size, constraints, expanded, scrollbarHeight, false).panels[state.viewId]!.expanded
    }
  }
  // Free triggers remain separate even when viewport clamping coalesces saved
  // positions. This is a transient bounded placement, not a stacking interface.
  const parked: Rect[] = [], triggerArea = normal
  for (const state of [...free].sort((a, b) => a.viewId.localeCompare(b.viewId))) {
    const panel = panels[state.viewId]!, w = Math.min(208, triggerArea.width), h = Math.min(PANEL_BAR_HEIGHT, triggerArea.height)
    const x = clamp(state.position.x, triggerArea.x, triggerArea.x + triggerArea.width - w)
    const y = clamp(state.position.y, triggerArea.y, triggerArea.y + triggerArea.height - h)
    const candidates = [y, ...Array.from({ length: free.length }, (_, i) => triggerArea.y + i * (h + PANEL_GAP)), ...parked.map(p => p.y + p.height + PANEL_GAP)]
      .map(at => ({ x, y: at, width: w, height: h })).filter(p => p.y + h <= triggerArea.y + triggerArea.height)
    const trigger = candidates.find(candidate => parked.every(other => !collides(candidate, other))) ?? { x, y, width: w, height: h }
    parked.push(trigger); panel.collapsed = trigger
    panel.expanded = { ...panel.expanded, x: clamp(trigger.x, normal.x, normal.x + normal.width - panel.expanded.width),
      y: clamp(trigger.y, normal.y, normal.y + normal.height - panel.expanded.height) }
  }
  return { normal, reservations, panels, adapted: Object.values(panels).some(p => p.adapted), feasible: fits(factor) }
}
/** Freeze visible peers before releasing the reservation, and validate the exact candidate. */
export function returnToNormal(source: WorkbenchSnapshot, id: string, size: Size, registry: Registry, expanded = false, scrollbarHeight = 0): WorkbenchSnapshot | null {
  const constraints = constraintsForViews(source, registry), before = arrangePresentations(source, size, constraints, expanded, scrollbarHeight), panel = before.panels[id]
  if (!panel) return null
  const next = changePresentation(source, { presentation: 'normal' }, registry, id), ids = panelIds(source)
  const normals = projectRegion({ ...source, placements: source.placements.filter(p => !ids.has(p.id)) }, 'main',
    { width: before.normal.width, height: before.normal.height - scrollbarHeight }, expanded, constraints)
  if (!normals.feasible) return null
  const absolute = normals.placements.map(p => ({ ...p, x: p.x + before.normal.x, y: p.y + before.normal.y }))
  absolute.push({ ...source.placements.find(p => p.id === id)!, ...panel.expanded })
  const candidate = { ...next, reference: { ...next.reference, main: size }, placements: next.placements.map(p => absolute.find(q => q.id === p.id) ?? p) }
  let after = arrangePresentations(candidate, size, constraints, expanded, scrollbarHeight), afterScrollbar = scrollbarHeight
  for (let i = 0; i < 2; i++) {
    afterScrollbar = expanded && absolute.some(p => p.x + p.width > after.normal.x + after.normal.width) ? scrollbarHeight : 0
    after = arrangePresentations(candidate, size, constraints, expanded, afterScrollbar)
  }
  const convert = (p: Placement, rect: Rect) => ({ ...p, ...rect, x: rect.x - after.normal.x, y: rect.y - after.normal.y, preferred: { width: rect.width, height: rect.height } })
  const converted = absolute.map(p => convert(p, p))
  const available = { region: 'main' as const, expanded, width: after.normal.width, height: after.normal.height - afterScrollbar }
  if (!validLayout(converted, available, constraints)
    || !validRect(converted.find(p => p.id === id)!, { ...available, expanded: false }, constraints[id]!)) return null
  next.reference = { ...next.reference, main: { width: available.width, height: available.height } }
  next.placements = next.placements.map(p => converted.find(q => q.id === p.id) ?? p)
  return next
}
