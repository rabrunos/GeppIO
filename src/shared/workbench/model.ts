import { CONSTRAINTS, DEFAULT_FREEFORM, POLICY } from '../freeform/policy.ts'
import type { Constraint, Constraints, Placement, Region, Size, Snapshot } from '../freeform/types.ts'
import type { InstalledPlugin } from '../plugins.ts'
import { CHROME_LIMITS, defaultChrome } from './chrome.ts'
import type { ChromePatch, WorkbenchChrome } from './chrome.ts'

export interface WidgetType {
  id: string; owner: string; title: string; category: string; description: string;
  appearance: 'card' | 'seamless'; presence: 'single-view' | 'multiple-areas';
  constraint: Constraint; fixture?: string; widgetId?: string; pluginId?: string
}
export type Registry = ReadonlyMap<string, WidgetType>
export interface View { id: string; typeId: string; modelId: string }
export interface UserBar { id: string; name: string; userNamed: boolean; icon: string; archived: boolean; members: string[]; positions?: Record<string, number> }
export interface Composition {
  id: string; name: string; system: boolean; scopes: Region[];
  reference: Snapshot['reference']; placements: Placement[]; views: View[];
  mode: 'format' | 'format-widgets'; format: FormatSlot[]; chrome?: ChromePatch
}
export interface Organization {
  views: View[]; bars: UserBar[]; activeBar: string;
  compositions: Composition[]; compositionOrder?: string[]; favorites: string[]; defaultComposition: string | null; chrome: WorkbenchChrome
}
export interface WorkbenchSnapshot extends Snapshot { organization: Organization }
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
export function widgetRegistry(plugins: readonly InstalledPlugin[] = []): Registry {
  const entries: WidgetType[] = FIXTURES.map(([fixture, title, category]) => ({
    id: `host:${fixture}`, owner: 'host', fixture, title, category, description: 'Widget de demonstração do GeppIO.',
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
    appearance: 'card', presence: 'single-view', constraint: {
      min: { width: 180, height: 112 }, default: { width: 310, height: 160 }, max: { width: POLICY.maxSize, height: POLICY.maxSize },
      regions: ['main'], resizeX: true, resizeY: true, overflow: 'auto', responsive: 'region'
    }
  })
  return new Map(entries.map(type => [type.id, Object.freeze(type)]))
}
export function modelId(typeId: string) { return `model:${typeId}` }
export function constraintsForViews(snapshot: WorkbenchSnapshot, registry: Registry): Constraints {
  return Object.fromEntries(snapshot.organization.views.flatMap(view => {
    const type = registry.get(view.typeId)
    return type ? [[view.id, type.constraint]] : []
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
    activeBar: HOME, compositions: [], favorites: ['system:default', 'system:focus', 'system:balanced'], defaultComposition: 'system:default', chrome
  } }
}
export function initialWorkbench() {
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
  return snapshot
}
export function activePlacements(snapshot: WorkbenchSnapshot) {
  const bar = snapshot.organization.bars.find(bar => bar.id === snapshot.organization.activeBar), sidebar: Placement[] = []
  let bottom = 0
  for (const typeId of bar?.members ?? []) {
    const view = snapshot.organization.views.find(view => view.typeId === typeId && snapshot.placements.some(p => p.id === view.id && p.region === 'sidebar'))
    const placement = snapshot.placements.find(p => p.id === view?.id)
    if (!placement) continue
    const y = bar?.positions?.[typeId] ?? bottom
    sidebar.push({ ...placement, y }); bottom = Math.max(bottom, y + placement.height + POLICY.gap)
  }
  return [...snapshot.placements.filter(p => p.region !== 'sidebar'), ...sidebar]
}
export function evaluatePlacement(snapshot: WorkbenchSnapshot, registry: Registry, typeId: string, region: Region,
  operation: 'catalog' | 'move' | 'swap' | 'restore', ignored: readonly string[] = [], disabled: ReadonlySet<string> = new Set()) {
  const type = registry.get(typeId)
  if (!type || !type.constraint.regions.includes(region)) return { allowed: false, reason: 'incompatible' } as const
  if (disabled.has(type.owner)) return { allowed: false, reason: 'paused' } as const
  if (region !== 'sidebar' && type.presence === 'single-view' && snapshot.organization.views.some(view => view.typeId === typeId && (operation === 'catalog' || ignored.includes(view.id))
    && snapshot.placements.some(p => p.id === view.id && p.region === 'sidebar'))
    && snapshot.organization.bars.some(bar => bar.id !== snapshot.organization.activeBar && bar.members.includes(typeId))) return { allowed: false, reason: 'occupied' } as const
  const existing = snapshot.organization.views.filter(view => view.typeId === typeId && !ignored.includes(view.id))
  const occupied = snapshot.placements.filter(p => existing.some(view => view.id === p.id))
  if (region === 'sidebar' && operation === 'catalog') {
    const bar = snapshot.organization.bars.find(bar => bar.id === snapshot.organization.activeBar)!
    if (bar.members.includes(typeId)) return { allowed: false, reason: 'occupied' } as const
  } else if (occupied.some(p => p.region === region)) return { allowed: false, reason: 'occupied' } as const
  if (operation === 'catalog' && snapshot.organization.views.length >= POLICY.maxWidgets && !existing.some(view => type.presence === 'single-view' || !snapshot.placements.some(p => p.id === view.id))) return { allowed: false, reason: 'limit' } as const
  return { allowed: true, reason: null } as const
}
