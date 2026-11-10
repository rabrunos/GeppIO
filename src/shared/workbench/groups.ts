import { validLayout } from '../freeform/geometry.ts'
import { constraintsFor, POLICY } from '../freeform/policy.ts'
import { addWidget } from './commands.ts'
import { constraintsForViews, groupFor, groupConstraint } from './model.ts'
import type { Registry, View, WidgetGroup, WidgetGroups, WorkbenchSnapshot } from './model.ts'
import { presentationFor } from './presentations.ts'

/** Host/member declarations are independent of internal widget tabs and SDK v1/v2. */
export function groupPlan(source: WorkbenchSnapshot, registry: Registry, moving: string, target: string) {
  const origin = groupFor(source, moving), receiver = groupFor(source, target)
  const from = origin?.frameId ?? moving, frameId = receiver?.frameId ?? target
  if (from === frameId) return null
  const a = source.placements.find(p => p.id === from), b = source.placements.find(p => p.id === frameId)
  const host = source.organization.views.find(view => view.id === frameId)
  if (!a || !b || a.region !== 'main' || b.region !== 'main' || !host || !registry.get(host.typeId)?.tabHost) return null
  const members = [...(receiver?.members ?? [frameId]), ...(origin?.members ?? [from])]
  const views = members.map(id => source.organization.views.find(view => view.id === id))
  if (views.some(view => !view || !registry.get(view.typeId)?.tabMember || presentationFor(source, view.id, registry).presentation !== 'normal') || new Set(views.map(view => view!.typeId)).size !== members.length) return null
  const constraint = groupConstraint(views as View[], registry)
  const fits = b.width >= constraint.min.width && b.height >= constraint.min.height && b.width <= constraint.max.width && b.height <= constraint.max.height
  return { origin, receiver, from, frameId, members, fits }
}
export function groupWidgets(source: WorkbenchSnapshot, registry: Registry, moving: string, target: string): WorkbenchSnapshot | null {
  const plan = groupPlan(source, registry, moving, target)
  if (!plan?.fits) return null
  const next = structuredClone(source)
  const entry: WidgetGroup = { id: plan.receiver?.id ?? plan.origin?.id ?? `group:${crypto.randomUUID()}`, frameId: plan.frameId, members: plan.members, active: moving }
  next.organization.groups = { version: 1, entries: [...(next.organization.groups?.entries ?? []).filter(group => group.id !== plan.origin?.id && group.id !== plan.receiver?.id), entry] }
  next.placements = next.placements.filter(p => p.id !== plan.from)
  return validGroupScene(next, registry) ? next : null
}
export function reorderGroup(source: WorkbenchSnapshot, groupId: string, member: string, delta: -1 | 1) {
  const next = structuredClone(source), group = next.organization.groups?.entries.find(group => group.id === groupId)
  if (!group) return null
  const index = group.members.indexOf(member), to = index + delta
  if (index < 0 || to < 0 || to >= group.members.length) return null
  group.members.splice(index, 1); group.members.splice(to, 0, member); return next
}
export function detachWidget(source: WorkbenchSnapshot, registry: Registry, id: string, expanded = false) {
  const group = groupFor(source, id); if (!group) return null
  const next = structuredClone(source), members = group.members.filter(member => member !== id), frameId = group.frameId === id ? members[0]! : group.frameId
  next.organization.groups = { version: 1, entries: next.organization.groups!.entries.flatMap(item => item.id !== group.id ? [item] : members.length < 2 ? [] : [{ ...item, frameId, members, active: members.includes(item.active) ? item.active : members[0]! }]) }
  next.placements = next.placements.map(p => p.id === group.frameId ? { ...p, id: frameId } : p)
  const view = next.organization.views.find(view => view.id === id)!
  const result = addWidget(next, registry, view.typeId, { ...source.reference.main, region: 'main', expanded })
  return result && validGroupScene(result, registry) ? result : null
}
export function validGroupScene(source: WorkbenchSnapshot, registry: Registry) {
  return validLayout(source.placements.filter(p => p.region === 'main'), { ...source.reference.main, region: 'main', expanded: true }, constraintsFor({ ...source.reference.main, region: 'main', expanded: true }, constraintsForViews(source, registry)))
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key))
export function parseGroups(value: unknown, views: readonly View[], registry: Registry): WidgetGroups | undefined {
  if (value === undefined) return undefined
  if (!object(value) || !exact(value, ['version', 'entries']) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > POLICY.maxWidgets) throw new Error('Unsupported tab groups')
  const ids = new Set<string>(), used = new Set<string>()
  const entries = value.entries.map(item => {
    if (!object(item) || !exact(item, ['id', 'frameId', 'members', 'active']) || typeof item.id !== 'string' || !/^group:[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id) || !Array.isArray(item.members) || item.members.length < 2 || item.members.length > POLICY.maxWidgets || typeof item.frameId !== 'string' || typeof item.active !== 'string' || !item.members.includes(item.frameId) || !item.members.includes(item.active)) throw new Error('Invalid tab group')
    ids.add(item.id)
    const members = item.members.map(id => { const view = views.find(view => view.id === id); if (typeof id !== 'string' || used.has(id) || !view || !registry.get(view.typeId)?.tabMember) throw new Error('Invalid tab membership'); used.add(id); return id })
    if (!registry.get(views.find(view => view.id === item.frameId)!.typeId)?.tabHost) throw new Error('Ineligible tab host')
    return { id: item.id, frameId: item.frameId, members, active: item.active }
  })
  return { version: 1, entries }
}
export function validateGroups(source: WorkbenchSnapshot, registry: Registry) {
  const groups = source.organization.groups?.entries ?? [], occupied = new Set<string>()
  for (const p of source.placements) occupied.add(source.organization.views.find(view => view.id === p.id)!.typeId)
  for (const group of groups) {
    const frame = source.placements.find(p => p.id === group.frameId)
    if (!frame || frame.region !== 'main') throw new Error('Missing Main group frame')
    for (const id of group.members) {
      const view = source.organization.views.find(view => view.id === id)!
      if (presentationFor(source, id, registry).presentation !== 'normal' || (id !== group.frameId && (source.placements.some(p => p.id === id) || occupied.has(view.typeId)))) throw new Error('Conflicting grouped presence')
      occupied.add(view.typeId)
    }
  }
}
