import type { GridBounds, GridConstraints, GridSnapshot } from './types.ts'

/** Reference composition and bounded responsive policy; viewport projections are never stored implicitly. */
export const GRID_POLICY = Object.freeze({ columns: 12, rows: 8, gutter: 10, inset: 9, maxColumns: 24, maxRows: 24, maxWidgets: 16 })
// Worst-case interval probes: bounded unit reductions × candidate widgets × separation pairs, on two axes.
export const RESPONSIVE_POLICY = Object.freeze({ referenceArea: 192, warningCoverage: .85, probes: 2 * GRID_POLICY.maxWidgets ** 4 * GRID_POLICY.maxColumns })
export const GRID_KEY = 'geppio:layout:grid:v2'
export const DEFAULT_GRID: GridSnapshot = { schemaVersion: 2, theme: 'dark', columns: GRID_POLICY.columns, rows: GRID_POLICY.rows, placements: [
  { id: 'summary', x: 0, y: 0, w: 3, h: 2 },
  { id: 'queue', x: 3, y: 0, w: 5, h: 4 },
  { id: 'library', x: 8, y: 0, w: 4, h: 3 },
  { id: 'notes', x: 0, y: 2, w: 3, h: 4 },
  { id: 'activity', x: 8, y: 3, w: 4, h: 5 },
  { id: 'properties', x: 3, y: 4, w: 5, h: 4 },
  { id: 'chart', x: 0, y: 6, w: 3, h: 2 }
].map(p => ({ ...p, preferred: { w: p.w, h: p.h } })) }
export const GRID_IDS = DEFAULT_GRID.placements.map(p => p.id)
export function constraintsFor(bounds: GridBounds): GridConstraints {
  return Object.fromEntries(GRID_IDS.map(id => [id, { min: { w: 3, h: 2 }, max: { w: bounds.columns, h: bounds.rows }, resizeX: true, resizeY: true }]))
}
