import { groupFor } from './model.ts'
import type { Registry, WorkbenchSnapshot } from './model.ts'
import { presentationFor } from './presentations.ts'

/** A surface identity can later represent a host group. No geometry is stored here. */
export function maximizableSurface(source: WorkbenchSnapshot, registry: Registry, id: string) {
  const view = source.organization.views.find(view => view.id === id), placement = source.placements.find(p => p.id === id)
  const type = view && registry.get(view.typeId)
  const group = groupFor(source, id)
  if (group && (group.frameId !== id || group.members.some(member => !registry.get(source.organization.views.find(view => view.id === member)!.typeId)?.maximize))) return false
  return !!type?.maximize && placement?.region === 'main' && presentationFor(source, id, registry).presentation === 'normal'
}
