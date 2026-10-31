import { useRef } from 'react'
import type { Region } from '../../../shared/freeform/types.ts'
import type { Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import type { Interaction } from '../freeform/useInteraction.ts'

/** UI destinations use the same real command feasibility as drag/drop. Cache
 * bounded host data, never DOM measurements; don't repeat solver probes on every
 * held-pointer frame. A bar/runtime/surface change still refreshes eligibility. */
export function useCatalogAvailability(view: WorkbenchSnapshot, registry: Registry, disabled: ReadonlySet<string>, interaction: Interaction, visible: boolean) {
  const cache = useRef<{ geometry: string; policy: string; registry: Registry; result: Map<string, Region[]> } | null>(null)
  const bar = view.organization.bars.find(bar => bar.id === view.organization.activeBar)!
  const policy = JSON.stringify([bar.id, bar.members, [...disabled], interaction.catalogSurfaceKey])
  const geometry = JSON.stringify([view.reference, view.placements, view.organization.views, bar.positions])
  if (visible && (!cache.current || cache.current.registry !== registry || cache.current.policy !== policy || (!interaction.active() && cache.current.geometry !== geometry))) {
    cache.current = { geometry, policy, registry, result: new Map([...registry.values()].map(type => [type.id, type.constraint.regions.filter(region => interaction.canCatalogPlace(type.id, region))])) }
  }
  return cache.current?.result
}
