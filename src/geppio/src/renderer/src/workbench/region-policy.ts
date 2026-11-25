export type RegionKind = 'sidebar' | 'bottom'
import { CHROME_LIMITS } from '../../../shared/workbench/chrome.ts'
export interface RegionBounds { min: number; max: number }

/** Approved V1.141 chrome; the rail is accounted for separately from content. */
export const REGION_POLICY = {
  splitter: 0, rail: 48, mainMinimum: 160, step: 10, shiftStep: 40, collapseDistance: 48,
  sidebar: CHROME_LIMITS.sidebar,
  bottom: CHROME_LIMITS.bottom
} as const

export function regionBounds(kind: RegionKind, measuredExtent: number): RegionBounds {
  const extent = Number.isFinite(measuredExtent) ? Math.max(0, measuredExtent) : 0, policy = REGION_POLICY[kind]
  const max = Math.max(0, Math.min(policy.max, kind === 'sidebar' ? extent - REGION_POLICY.rail - REGION_POLICY.mainMinimum : extent))
  return { min: Math.min(policy.min, max), max }
}

export function regionSize(requested: number, bounds: RegionBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Number.isFinite(requested) ? requested : bounds.min))
}
