import { CONSTRAINTS, DEFAULT_FREEFORM, POLICY, constraintInRegion } from '../freeform/policy.ts'
import type { Constraint, Constraints, Placement, Region, Size, Snapshot } from '../freeform/types.ts'
import type { InstalledPlugin } from '../plugins.ts'
import { CHROME_LIMITS, defaultChrome } from './chrome.ts'
import type { ChromePatch, WorkbenchChrome } from './chrome.ts'
import type { Presentation, Presentations } from './presentations.ts'

export interface WidgetType {
  id: string; owner: string; title: string; category: string; description: string;
  appearance: 'card' | 'seamless'; presence: 'single-view' | 'multiple-areas';
  constraint: Constraint; fixture?: string; widgetId?: string; pluginId?: string; retired?: boolean
  presentations?: Partial<Record<Region, readonly Presentation[]>>
  maximize?: boolean
  tabHost?: boolean; tabMember?: boolean
}
export type Registry = ReadonlyMap<string, WidgetType>
export interface View { id: string; typeId: string; modelId: string }
export interface WidgetGroup { id: string; frameId: string; members: string[]; active: string }
export interface WidgetGroups { version: 1; entries: WidgetGroup[] }
export const TAB_STRIP_HEIGHT = 32
export interface UserBar { id: string; name: string; userNamed: boolean; icon: string; archived: boolean; members: string[]; positions?: Record<string, number> }
export interface Composition {
  id: string; name: string; system: boolean; scopes: Region[];
  reference: Snapshot['reference']; placements: Placement[]; views: View[];
  mode: 'format' | 'format-widgets'; format: FormatSlot[]; chrome?: ChromePatch; groups?: WidgetGroups
}
export interface Organization {
  views: View[]; bars: UserBar[]; activeBar: string;
  compositions: Composition[]; compositionOrder?: string[]; favorites: string[]; defaultComposition: string | null; chrome: WorkbenchChrome; presentations?: Presentations
  groups?: WidgetGroups
}
export interface WorkbenchSnapshot extends Snapshot { organization: Organization; retiredDemos?: DemoArchive }
export interface DemoArchive { reference: Snapshot['reference']; placements: Placement[]; views: View[]; bars: Pick<UserBar, 'id' | 'members' | 'positions'>[]; presentations: Presentations }
export interface FormatSlot { id: string; region: Region; x: number; y: number; width: number; height: number }
export interface SessionSlot extends FormatSlot { reference: Size; sidebarBar?: string }
export interface LocalSessionState {
  projectName: string | null; theme: 'light' | 'dark'; snap: boolean;
  properties: { name: string; density: 'compact' | 'comfortable'; details: boolean }
}
export interface SessionDraft { snapshot: WorkbenchSnapshot; slots: SessionSlot[]; formatId: string | null; formatMode?: 'format' | 'widgets' | null; formatSource?: { placements: Placement[]; reference: Snapshot['reference'] } | null; localState?: LocalSessionState }
export const WORKBENCH_KEY = 'geppio:workbench:v1'
export const HOME = 'home'
export const BAR_ICONS = ['home', 'folder', 'star', 'code', 'notes', 'chart', 'library', 'widgets', 'calendar', 'chat', 'terminal', 'queue', 'clock', 'swatch', 'link', 'git'] as const
export const LIMITS = Object.freeze({ activeBars: 14, legacyActiveBars: 20, savedBars: 100, compositions: 100, favorites: 9, history: 256 })
const FIXTURES = [
  ['summary', 'Panorama', 'Indicadores'], ['queue', 'Fila de trabalho', 'Organização'],
  ['library', 'Biblioteca', 'Organização'], ['notes', 'Ideias em aberto', 'Anotações'],
  ['activity', 'Atividade', 'Organização'], ['properties', 'Propriedades', 'Desenvolvimento'], ['chart', 'Ritmo', 'Indicadores']
] as const

/** Metadata comes exclusively from bundled declarations or validated native inventory.
 * Legacy manifest v1 gets no new fields or authority. One model routes to one runtime.
 */
export function widgetRegistry(plugins: readonly InstalledPlugin[] = [], demoFixtures = false): Registry {
  const entries: WidgetType[] = FIXTURES.map(([fixture, title, category]) => ({
    id: `host:${fixture}`, owner: 'host', fixture, retired: !demoFixtures, title, category, description: 'Widget de demonstração do GeppIO.',
    ...(['summary', 'queue', 'properties', 'activity'].includes(fixture) ? { presentations: { main: ['normal', 'docked', 'overlay'] as const } } : {}),
    appearance: 'card', presence: fixture === 'notes' || fixture === 'library' ? 'multiple-areas' : 'single-view', constraint: {
      ...CONSTRAINTS[fixture]!, regionMin: {
        sidebar: { width: 150, height: CONSTRAINTS[fixture]!.min.height },
        ...(['summary', 'chart'].includes(fixture) ? { bottom: { width: CONSTRAINTS[fixture]!.min.width, height: 105 } } : {})
      }
    }
  }))
  for (const plugin of plugins) for (const widget of plugin.manifest.widgets) entries.push({
    id: `plugin:${plugin.manifest.id}:${widget.id}`, owner: `plugin:${plugin.manifest.id}`, pluginId: plugin.manifest.id, widgetId: widget.id,
    title: widget.title, category: 'Plugins', description: plugin.manifest.name,
    ...(plugin.manifest.id === 'geppio.workspace-essentials' && ['notes', 'scratch', 'checklist', 'prompts'].includes(widget.id) ? { maximize: true } : {}),
    ...(plugin.manifest.id === 'geppio.workspace-essentials' && ['notes', 'checklist', 'prompts'].includes(widget.id) ? { tabHost: true, tabMember: true } : {}),
    appearance: 'card', presence: 'single-view', constraint: {
      min: { width: 180, height: 112 }, default: plugin.manifest.apiVersion === 2 ? { width: 360, height: 360 } : { width: 310, height: 160 }, max: { width: POLICY.maxSize, height: POLICY.maxSize },
      regions: (plugin.manifest.id === 'geppio.workspace-essentials' && ['notes', 'checklist', 'prompts'].includes(widget.id)) || (plugin.manifest.id === 'geppio.time-tracker' && ['timer', 'reports'].includes(widget.id)) ? ['main', 'sidebar', 'bottom'] : ['main'],
      ...((plugin.manifest.id === 'geppio.workspace-essentials' && ['notes', 'checklist', 'prompts'].includes(widget.id)) || (plugin.manifest.id === 'geppio.time-tracker' && ['timer', 'reports'].includes(widget.id)) ? { regionMin: { sidebar: { width: 150, height: 112 }, bottom: { width: 180, height: 105 } } } : {}),
      resizeX: true, resizeY: true, overflow: 'auto', responsive: 'region'
    }
  })
  return new Map(entries.map(type => [type.id, Object.freeze(type)]))
}
export function modelId(typeId: string) { return `model:${typeId}` }
export function groupFor(source: WorkbenchSnapshot, id: string) { return source.organization.groups?.entries.find(group => group.members.includes(id)) }
export function groupConstraint(members: readonly View[], registry: Registry): Constraint {
  const originals = members.map(view => registry.get(view.typeId)!.constraint), declarations = originals.map(c => constraintInRegion(c, 'main')), base = declarations[0]!
  const regions = (['main', 'sidebar', 'bottom'] as const).filter(region => originals.every(c => c.regions.includes(region)))
  const regionMin = Object.fromEntries(regions.map(region => [region, { width: Math.max(...originals.map(c => constraintInRegion(c, region).min.width)), height: Math.max(...originals.map(c => constraintInRegion(c, region).min.height)) + TAB_STRIP_HEIGHT }]))
  return { ...base, regions, regionMin,
    min: { width: Math.max(...declarations.map(c => c.min.width)), height: Math.max(...declarations.map(c => c.min.height)) + TAB_STRIP_HEIGHT },
    max: { width: Math.min(...declarations.map(c => c.max.width)), height: Math.min(POLICY.maxSize, ...declarations.map(c => c.max.height + TAB_STRIP_HEIGHT)) },
    resizeX: declarations.every(c => c.resizeX), resizeY: declarations.every(c => c.resizeY) }
}
/** Catalog/presence inspection only. The geometry engine still sees one placement. */
export function surfacePlacements(source: WorkbenchSnapshot): Placement[] {
  return [...source.placements, ...(source.organization.groups?.entries ?? []).flatMap(group => {
    const frame = source.placements.find(p => p.id === group.frameId)
    return frame ? group.members.filter(id => id !== group.frameId).map(id => ({ ...frame, id })) : []
  })]
}
export function removeGroupedPresence(source: WorkbenchSnapshot, id: string, registry?: Registry): WorkbenchSnapshot {
  const group = groupFor(source, id); if (!group) return source
  const next = structuredClone(source), members = group.members.filter(member => member !== id)
  const frameId = group.frameId !== id ? group.frameId : members.length === 1 || !registry ? members[0]! : members.find(member => registry.get(source.organization.views.find(view => view.id === member)!.typeId)?.tabHost)
  if (!frameId) return source
  next.placements = next.placements.map(p => p.id === group.frameId ? { ...p, id: frameId } : p)
  next.organization.groups = { version: 1, entries: next.organization.groups!.entries.flatMap(item => item.id !== group.id ? [item] : members.length < 2 ? [] : [{ ...item, frameId, members, active: members.includes(item.active) ? item.active : members[0]! }]) }
  const oldType = source.organization.views.find(view => view.id === id)!.typeId
  const frameType = source.organization.views.find(view => view.id === group.frameId)!.typeId
  const newFrameType = source.organization.views.find(view => view.id === frameId)!.typeId
  if (source.placements.find(p => p.id === group.frameId)?.region === 'sidebar') for (const bar of next.organization.bars) {
    if (!bar.members.includes(frameType)) continue
    const y = bar.positions?.[frameType] ?? source.placements.find(p => p.id === group.frameId)!.y
    bar.members = bar.members.filter(type => type !== oldType)
    bar.positions ??= {}; delete bar.positions[oldType]; bar.positions[newFrameType] = y
  }
  return next
}
export function frameTypes(source: WorkbenchSnapshot, id: string) {
  return (groupFor(source, id)?.members ?? [id]).map(member => source.organization.views.find(view => view.id === member)!.typeId)
}
export function constraintsForViews(snapshot: WorkbenchSnapshot, registry: Registry): Constraints {
  return Object.fromEntries(snapshot.organization.views.flatMap(view => {
    const type = registry.get(view.typeId)
    const group = groupFor(snapshot, view.id)
    return type ? [[view.id, group?.frameId === view.id ? groupConstraint(group.members.map(id => snapshot.organization.views.find(v => v.id === id)!), registry) : type.constraint]] : []
  }))
}
export function adoptLayout(layout: Snapshot): WorkbenchSnapshot {
  const chrome = defaultChrome()
  // Explicit adoption maps an occupied legacy inner reference to approved chrome;
  // it never guesses from an unused legacy region or changes the source bytes.
  for (const region of ['sidebar', 'bottom'] as const) if (layout.placements.some(p => p.region === region)) {
    const extent = region === 'sidebar' ? layout.reference.sidebar.width + 30 : layout.reference.bottom.height + 20
    chrome[region].size = Math.max(CHROME_LIMITS[region].min, Math.min(CHROME_LIMITS[region].max, extent))
  }
  return { ...structuredClone(layout), organization: {
    views: layout.placements.map(p => ({ id: p.id, typeId: `host:${p.id}`, modelId: modelId(`host:${p.id}`) })),
    bars: [{ id: HOME, name: 'Ferramentas', userNamed: false, icon: 'home', archived: false,
      members: layout.placements.filter(p => p.region === 'sidebar').map(p => `host:${p.id}`),
      positions: Object.fromEntries(layout.placements.filter(p => p.region === 'sidebar').map(p => [`host:${p.id}`, p.y])) }],
    activeBar: HOME, compositions: [], favorites: ['system:default', 'system:focus', 'system:balanced'], defaultComposition: 'system:default', chrome, presentations: { version: 2, entries: [] }
  } }
}
/** Synthetic scenes are opt-in fixtures, never the normal startup/reset policy. */
export function initialWorkbench(demoFixtures = false) {
  const snapshot = adoptLayout(DEFAULT_FREEFORM)
  snapshot.reference = { main: { width: 1567, height: 774 }, sidebar: { width: 253, height: 950 }, bottom: { width: 1543, height: 147 } }
  snapshot.placements = [
    { id: 'summary', region: 'main', x: 0, y: 0, width: 778.5, height: 382 },
    { id: 'queue', region: 'main', x: 788.5, y: 0, width: 778.5, height: 382 },
    { id: 'properties', region: 'main', x: 0, y: 392, width: 778.5, height: 382 },
    { id: 'activity', region: 'main', x: 788.5, y: 392, width: 778.5, height: 382 },
    { id: 'notes', region: 'sidebar', x: 0, y: 0, width: 253, height: 300 },
    { id: 'library', region: 'sidebar', x: 0, y: 310, width: 253, height: 230 },
    { id: 'chart', region: 'bottom', x: 0, y: 0, width: 1543, height: 147 }
  ].map(p => ({ ...p, region: p.region as Region, preferred: { width: p.width, height: p.height } }))
  snapshot.organization.bars[0]!.members = ['host:notes', 'host:library']
  snapshot.organization.bars[0]!.positions = { 'host:notes': 0, 'host:library': 310 }
  if (!demoFixtures) {
    snapshot.placements = []; snapshot.organization.views = []
    snapshot.organization.bars[0]!.members = []; snapshot.organization.bars[0]!.positions = {}
  }
  return snapshot
}
export function activePlacements(snapshot: WorkbenchSnapshot, packed = true) {
  const bar = snapshot.organization.bars.find(bar => bar.id === snapshot.organization.activeBar), sidebar: Placement[] = []
  let bottom = 0
  for (const typeId of bar?.members ?? []) {
    const view = snapshot.organization.views.find(view => view.typeId === typeId && snapshot.placements.some(p => p.id === view.id && p.region === 'sidebar'))
    const placement = snapshot.placements.find(p => p.id === view?.id)
    if (!placement) continue
    const y = bar?.positions?.[typeId] ?? placement.y
    sidebar.push({ ...placement, y })
  }
  // Saved free positions determine a stable per-bar order, never empty bands.
  // This projection does not mutate the recovery source or write on startup.
  sidebar.sort((a, b) => a.y - b.y)
  if (packed) for (const p of sidebar) { p.x = 0; p.y = bottom; bottom += p.height + POLICY.gap }
  return [...snapshot.placements.filter(p => p.region !== 'sidebar'), ...sidebar]
}

/** Insertion uses peer midpoints; the same rule drives commands and drag feedback. */
export function sidebarInsertion(snapshot: WorkbenchSnapshot, id: string | null, y = Infinity) {
  const peers = activePlacements(snapshot).filter(p => p.region === 'sidebar' && p.id !== id)
  const found = peers.findIndex(p => y < p.y + p.height / 2), index = found < 0 ? peers.length : found
  return { peers, index, y: index < peers.length ? peers[index]!.y : peers.length ? peers.at(-1)!.y + peers.at(-1)!.height + POLICY.gap : 0 }
}
export function evaluatePlacement(snapshot: WorkbenchSnapshot, registry: Registry, typeId: string, region: Region,
  operation: 'catalog' | 'move' | 'swap' | 'restore', ignored: readonly string[] = [], disabled: ReadonlySet<string> = new Set()) {
  const type = registry.get(typeId)
  if (!type || type.retired || !type.constraint.regions.includes(region)) return { allowed: false, reason: 'incompatible' } as const
  if (disabled.has(type.owner)) return { allowed: false, reason: 'paused' } as const
  const grouped = snapshot.organization.views.some(view => view.typeId === typeId && groupFor(snapshot, view.id))
  if (grouped && operation === 'catalog') return { allowed: false, reason: 'occupied' } as const
  const movingGroup = snapshot.organization.groups?.entries.find(group => ignored.includes(group.frameId) && group.members.some(id => snapshot.organization.views.some(view => view.id === id && view.typeId === typeId)))
  if (movingGroup && movingGroup.members.some(id => !registry.get(snapshot.organization.views.find(view => view.id === id)!.typeId)!.constraint.regions.includes(region))) return { allowed: false, reason: 'incompatible' } as const
  if (region !== 'sidebar' && type.presence === 'single-view' && snapshot.organization.views.some(view => view.typeId === typeId && (operation === 'catalog' || ignored.includes(view.id))
    && snapshot.placements.some(p => p.id === view.id && p.region === 'sidebar'))
    && snapshot.organization.bars.some(bar => bar.id !== snapshot.organization.activeBar && bar.members.includes(typeId))) return { allowed: false, reason: 'occupied' } as const
  const existing = snapshot.organization.views.filter(view => view.typeId === typeId && !ignored.includes(view.id))
  const occupied = surfacePlacements(snapshot).filter(p => existing.some(view => view.id === p.id))
  if (region === 'sidebar' && operation === 'catalog') {
    const bar = snapshot.organization.bars.find(bar => bar.id === snapshot.organization.activeBar)!
    if (bar.members.includes(typeId)) return { allowed: false, reason: 'occupied' } as const
  } else if (occupied.some(p => p.region === region)) return { allowed: false, reason: 'occupied' } as const
  if (operation === 'catalog' && snapshot.organization.views.length >= POLICY.maxWidgets && !existing.some(view => type.presence === 'single-view' || !snapshot.placements.some(p => p.id === view.id))) return { allowed: false, reason: 'limit' } as const
  return { allowed: true, reason: null } as const
}
