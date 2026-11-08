import type { Constraints, Size } from '../freeform/types.ts'
import { projectRegion } from '../freeform/projection.ts'
import { widgetRegistry } from './model.ts'
import type { Registry, View, WidgetType, WorkbenchSnapshot } from './model.ts'
import type { Region } from '../freeform/types.ts'

export const PILOT_VIEW = 'properties'
export type Presentation = 'normal' | 'docked' | 'overlay'
export interface WidgetPresentation {
  viewId: typeof PILOT_VIEW; typeId: 'host:properties'; modelId: 'model:host:properties'; owner: 'host';
  presentation: Presentation; open: boolean; anchor: 'bottom'; preferred: Size
}
export interface Presentations { version: 1; entries: WidgetPresentation[] }
export const PANEL_MIN = { width: 240, height: 220 }
export const PANEL_BAR_HEIGHT = 31
export function availablePresentations(type: WidgetType, region: Region): readonly Presentation[] {
  return type.constraint.regions.includes(region) ? type.presentations?.[region] ?? ['normal'] : ['normal']
}
export function defaultPresentation(): WidgetPresentation {
  return { viewId: PILOT_VIEW, typeId: 'host:properties', modelId: 'model:host:properties', owner: 'host',
    presentation: 'normal', open: true, anchor: 'bottom', preferred: { width: 720, height: 260 } }
}
export function presentationFor(snapshot: WorkbenchSnapshot) {
  return snapshot.organization.presentations?.entries[0] ?? defaultPresentation()
}
export function parsePresentations(value: unknown, views: readonly View[]): Presentations {
  if (value === undefined) return { version: 1, entries: [] }
  const source = value as Presentations
  if (!source || source.version !== 1 || !Array.isArray(source.entries) || source.entries.length > 1) throw new Error('Unsupported presentations')
  const entries = source.entries.map(item => {
    if (!item || item.viewId !== PILOT_VIEW || item.typeId !== 'host:properties' || item.modelId !== 'model:host:properties' || item.owner !== 'host'
      || !views.some(view => view.id === item.viewId && view.typeId === item.typeId && view.modelId === item.modelId)
      || !['normal', 'docked', 'overlay'].includes(item.presentation) || typeof item.open !== 'boolean' || item.anchor !== 'bottom'
      || !item.preferred || !(['width', 'height'] as const).every(axis => typeof item.preferred[axis] === 'number'
        && Number.isFinite(item.preferred[axis]) && item.preferred[axis] >= PANEL_MIN[axis] && item.preferred[axis] <= 4096)) throw new Error('Invalid presentation association or geometry')
    return { viewId: item.viewId, typeId: item.typeId, modelId: item.modelId, owner: item.owner, presentation: item.presentation,
      open: item.open, anchor: item.anchor, preferred: { width: item.preferred.width, height: item.preferred.height } }
  })
  return { version: 1, entries }
}
/** A typed intention changes no geometry, slots, chrome or composition metadata. */
export function changePresentation(source: WorkbenchSnapshot, patch: Partial<Pick<WidgetPresentation, 'presentation' | 'open' | 'preferred'>>, registry: Registry = widgetRegistry()) {
  if (patch.presentation) {
    const view = source.organization.views.find(view => view.id === PILOT_VIEW), placement = source.placements.find(p => p.id === PILOT_VIEW)
    const type = view && registry.get(view.typeId)
    if (!type || !placement || !availablePresentations(type, placement.region).includes(patch.presentation)) throw new Error('Unavailable presentation')
  }
  const entry = { ...presentationFor(source), ...patch }
  if (patch.presentation && patch.presentation !== presentationFor(source).presentation && patch.open === undefined) entry.open = true
  if (patch.presentation === 'normal') entry.open = true
  const presentations = parsePresentations({ version: 1, entries: [entry] }, source.organization.views)
  return { ...source, organization: { ...source.organization, presentations } }
}
/** Pure viewport policy. Neither adaptation nor reveal writes explicit user choices.
 * The Normal slot remains reserved in the canonical scene, even while its content is a panel.
 */
export function effectivePresentation(source: WorkbenchSnapshot, size: Size, constraints: Constraints, expanded = false, scrollbarHeight = 0) {
  const state = presentationFor(source), active = source.placements.some(p => p.id === state.viewId && p.region === 'main')
  const base = { active, shown: active && (state.presentation !== 'docked' || state.open), adapted: false, width: size.width, height: 0,
    reservation: active && state.presentation === 'docked' ? PANEL_BAR_HEIGHT + 9 : 0 }
  if (!active || state.presentation === 'normal') return base
  const width = size.width
  const maximum = Math.min(size.height, state.preferred.height)
  const fits = (height: number) => width >= PANEL_MIN.width && height >= PANEL_MIN.height && height <= size.height
    && (state.presentation !== 'docked' || projectRegion(source, 'main', { width: Math.floor(size.width),
      height: Math.floor(size.height - height - 9 - scrollbarHeight - (scrollbarHeight > 0 ? 1 : 0)) }, expanded, constraints).feasible)
  if (!fits(PANEL_MIN.height)) return { ...base, shown: false, adapted: true }
  let height = maximum
  if (!fits(height)) {
    let low = PANEL_MIN.height, high = maximum
    for (let i = 0; i < 18; i++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid }
    height = low
  }
  return { ...base, width, height, adapted: height < state.preferred.height,
    reservation: state.presentation === 'docked' ? (state.open ? height : PANEL_BAR_HEIGHT) + 9 : 0 }
}
