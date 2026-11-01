import { POLICY } from '../freeform/policy.ts'
import { collides } from '../freeform/geometry.ts'
import type { Placement, Region, Size } from '../freeform/types.ts'
import { initialWorkbench, LIMITS } from './model.ts'
import type { Composition, FormatSlot, Registry, SessionSlot, WorkbenchSnapshot } from './model.ts'
import { fitTargets } from './commands.ts'
import { applyChrome } from './chrome.ts'
import type { ChromePatch } from './chrome.ts'

export function systemCompositions(): Composition[] {
  const initial = initialWorkbench()
  return [['default', 'Padrão'], ['focus', 'Foco'], ['balanced', 'Equilibrado']].map(([id, name]) => {
    const focus = id === 'focus', ids = focus ? ['summary', 'queue'] : ['summary', 'chart'], width = initial.reference.main.width, height = initial.reference.main.height
    const format: FormatSlot[] = ids.map((widget, i) => ({ id: `format:${id}:${i}`, region: widget === 'chart' ? 'bottom' : 'main', x: focus ? i * (width + POLICY.gap) / 2 : 0, y: 0,
      width: widget === 'chart' ? initial.reference.bottom.width : focus ? (width - POLICY.gap) / 2 : width, height: widget === 'chart' ? initial.reference.bottom.height : height }))
    const placements = ids.map((widget, i) => { const slot = format[i]!; return { id: widget, region: slot.region, x: slot.x, y: slot.y, width: slot.width, height: slot.height, preferred: { width: slot.width, height: slot.height } } })
    return { id: `system:${id}`, name: name!, system: true, scopes: (focus ? ['main'] : ['main', 'bottom']) as Region[], reference: initial.reference,
      views: initial.organization.views.filter(view => ids.includes(view.id)), placements, mode: 'format-widgets' as const, format,
      chrome: { sidebar: { visible: !focus, size: id === 'balanced' ? 238 : 283 }, bottom: { visible: !focus, size: id === 'balanced' ? 200 : 167 } } }
  })
}
export function captureComposition(snapshot: WorkbenchSnapshot, name: string, mode: Composition['mode'], scopes: Region[], chrome?: ChromePatch, slots: readonly SessionSlot[] = []): Composition {
  const placements = snapshot.placements.filter(p => scopes.includes(p.region))
  const format = [...placements, ...slots.filter(slot => scopes.includes(slot.region) && (!slot.sidebarBar || slot.sidebarBar === snapshot.organization.activeBar)).map(slot => projectSessionSlot(slot, snapshot.reference[slot.region]))]
  return { id: `composition:${crypto.randomUUID()}`, name, system: false, scopes, reference: structuredClone(snapshot.reference), mode,
    placements: mode === 'format-widgets' ? structuredClone(placements) : [],
    views: mode === 'format-widgets' ? snapshot.organization.views.filter(view => placements.some(p => p.id === view.id)) : [],
    format: format.map((p, i) => ({ id: `format:${i}`, region: p.region, x: p.x, y: p.y, width: p.width, height: p.height })), ...(chrome ? { chrome } : {}) }
}
export function favoriteComposition(source: WorkbenchSnapshot, id: string, favorite: boolean, makeDefault = false, replace?: string): WorkbenchSnapshot | null {
  const next = structuredClone(source), organization = next.organization
  if (!systemCompositions().some(item => item.id === id) && !organization.compositions.some(item => item.id === id)) return null
  if (!favorite) {
    organization.favorites = organization.favorites.filter(item => item !== id)
    if (organization.defaultComposition === id) organization.defaultComposition = null
  } else if (!organization.favorites.includes(id)) {
    if (organization.favorites.length >= LIMITS.favorites) {
      const index = replace ? organization.favorites.indexOf(replace) : -1
      if (index < 0) return null
      organization.favorites.splice(index, 1)
      if (organization.defaultComposition === replace) organization.defaultComposition = null
    }
    organization.favorites.push(id)
  }
  if (makeDefault) { if (!favorite) return null; organization.defaultComposition = id }
  return next
}
export function compositionOrder(snapshot: WorkbenchSnapshot, favorites = false) {
  if (favorites) return [...snapshot.organization.favorites]
  const known = [...systemCompositions().map(item => item.id), ...snapshot.organization.compositions.map(item => item.id)]
  return [...(snapshot.organization.compositionOrder ?? []), ...known.filter(id => !snapshot.organization.compositionOrder?.includes(id))]
}
export function reorderComposition(source: WorkbenchSnapshot, id: string, before: string | null, favorites = false): WorkbenchSnapshot | null {
  const order = compositionOrder(source, favorites)
  if (!order.includes(id) || before === id || (before !== null && !order.includes(before))) return null
  const next = order.filter(value => value !== id); next.splice(before === null ? next.length : next.indexOf(before), 0, id)
  if (next.every((value, index) => value === order[index])) return null
  return { ...source, organization: { ...source.organization, [favorites ? 'favorites' : 'compositionOrder']: next } }
}
export function applyComposition(source: WorkbenchSnapshot, registry: Registry, composition: Composition, mode: 'format' | 'widgets') {
  const next = structuredClone(source)
  if (composition.chrome) next.organization.chrome = applyChrome(next.organization.chrome, composition.chrome)
  if (mode === 'widgets') {
    if (composition.mode !== 'format-widgets') return null
    for (const view of composition.views) {
      if (!registry.has(view.typeId)) return null
      const existing = next.organization.views.find(item => item.id === view.id)
      if (existing && existing.typeId !== view.typeId) return null
      if (!existing) next.organization.views.push(structuredClone(view))
    }
    const affected = new Set(composition.placements.map(p => p.id))
    if (next.placements.some(p => affected.has(p.id) && !composition.scopes.includes(p.region))) return null
    return fitTargets(next, registry, composition.placements, composition.reference, composition.scopes)
  }
  const targets: Placement[] = []
  for (const region of composition.scopes) {
    const widgets = source.placements.filter(p => p.region === region), cells = composition.format.filter(slot => slot.region === region)
    if (widgets.length && !cells.length) return null
    const buckets = cells.map(() => [] as Placement[])
    widgets.forEach((widget, index) => buckets[index % buckets.length]!.push(widget))
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!, occupants = buckets[i]!
      for (let j = 0; j < occupants.length; j++) {
        const p = occupants[j]!, height = (cell.height - POLICY.gap * (occupants.length - 1)) / occupants.length
        targets.push({ ...p, x: cell.x, y: cell.y + j * (height + POLICY.gap), width: cell.width, height,
          preferred: { width: cell.width, height } })
      }
    }
  }
  return fitTargets(next, registry, targets, composition.reference, composition.scopes)
}
export function projectSessionSlot(slot: SessionSlot, to: Size): SessionSlot {
  const from = slot.reference
  return { ...slot, x: slot.x / from.width * to.width, y: slot.y / from.height * to.height, width: slot.width / from.width * to.width, height: slot.height / from.height * to.height, reference: { ...to } }
}
export function compositionSlots(composition: Composition, snapshot: WorkbenchSnapshot): SessionSlot[] {
  return composition.format.map(slot => {
    const from = composition.reference[slot.region], to = snapshot.reference[slot.region]
    return { ...slot, ...(slot.region === 'sidebar' ? { sidebarBar: snapshot.organization.activeBar } : {}), id: `session:${composition.id}:${slot.id}`, x: slot.x / from.width * to.width, y: slot.y / from.height * to.height,
      width: slot.width / from.width * to.width, height: slot.height / from.height * to.height, reference: { ...to } }
  }).filter(slot => !snapshot.placements.some(p => p.region === slot.region && collides(p, slot)))
}
