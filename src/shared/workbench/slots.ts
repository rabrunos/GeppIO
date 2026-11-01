import type { Surface } from '../freeform/types.ts'
import { addWidget, moveView } from './commands.ts'
import { projectSessionSlot } from './compositions.ts'
import type { Registry, SessionSlot, WorkbenchSnapshot } from './model.ts'

export type SlotIntention = { kind: 'catalog'; typeId: string } | { kind: 'move'; viewId: string; sourceBar: string }

/** Resolve current session identity and projected geometry for both click and drop. */
export function fillReservation(source: WorkbenchSnapshot, registry: Registry, slots: readonly SessionSlot[], id: string,
  surface: Surface, intention: SlotIntention, disabled?: ReadonlySet<string>) {
  const stored = slots.find(slot => slot.id === id && slot.region === surface.region)
  if (!stored || (stored.sidebarBar && stored.sidebarBar !== source.organization.activeBar)) return null
  if (intention.kind === 'move') {
    const view = source.organization.views.find(view => view.id === intention.viewId), placement = source.placements.find(p => p.id === intention.viewId)
    if (!view || !placement || (placement.region === 'sidebar' && !source.organization.bars.some(bar => bar.id === intention.sourceBar && bar.members.includes(view.typeId)))) return null
  }
  const slot = projectSessionSlot(stored, surface)
  const size = { width: slot.width, height: slot.height }
  const next = intention.kind === 'catalog'
    ? addWidget(source, registry, intention.typeId, surface, slot, disabled, size)
    : moveView(source, registry, intention.viewId, surface, slot, intention.sourceBar, size, disabled)
  return next ? { snapshot: next, slots: slots.filter(other => other.id !== id) } : null
}
