import { DEFAULT_GRID } from '../../src/shared/grid/policy.ts'
import type { GridSnapshot } from '../../src/shared/grid/types.ts'

/** Sanitized arrangements, not a reconstruction of the owner's unavailable JSON/screenshots. */
const left: GridSnapshot = { ...structuredClone(DEFAULT_GRID), columns: 12, rows: 12, placements: [
  { id: 'summary', x: 0, y: 0, w: 6, h: 2 },
  { id: 'queue', x: 6, y: 0, w: 3, h: 3 },
  { id: 'library', x: 0, y: 2, w: 5, h: 10 },
  { id: 'notes', x: 9, y: 3, w: 3, h: 2 },
  { id: 'activity', x: 6, y: 5, w: 3, h: 2 },
  { id: 'properties', x: 9, y: 7, w: 3, h: 3 },
  { id: 'chart', x: 6, y: 10, w: 3, h: 2 }
].map(p => ({ ...p, preferred: { w: p.w, h: p.h } })) }
const mirrored: GridSnapshot = { ...structuredClone(left), placements: left.placements.map(p => ({ ...p, x: left.columns - p.x - p.w, preferred: { ...p.preferred } })) }
const gaps: GridSnapshot = { ...structuredClone(left), columns: 16, rows: 16, placements: left.placements.map(p => ({ ...p, x: p.x ? p.x + 4 : 0, y: p.y ? p.y + 4 : 0, preferred: { ...p.preferred } })) }
const edited: GridSnapshot = { ...structuredClone(left), placements: left.placements.map(p => p.id === 'library' ? { ...p, x: 1, w: 4, h: 9, preferred: { w: 4, h: 9 } } : structuredClone(p)) }
export const COMPOSITIONS = { left, mirrored, dense: structuredClone(DEFAULT_GRID), gaps, edited }
