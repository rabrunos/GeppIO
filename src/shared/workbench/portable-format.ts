import { collides, EPSILON } from '../freeform/geometry.ts'
import { POLICY } from '../freeform/policy.ts'
import type { Rect, Size } from '../freeform/types.ts'
import { FILE_EDITOR_TYPE, EXPLORER_TYPE } from '../files-editor.ts'
import { TERMINAL_TYPE } from '../terminal-widget.ts'
import { GIT_TYPE } from '../git-widget.ts'
import { pluginId } from '../plugin-id.ts'
import { assertUniqueJsonKeys } from '../json-keys.ts'
import { CHROME_LIMITS } from './chrome.ts'

const official = [FILE_EDITOR_TYPE, EXPLORER_TYPE, TERMINAL_TYPE, GIT_TYPE] as const
type Official = typeof official[number]
type Region = 'main' | 'bottom'
export type PortableRef = { host: Official } | { pluginId: string; widgetId: string }
export interface PortableLayout {
  kind: 'geppio-layout'; version: 1; name: string; mode: 'format' | 'format-widgets'; scopes: Region[]
  reference: Partial<Record<Region, Size>>; chrome: { sidebar?: { size: number }; bottom?: { size: number } }
  format: (Rect & { key: string; region: Region })[]
  views: { key: string; ref: PortableRef }[]
  placements: (Rect & { view: string; region: Region; preferred: Size })[]
  groups: { frame: string; members: string[]; active: string }[]
}
export type PortableCompositionV1 = PortableLayout
const invalid = (): never => { throw new Error('Arquivo de composição inválido ou incompatível.') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function shape(value: unknown, fields: string[], required = fields) {
  const obj = record(value)
  if (Object.keys(obj).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(obj, key))) return invalid()
  return obj
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > POLICY.maxWidgets) return invalid()
  return value
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid()
  return value
}
function size(value: Record<string, unknown>, max: number) {
  return { width: number(value.width, Number.MIN_VALUE, max), height: number(value.height, Number.MIN_VALUE, max) }
}
export function portableName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\p{Cc}\ud800-\udfff]/u.test(value)) return invalid()
  return value
}
function ref(value: unknown): PortableRef {
  const obj = record(value)
  if (Object.hasOwn(obj, 'host')) {
    shape(obj, ['host'])
    if (!official.includes(obj.host as Official)) return invalid()
    return { host: obj.host as Official }
  }
  shape(obj, ['pluginId', 'widgetId'])
  if (!pluginId(obj.pluginId) || !pluginId(obj.widgetId)) return invalid()
  return { pluginId: obj.pluginId, widgetId: obj.widgetId }
}
export const portableType = (ref: PortableRef) => 'host' in ref ? ref.host : `plugin:${ref.pluginId}:${ref.widgetId}`
const distinct = (values: readonly unknown[]) => { if (new Set(values).size !== values.length) invalid() }
function region(value: unknown): Region { return value === 'main' || value === 'bottom' ? value : invalid() }
function clearance(cells: (Rect & { region: Region })[]) {
  if (cells.some((cell, i) => cells.slice(i + 1).some(other => other.region === cell.region && collides(cell, other)))) invalid()
}
export function parsePortableLayout(value: unknown): PortableLayout {
  const obj = shape(value, ['kind', 'version', 'name', 'mode', 'scopes', 'reference', 'chrome', 'format', 'views', 'placements', 'groups'])
  if (obj.kind !== 'geppio-layout' || obj.version !== 1 || obj.mode !== 'format' && obj.mode !== 'format-widgets') return invalid()
  const scopes = list(obj.scopes).map(region); distinct(scopes)
  const reference: PortableLayout['reference'] = {}
  const dimensions = shape(obj.reference, scopes)
  for (const scope of scopes) reference[scope] = size(shape(dimensions[scope], ['width', 'height']), POLICY.maxCoordinate)
  const chrome: PortableLayout['chrome'] = {}, sizes = shape(obj.chrome, ['sidebar', 'bottom'], [])
  for (const part of ['sidebar', 'bottom'] as const) if (Object.hasOwn(sizes, part)) {
    if (part === 'bottom' && !scopes.includes(part)) return invalid()
    chrome[part] = { size: number(shape(sizes[part], ['size']).size, CHROME_LIMITS[part].min, CHROME_LIMITS[part].max) }
  }
  if (!scopes.length && !chrome.sidebar) return invalid()
  const rect = (item: Record<string, unknown>, kind: 'slot' | 'placement') => {
    const area = region(item.region), bounds = reference[area]
    if (!bounds) return invalid()
    const slot = kind === 'slot', dimensions = size(item, slot ? POLICY.maxCoordinate : POLICY.maxSize)
    const x = number(item.x, 0, POLICY.maxCoordinate), y = number(item.y, 0, POLICY.maxCoordinate)
    const maxX = !slot && area === 'main' ? POLICY.maxCoordinate : bounds.width
    if (x + dimensions.width > maxX || y + dimensions.height > bounds.height + (slot ? 0 : EPSILON)) return invalid()
    return { region: area, x, y, ...dimensions }
  }
  const fields = ['region', 'x', 'y', 'width', 'height']
  const format = list(obj.format).map((value, i) => {
    const item = shape(value, [...fields, 'key']), key = 's' + (i + 1)
    if (item.key !== key) return invalid()
    return { key, ...rect(item, 'slot') }
  })
  const views = list(obj.views).map((value, i) => {
    const item = shape(value, ['key', 'ref']), key = 'v' + (i + 1)
    if (item.key !== key) return invalid()
    return { key, ref: ref(item.ref) }
  })
  const types = new Map(views.map(view => [view.key, portableType(view.ref)]))
  const viewKey = (value: unknown): string => typeof value === 'string' && types.has(value) ? value : invalid()
  const placements = list(obj.placements).map(value => {
    const item = shape(value, [...fields, 'view', 'preferred']), box = rect(item, 'placement')
    if (box.region === 'bottom' && (box.y !== 0 || box.height !== reference.bottom!.height)) return invalid()
    return { view: viewKey(item.view), ...box, preferred: size(shape(item.preferred, ['width', 'height']), POLICY.maxSize) }
  })
  distinct(placements.map(p => p.view))
  distinct(placements.map(p => p.region + ':' + types.get(p.view)))
  clearance(placements); clearance(format)
  const members = new Set<string>(), placed = new Set(placements.map(p => p.view))
  const groups = list(obj.groups).map(value => {
    const item = shape(value, ['frame', 'members', 'active']), frame = viewKey(item.frame), active = viewKey(item.active)
    const order = list(item.members).map(viewKey)
    if (order.length < 2 || !order.includes(active) || !order.includes(frame) || !placed.has(frame)) return invalid()
    for (const key of order) {
      if (members.has(key) || key !== frame && (placed.has(key) || views.some(other => other.key !== key && types.get(other.key) === types.get(key)))) return invalid()
      members.add(key)
    }
    return { frame, members: order, active }
  })
  if (views.some(view => !placed.has(view.key) && !members.has(view.key)) || obj.mode === 'format' && views.length) return invalid()
  const recipe: PortableLayout = { kind: 'geppio-layout', version: 1, name: portableName(obj.name), mode: obj.mode, scopes, reference, chrome, format, views, placements, groups }
  if (new TextEncoder().encode(JSON.stringify(recipe)).byteLength > POLICY.maxBytes) return invalid()
  return recipe
}
export function parsePortableText(text: string): PortableLayout {
  if (typeof text !== 'string' || text.length > POLICY.maxBytes || new TextEncoder().encode(text).byteLength > POLICY.maxBytes) return invalid()
  let value: unknown
  try { value = JSON.parse(text) } catch { return invalid() }
  assertUniqueJsonKeys(text)
  return parsePortableLayout(value)
}
export const serializePortableLayout = (value: unknown): string => JSON.stringify(parsePortableLayout(value))
