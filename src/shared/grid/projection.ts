import { fitGrid } from './geometry.ts'
import type { GridMetrics } from './geometry.ts'
import { validLayout } from './occupancy.ts'
import { constraintsFor, GRID_POLICY, RESPONSIVE_POLICY } from './policy.ts'
import { projectionAxis } from './projection-axis.ts'
import type { GridSnapshot } from './types.ts'

export interface GridProjection { snapshot: GridSnapshot; metrics: GridMetrics; warning: string | null; probes: number }
export interface GridViewport { width: number; height: number; pitch: number }

/** Source-derived composition, continuous density and coherent edge quantization. No free-slot packing. */
export function projectGrid(source: GridSnapshot, width: number, height: number, editViewport?: GridViewport | null): GridProjection {
  if (![width, height].every(Number.isFinite) || width < 0 || height < 0) throw new Error('Invalid viewport')
  if (!validLayout(source.placements, source, constraintsFor(source)) || source.placements.length > GRID_POLICY.maxWidgets
    || source.placements.some(p => ![p.preferred.w, p.preferred.h].every(Number.isInteger)
      || p.preferred.w < 3 || p.preferred.h < 2 || p.preferred.w > source.columns || p.preferred.h > source.rows)) throw new Error('Invalid projection source')
  if (width === 0 || height === 0) return { snapshot: structuredClone(source), metrics: fitGrid(width, height, source), warning: null, probes: 0 }
  const gutter = Math.min(GRID_POLICY.gutter, width / (2 * GRID_POLICY.maxColumns), height / (2 * GRID_POLICY.maxRows))
  // One continuous reference density; integer topology changes cannot change this pixel pitch.
  const pitch = Math.max(Math.sqrt((width + gutter) * (height + gutter) / RESPONSIVE_POLICY.referenceArea),
    (width + gutter) / GRID_POLICY.maxColumns, (height + gutter) / GRID_POLICY.maxRows)
  if (editViewport && (![editViewport.width, editViewport.height, editViewport.pitch].every(Number.isFinite)
    || editViewport.width < 0 || editViewport.height < 0 || editViewport.pitch < 0)) throw new Error('Invalid edit viewport')
  const reference = editViewport && editViewport.width > 0 && editViewport.height > 0 && editViewport.pitch > 0 ? editViewport : null
  const referenceGutter = reference ? Math.min(GRID_POLICY.gutter, reference.width / (2 * GRID_POLICY.maxColumns), reference.height / (2 * GRID_POLICY.maxRows)) : 0
  // Deliberate edits own their measured scale/composition. Adapt continuously from that explicit
  // reference, including the first changed pixel; never cache or promote an automatic projection.
  const ratio = reference ? Math.sqrt((width + gutter) / (height + gutter) / ((reference.width + referenceGutter) / (reference.height + referenceGutter))) : 1
  const desiredPitch = reference ? reference.pitch * Math.sqrt((width + gutter) * (height + gutter)
    / ((reference.width + referenceGutter) * (reference.height + referenceGutter))) : pitch
  const x = projectionAxis(source, true), y = projectionAxis(source, false)
  // Preferred dimensions remain valid metadata for explicit Save in the unchanged v2 schema.
  const minColumns = Math.max(x.minimum, ...source.placements.map(p => p.preferred.w))
  const minRows = Math.max(y.minimum, ...source.placements.map(p => p.preferred.h))
  const columns = Math.max(minColumns, Math.min(GRID_POLICY.maxColumns, Math.floor((reference ? source.columns * ratio : (width + gutter) / pitch) + 1e-9)))
  const rows = Math.max(minRows, Math.min(GRID_POLICY.maxRows, Math.floor((reference ? source.rows / ratio : (height + gutter) / pitch) + 1e-9)))
  const xs = x.fit(columns), ys = y.fit(rows)
  const placements = source.placements.map(p => ({ ...p, x: xs.get(p.id)!.start, y: ys.get(p.id)!.start,
    w: xs.get(p.id)!.size, h: ys.get(p.id)!.size, preferred: { ...p.preferred } }))
  const snapshot = { ...source, columns, rows, placements }
  if (!validLayout(placements, snapshot, constraintsFor(snapshot))) throw new Error('Invalid spatial projection')
  const metrics = fitGrid(width, height, snapshot, gutter, desiredPitch)
  return result(snapshot, metrics, x.probes + y.probes)
  function result(snapshot: GridSnapshot, metrics: GridMetrics, probes: number): GridProjection {
    const warning = Math.min(metrics.width / width, metrics.height / height) < RESPONSIVE_POLICY.warningCoverage
      ? 'Os limites desta composição exigem margens maiores. Posições relativas e dados salvos foram preservados.' : null
    return { snapshot, metrics, warning, probes }
  }
}
