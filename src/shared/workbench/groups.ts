import { validLayout } from '../freeform/geometry.ts'
import { constraintInRegion, constraintsFor, POLICY } from '../freeform/policy.ts'
import { REGIONS } from '../freeform/types.ts'
import type { Region, Surface } from '../freeform/types.ts'
import { addWidget, moveFrame, reconcileBarHeights } from './commands.ts'
import { activePlacements, constraintsForViews, groupFor, groupConstraint, removeGroupedPresence, frameTypes } from './model.ts'
import type { Registry, View, WidgetGroup, WidgetGroups, WorkbenchSnapshot } from './model.ts'
import { presentationFor } from './presentations.ts'

/** Host/member declarations are independent of internal widget tabs and SDK v1/v2. */
export function groupPlan(source: WorkbenchSnapshot, registry: Registry, moving: string, target: string) {
  const origin = groupFor(source, moving), receiver = groupFor(source, target)
  const from = origin?.frameId ?? moving, frameId = receiver?.frameId ?? target
  if (from === frameId) return null
  const a = source.placements.find(p => p.id === from), b = source.placements.find(p => p.id === frameId)
  const host = source.organization.views.find(view => view.id === frameId)
  if (!a || !b || a.region !== b.region || !host || !registry.get(host.typeId)?.tabHost) return null
  const members = [...(receiver?.members ?? [frameId]), ...(origin?.members ?? [from])]
  const views = members.map(id => source.organization.views.find(view => view.id === id))
  if (views.some(view => !view || !registry.get(view.typeId)?.tabMember || presentationFor(source, view.id, registry).presentation !== 'normal') || new Set(views.map(view => view!.typeId)).size !== members.length) return null
  if (a.region === 'sidebar' && members.some(id => source.organization.bars.some(bar => bar.id !== source.organization.activeBar && bar.members.includes(source.organization.views.find(view => view.id === id)!.typeId)))) return null
  const constraint = constraintInRegion(groupConstraint(views as View[], registry), b.region)
  const fits = b.width >= constraint.min.width && b.height >= constraint.min.height && b.width <= constraint.max.width && b.height <= constraint.max.height
  return { origin, receiver, from, frameId, members, fits }
}
export function groupWidgets(source: WorkbenchSnapshot, registry: Registry, moving: string, target: string): WorkbenchSnapshot | null {
  const plan = groupPlan(source, registry, moving, target)
  if (!plan?.fits) return null
  const next = structuredClone(source)
  const entry: WidgetGroup = { id: plan.receiver?.id ?? plan.origin?.id ?? `group:${crypto.randomUUID()}`, frameId: plan.frameId, members: plan.members, active: plan.origin?.active ?? moving }
  next.organization.groups = { version: 1, entries: [...(next.organization.groups?.entries ?? []).filter(group => group.id !== plan.origin?.id && group.id !== plan.receiver?.id), entry] }
  next.placements = next.placements.filter(p => p.id !== plan.from)
  const packed = reconcileBarHeights(next)
  return packed && validGroupScene(packed, registry) ? packed : null
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
  const region = source.placements.find(p => p.id === group.frameId)!.region
  const next = removeGroupedPresence(source, id, registry)
  if (next === source) return null
  const view = next.organization.views.find(view => view.id === id)!
  const result = addWidget(next, registry, view.typeId, { ...source.reference[region], region, expanded: expanded && region === 'main' })
  return result && validGroupScene(result, registry) ? result : null
}
export function validGroupScene(source: WorkbenchSnapshot, registry: Registry) {
  const cs = constraintsForViews(source, registry)
  return REGIONS.every(region => (region === 'sidebar' ? source.organization.bars.map(bar => ({ ...source, organization: { ...source.organization, activeBar: bar.id } })) : [source]).every(scene => {
    const surface = { ...source.reference[region], region, expanded: region === 'main' }
    return validLayout(activePlacements(scene).filter(p => p.region === region), surface, constraintsFor(surface, cs))
  }))
}
/** This plan is also the renderer's preview. It contains identities, never a
 * second geometry model or a permission transfer. */
export function groupTransferPlan(source: WorkbenchSnapshot, registry: Registry, id: string, destination: Region) {
  const group = groupFor(source, id), placement = source.placements.find(p => p.id === group?.frameId)
  if (!group || !placement || group.frameId !== id) return null
  const type = (member: string) => registry.get(source.organization.views.find(view => view.id === member)!.typeId)!
  const going = group.members.filter(member => type(member).constraint.regions.includes(destination)), staying = group.members.filter(member => !going.includes(member))
  const carrier = (members: string[]) => members.includes(group.frameId) && (members.length === 1 || type(group.frameId).tabHost) ? group.frameId : members.find(member => members.length === 1 || type(member).tabHost)
  const destinationFrame = carrier(going), sourceFrame = carrier(staying)
  const legal = (members: string[]) => members.length < 2 || members.every(member => type(member).tabMember) && !!carrier(members)
  const sharedBar = placement.region === 'sidebar' && group.members.some(member => source.organization.bars.filter(bar => bar.members.includes(type(member).id)).length !== 1)
  const reason = !going.length ? 'Nenhuma aba é compatível com o destino.' : !legal(going) || !legal(staying) ? 'Uma das partes não tem host compatível.' : sharedBar ? 'O grupo está associado a outra barra lateral.' : null
  return { group, placement, going, staying, destinationFrame, sourceFrame, allowed: !reason, reason }
}
/** Build both partitions first, then place exactly one bounded destination frame
 * through the existing command. Any failure discards this private snapshot. */
export function transferGroup(source: WorkbenchSnapshot, registry: Registry, id: string, target: Surface, at?: { x: number; y: number }, sourceBar = source.organization.activeBar, disabled: ReadonlySet<string> = new Set()): WorkbenchSnapshot | null {
  const plan = groupTransferPlan(source, registry, id, target.region)
  if (!plan?.allowed || !plan.destinationFrame || plan.going.some(member => disabled.has(registry.get(source.organization.views.find(view => view.id === member)!.typeId)!.owner))) return null
  const next = structuredClone(source), original = plan.placement
  const entries = next.organization.groups!.entries.filter(group => group.id !== plan.group.id)
  const partition = (members: string[], frameId: string, groupId: string) => {
    if (members.length >= 2) entries.push({ id: groupId, frameId, members: [...members], active: members.includes(plan.group.active) ? plan.group.active : members[0]! })
    return { ...original, id: frameId, preferred: { ...original.preferred } }
  }
  next.placements = next.placements.filter(p => p.id !== id)
  if (plan.staying.length && plan.sourceFrame) next.placements.push(partition(plan.staying, plan.sourceFrame, plan.group.id))
  next.placements.push(partition(plan.going, plan.destinationFrame, plan.staying.length >= 2 ? `group:${crypto.randomUUID()}` : plan.group.id))
  next.organization.groups = { version: 1, entries }
  if (original.region === 'sidebar') {
    const origin = next.organization.bars.find(bar => bar.id === sourceBar)
    if (!origin || !frameTypes(source, id).every(type => origin.members.includes(type))) return null
    const types = new Set(frameTypes(source, id)), oldType = source.organization.views.find(view => view.id === id)!.typeId
    const y = origin.positions?.[oldType] ?? original.y
    origin.members = origin.members.filter(type => !types.has(type)); origin.positions ??= {}
    for (const type of types) delete origin.positions[type]
    if (plan.sourceFrame) { origin.members.push(...plan.staying.map(member => source.organization.views.find(view => view.id === member)!.typeId)); origin.positions[source.organization.views.find(view => view.id === plan.sourceFrame)!.typeId] = y }
  }
  const result = moveFrame(next, registry, plan.destinationFrame, target, at, sourceBar, undefined, disabled)
  if (!result || !validGroupScene(result, registry)) return null
  try { validateGroups(result, registry) } catch { return null }
  return result
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
    if (!frame) throw new Error('Missing group frame')
    if (frame.region === 'sidebar') {
      const types = frameTypes(source, group.frameId), bars = source.organization.bars ?? []
      const owners = bars.filter(bar => types.every(type => bar.members.includes(type)))
      if (owners.length !== 1 || types.some(type => bars.filter(bar => bar.members.includes(type)).length !== 1)) throw new Error('Invalid group bar ownership')
    }
    for (const id of group.members) {
      const view = source.organization.views.find(view => view.id === id)!
      if (!registry.get(view.typeId)!.constraint.regions.includes(frame.region) || presentationFor(source, id, registry).presentation !== 'normal' || (id !== group.frameId && (source.placements.some(p => p.id === id) || occupied.has(view.typeId)))) throw new Error('Conflicting grouped presence')
      occupied.add(view.typeId)
    }
  }
}
