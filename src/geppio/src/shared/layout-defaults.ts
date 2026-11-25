import type { LayoutConstraint, LayoutSnapshot, MinSize } from './layout.ts'

/** Shared v1 fixture contract used by renderer restoration and native identity recovery. */
export const DEFAULT_LAYOUT: LayoutSnapshot = { schemaVersion: 1, theme: 'dark', placements: [
  { id: 'summary', x: 0, y: 0, width: .28, height: .22 },
  { id: 'queue', x: .30, y: 0, width: .42, height: .55 },
  { id: 'library', x: .74, y: 0, width: .26, height: .38 },
  { id: 'notes', x: 0, y: .24, width: .28, height: .47 },
  { id: 'activity', x: .74, y: .40, width: .26, height: .60 },
  { id: 'properties', x: .30, y: .57, width: .42, height: .43 },
  { id: 'chart', x: 0, y: .74, width: .28, height: .26 }
] }
// Initial minimums relative to the 960 × 620 logical canvas; policy remains provisional.
export const MINIMUMS: Record<string, MinSize> = Object.fromEntries(DEFAULT_LAYOUT.placements.map(p => [p.id, { width: .17, height: .18 }]))
// Geometry permissions only; independent of content, plugin, region and presentation authority.
export const MAIN_CONSTRAINTS: Record<string, LayoutConstraint> = Object.fromEntries(
  DEFAULT_LAYOUT.placements.map(p => [p.id, { min: MINIMUMS[p.id]!, max: { width: 1, height: 1 }, resizeX: true, resizeY: true }]))
