import type { Registry, WorkbenchSnapshot } from './model.ts'
import { presentationFor } from './presentations.ts'

/** A surface identity can later represent a host group. No geometry is stored here. */
export function maximizableSurface(source: WorkbenchSnapshot, registry: Registry, id: string) {
  const view = source.organization.views.find(view => view.id === id), placement = source.placements.find(p => p.id === id)
  const type = view && registry.get(view.typeId)
  return !!type?.maximize && placement?.region === 'main' && presentationFor(source, id, registry).presentation === 'normal'
}
