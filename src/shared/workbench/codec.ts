import { parseGeometry } from '../freeform/schema.ts'
import { POLICY, constraintInRegion } from '../freeform/policy.ts'
import { REGIONS } from '../freeform/types.ts'
import { collides } from '../freeform/geometry.ts'
import { BAR_ICONS, HOME, LIMITS, activePlacements, constraintsForViews, modelId } from './model.ts'
import type { Composition, Organization, Registry, UserBar, View, WorkbenchSnapshot } from './model.ts'
import { defaultChrome, parseChrome } from './chrome.ts'
import type { WorkbenchChrome } from './chrome.ts'
import { parsePresentations, validatePresentationEdges } from './presentations.ts'
import type { Presentations } from './presentations.ts'
import { retireDemoViews } from './retirement.ts'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(value)
function list(value: unknown, cap: number): unknown[] {
  if (!Array.isArray(value) || value.length > cap) throw new Error('Invalid bounded list')
  return value
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error('Invalid name')
  return value
}
function unique<T>(items: T[], key: (item: T) => string) {
  if (new Set(items.map(key)).size !== items.length) throw new Error('Duplicate identity')
  return items
}
function strings(value: unknown, cap: number) {
  return unique(list(value, cap).map(item => { if (!identifier(item)) throw new Error('Invalid identity'); return item }), value => value)
}
function parseViews(value: unknown, registry: Registry): View[] {
  return unique(list(value, POLICY.maxWidgets).map(item => {
    if (!object(item) || !identifier(item.id) || typeof item.typeId !== 'string' || !registry.has(item.typeId)
      || item.modelId !== modelId(item.typeId)) throw new Error('Unknown widget owner/model/view')
    const type = registry.get(item.typeId)!
    if (type.owner !== 'host' && !item.id.startsWith(`${type.id}:view:`)) throw new Error('Unqualified plugin view')
    if (type.owner === 'host' && item.id !== type.fixture && !item.id.startsWith(`${type.id}:view:`)) throw new Error('Wrong host view identity')
    return { id: item.id, typeId: type.id, modelId: modelId(type.id) }
  }), view => view.id)
}
function parseBars(value: unknown, registry: Registry): UserBar[] {
  const bars = unique(list(value, LIMITS.savedBars + 1).map(item => {
    if (!object(item) || !identifier(item.id) || typeof item.archived !== 'boolean' || typeof item.userNamed !== 'boolean'
      || !BAR_ICONS.some(icon => icon === item.icon)) throw new Error('Invalid bar')
    const members = strings(item.members, POLICY.maxWidgets)
    if (members.some(id => !registry.get(id)?.constraint.regions.includes('sidebar'))) throw new Error('Invalid Sidebar membership')
    const positions: Record<string, number> = {}
    if (item.positions !== undefined) {
      if (!object(item.positions) || Object.keys(item.positions).length > POLICY.maxWidgets) throw new Error('Invalid bar geometry')
      for (const [typeId, y] of Object.entries(item.positions)) {
        if (!members.includes(typeId) || typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > POLICY.maxCoordinate) throw new Error('Invalid bar geometry')
        positions[typeId] = y
      }
    }
    return { id: item.id, name: name(item.name), userNamed: item.userNamed, icon: String(item.icon), archived: item.archived, members, positions }
  }), bar => bar.id)
  // Previously valid 15–20-custom-bar documents remain readable and editable.
  // The command boundary enforces the lower cap on new activations only.
  if (bars[0]?.id !== HOME || bars[0].archived || bars.filter(bar => !bar.archived && bar.id !== HOME).length > LIMITS.legacyActiveBars) throw new Error('Protected Home or bar cap')
  return bars
}
function parseDocument(value: unknown, views: View[], registry: Registry, bars?: UserBar[], presentations?: Presentations) {
  if (!object(value)) throw new Error('Invalid geometry')
  const constraints = constraintsForViews({ organization: { views } } as WorkbenchSnapshot, registry)
  // Active panels retain validated Normal seeds, but those seeds do not collide
  // with or constrain the reference height of the visible Normal scene.
  const panels = new Set(presentations?.entries.filter(e => e.presentation !== 'normal').map(e => e.viewId))
  if (!Array.isArray(value.placements)) throw new Error('Missing widget placements')
  const rawPlacements = value.placements
  const dormant = rawPlacements.filter(p => object(p) && p.region === 'main' && panels.has(String(p.id)))
  const ordinary = rawPlacements.filter(p => !dormant.includes(p))
  const layout = parseGeometry(JSON.stringify({ ...value, placements: ordinary }), constraints, undefined, (a, b) => !bars || a.region !== 'sidebar' || b.region !== 'sidebar')
  const seeds = dormant.flatMap(p => parseGeometry(JSON.stringify({ ...value, reference: { ...layout.reference,
    main: { ...layout.reference.main, height: POLICY.maxCoordinate } }, placements: [p] }), constraints).placements)
  if (ordinary.length + seeds.length > POLICY.maxWidgets || new Set([...layout.placements, ...seeds].map(p => p.id)).size !== rawPlacements.length) throw new Error('Duplicate panel identity')
  layout.placements = rawPlacements.map(p => [...layout.placements, ...seeds].find(q => object(p) && q.id === p.id)!)
  const used = new Set<string>()
  for (const placement of layout.placements) {
    const view = views.find(view => view.id === placement.id)!, type = registry.get(view.typeId)!
    const key = type.presence === 'single-view' ? type.id : `${type.id}:${placement.region}`
    if (used.has(key)) throw new Error('Occupied widget presence')
    used.add(key)
  }
  if (bars) for (const bar of bars) {
    if (bar.members.some(typeId => !views.some(view => view.typeId === typeId && layout.placements.some(p => p.id === view.id && p.region === 'sidebar')))) throw new Error('Missing Sidebar membership view')
    const sidebar = activePlacements({ ...layout, organization: { views, bars, activeBar: bar.id } } as WorkbenchSnapshot, false).filter(p => p.region === 'sidebar')
    if (sidebar.some((p, index) => p.y + p.height > POLICY.maxCoordinate || sidebar.slice(index + 1).some(q => collides(p, q)))) throw new Error('Invalid bar clearance')
  }
  return layout
}
export function parseWorkbench(raw: string, registry: Registry): WorkbenchSnapshot {
  if (raw.length > POLICY.maxBytes || new TextEncoder().encode(raw).length > POLICY.maxBytes) throw new Error('Workbench exceeds 64 KiB')
  const data: unknown = JSON.parse(raw)
  if (!object(data) || ![1, 2].includes(Number(data.schemaVersion)) || typeof data.schemaVersion !== 'number' || data.kind !== 'geppio-workbench' || !object(data.organization)) throw new Error('Unsupported workbench')
  const source = data.organization, views = parseViews(source.views, registry), bars = parseBars(source.bars, registry)
  const presentations = parsePresentations(source.presentations, views, registry)
  const layout = parseDocument(data.layout, views, registry, bars, presentations)
  if (typeof source.activeBar !== 'string' || !bars.some(bar => bar.id === source.activeBar && !bar.archived)) throw new Error('Invalid active bar')
  const compositions: Composition[] = unique(list(source.compositions, LIMITS.compositions).map(item => {
    if (!object(item) || !identifier(item.id) || !item.id.startsWith('composition:') || item.id.length <= 12 || item.system !== false || !['format', 'format-widgets'].includes(String(item.mode))) throw new Error('Invalid saved composition')
    const savedViews = parseViews(item.views, registry), scopes = strings(item.scopes, 3), chrome = item.chrome === undefined ? undefined : parseChrome(item.chrome, true)
    if ((!scopes.length && !chrome?.sidebar && !chrome?.bottom) || scopes.some(region => !['main', 'bottom'].includes(region))) throw new Error('Invalid composition scopes')
    const saved = parseDocument({ ...layout, reference: item.reference, placements: item.placements }, savedViews, registry)
    if (saved.placements.some(p => !scopes.includes(p.region))) throw new Error('Invalid scoped placement')
    const format = unique(list(item.format, POLICY.maxWidgets).map(slot => {
      if (!object(slot) || !identifier(slot.id) || !scopes.includes(String(slot.region))
        || !['x', 'y', 'width', 'height'].every(key => typeof slot[key] === 'number' && Number.isFinite(slot[key]))
        || Number(slot.x) < 0 || Number(slot.y) < 0 || Number(slot.width) <= 0 || Number(slot.height) <= 0
        || Number(slot.x) + Number(slot.width) > saved.reference[slot.region as typeof REGIONS[number]].width
        || Number(slot.y) + Number(slot.height) > saved.reference[slot.region as typeof REGIONS[number]].height) throw new Error('Invalid format geometry')
      return { id: slot.id, region: slot.region as Composition['scopes'][number], x: Number(slot.x), y: Number(slot.y), width: Number(slot.width), height: Number(slot.height) }
    }), slot => slot.id)
    if (format.some((slot, index) => format.slice(index + 1).some(other => slot.region === other.region && collides(slot, other)))) throw new Error('Overlapping format slots')
    if (item.mode === 'format' && (saved.placements.length || savedViews.length)) throw new Error('Format cannot restore executable widget references')
    return { id: item.id, name: name(item.name), system: false, scopes: scopes as Composition['scopes'],
      reference: saved.reference, placements: saved.placements, views: savedViews, mode: item.mode as Composition['mode'], format,
      ...(chrome ? { chrome } : {}) }
  }), item => item.id)
  const favorites = strings(source.favorites, LIMITS.favorites), known = (id: string) => ['system:default', 'system:focus', 'system:balanced'].includes(id) || compositions.some(item => item.id === id)
  if (favorites.some(id => !known(id)) || (source.defaultComposition !== null && (typeof source.defaultComposition !== 'string' || !favorites.includes(source.defaultComposition)))) throw new Error('Invalid favorite/default')
  const organization: Organization = { views, bars, activeBar: source.activeBar, compositions, favorites, defaultComposition: source.defaultComposition as string | null,
    chrome: source.chrome === undefined ? defaultChrome() : parseChrome(source.chrome) as WorkbenchChrome,
    presentations }
  if (source.compositionOrder !== undefined) {
    const order = strings(source.compositionOrder, LIMITS.compositions + 3)
    if (order.some(id => !known(id))) throw new Error('Invalid composition order')
    organization.compositionOrder = order
  }
  const result: WorkbenchSnapshot = { ...layout, organization }
  validatePresentationEdges(result)
  if (data.retiredDemos !== undefined) {
    const archive = data.retiredDemos
    if (!object(archive)) throw new Error('Invalid retired demo archive')
    const views = parseViews(archive.views, registry)
    const bars = parseBars(list(archive.bars, LIMITS.savedBars + 1).map(item => {
      if (!object(item)) throw new Error('Invalid retired bar')
      return { ...item, name: 'Retired demos', userNamed: false, icon: 'home', archived: item.id !== HOME }
    }), registry)
    if (views.some(view => !registry.get(view.typeId)?.fixture) || bars.some(bar => bar.members.some(id => !registry.get(id)?.fixture))) throw new Error('Invalid retired demo owner')
    const presentations = parsePresentations(archive.presentations, views, registry)
    const saved = parseDocument({ ...layout, reference: archive.reference, placements: archive.placements }, views, registry, bars, presentations)
    validatePresentationEdges({ ...saved, organization: { ...organization, views, bars, presentations } })
    result.retiredDemos = { reference: saved.reference, placements: saved.placements, views,
      bars: bars.map(({ id, members, positions }) => ({ id, members, positions })), presentations }
  }
  return retireDemoViews(result, registry)
}
export function serializeWorkbench(snapshot: WorkbenchSnapshot, registry: Registry) {
  // Persist only the typed document. Session slots/history/preview state never
  // become an accidental extension of the versioned storage envelope.
  const { organization, schemaVersion, engine, constraintVersion, reference, placements } = snapshot
  const source = { schemaVersion, engine, constraintVersion, reference, placements }
  const sidebarWidth = Math.max(source.reference.sidebar.width, ...source.placements.filter(p => p.region === 'sidebar').map(p => constraintInRegion(registry.get(organization.views.find(view => view.id === p.id)!.typeId)!.constraint, 'sidebar').min.width))
  const sidebarHeight = Math.max(source.reference.sidebar.height, ...source.placements.filter(p => p.region === 'sidebar').map(p => p.y + p.height))
  const layout = { ...source, reference: { ...source.reference, sidebar: { width: sidebarWidth, height: sidebarHeight } },
    placements: source.placements.map(p => p.region === 'sidebar' ? { ...p, width: sidebarWidth } : p) }
  const raw = JSON.stringify({ schemaVersion: 2, kind: 'geppio-workbench', layout, organization, ...(snapshot.retiredDemos ? { retiredDemos: snapshot.retiredDemos } : {}) })
  parseWorkbench(raw, registry)
  return raw
}
