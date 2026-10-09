export type RegionKind = 'sidebar' | 'bottom'
export interface RegionBounds { min: number; max: number }

/** Trial CSS-pixel policy (Issue #26), pending owner visual acceptance. */
export const REGION_POLICY = {
  splitter: 5, mainMinimum: 160, step: 10, shiftStep: 30,
  sidebar: { initial: 215, min: 160, max: 300, fraction: .2 },
  bottom: { initial: 43, min: 43, max: 180, fraction: .25 }
} as const

export function regionBounds(kind: RegionKind, measuredExtent: number): RegionBounds {
  const extent = Number.isFinite(measuredExtent) ? Math.max(0, measuredExtent) : 0, policy = REGION_POLICY[kind]
  const max = Math.max(0, Math.min(policy.max, extent * policy.fraction, extent - REGION_POLICY.mainMinimum - REGION_POLICY.splitter))
  return { min: Math.min(policy.min, max), max }
}

export function regionSize(requested: number, bounds: RegionBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(requested) ? requested : bounds.min))
}
