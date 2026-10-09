import { GRID_POLICY, RESPONSIVE_POLICY } from './policy.ts'
import type { GridBounds } from './types.ts'

/** Resolve both axes from the final feasible pitch, never from a superseded reference pitch. */
export function projectionTopology(width: number, height: number, gutter: number, requestedPitch: number, minimum: GridBounds) {
  const w = width + gutter, h = height + gutter
  const widthLimit = w / minimum.columns, heightLimit = h / minimum.rows
  const feasiblePitch = Math.min(requestedPitch, widthLimit, heightLimit)
  const capacity = (widthLimit <= heightLimit ? h : w) / feasiblePitch
  const maximum = widthLimit <= heightLimit ? GRID_POLICY.maxRows : GRID_POLICY.maxColumns
  const units = Math.floor(capacity + 1e-9), fraction = Math.max(0, capacity - units)
  // A hard ceil would improve coverage but jump density at every integer boundary. Approach the
  // next cell continuously, completing near the end of its band, then grow with that cell count.
  // Fade in over one missing unit at constraint activation to avoid a second density discontinuity.
  const pressure = Math.min(1, Math.max(0, minimum.columns - w / requestedPitch, minimum.rows - h / requestedPitch))
  const phase = RESPONSIVE_POLICY.coveragePhase
  const reduction = units < maximum && fraction > 0
    ? Math.min(fraction * (1 - phase) / phase, 1 - fraction) / (units + 1) : 0
  const pitch = feasiblePitch * (1 - pressure * reduction)
  return { columns: Math.max(minimum.columns, Math.min(GRID_POLICY.maxColumns, Math.floor(w / pitch + 1e-9))),
    rows: Math.max(minimum.rows, Math.min(GRID_POLICY.maxRows, Math.floor(h / pitch + 1e-9))), pitch }
}
