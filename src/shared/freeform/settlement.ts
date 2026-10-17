import type { Placement, Snapshot } from './types.ts'

/** Completed actions accept actual geometry as the next automatic size baseline.
 * Keep codecs compatible and storage bytes untouched until explicit Save. Shared
 * unchanged records retain identity; widget defaults remain in the registry.
 */
export function settlePlacements(placements: readonly Placement[]): Placement[] {
  return placements.map(p => p.preferred.width === p.width && p.preferred.height === p.height ? p
    : { ...p, preferred: { width: p.width, height: p.height } })
}
export function settleSnapshot(snapshot: Snapshot): Snapshot {
  const placements = settlePlacements(snapshot.placements)
  return placements.every((p, i) => p === snapshot.placements[i]) ? snapshot : { ...snapshot, placements }
}
