import type { Constraint, Constraints, Region, Snapshot, Surface } from './types.ts'

export const POLICY = Object.freeze({ inset: 15, gap: 10, maxLocalTravel: 1024, maxCoordinate: 100_000, maxSize: 4096, maxWidgets: 16, maxBytes: 64 * 1024 })
export const FREEFORM_KEY = 'geppio:layout:freeform:v1'
export const EXPANSION_KEY = 'geppio:layout:expansion:v1'
const define = (width: number, height: number, regions: readonly Region[], defaultWidth: number, defaultHeight: number): Constraint => ({ min: { width, height },
  default: { width: defaultWidth, height: defaultHeight }, max: { width: POLICY.maxSize, height: POLICY.maxSize },
  resizeX: true, resizeY: true, regions, overflow: 'auto', responsive: 'region' })
/** Content minima, independent of plugin/native permissions and visual theme. */
export const CONSTRAINTS: Constraints = {
  summary: define(164, 112, ['main', 'sidebar', 'bottom'], 230, 140),
  queue: define(240, 160, ['main'], 400, 300),
  library: define(180, 150, ['main', 'sidebar'], 310, 230),
  notes: define(164, 160, ['main', 'sidebar'], 230, 300),
  activity: define(180, 160, ['main', 'sidebar'], 310, 380),
  properties: define(240, 174, ['main', 'sidebar'], 400, 310),
  chart: define(164, 112, ['main', 'sidebar', 'bottom'], 230, 160)
}
export const IDS = Object.keys(CONSTRAINTS)
export const DEFAULT_FREEFORM: Snapshot = {
  schemaVersion: 1, engine: 'freeform', constraintVersion: 1,
  reference: { main: { width: 960, height: 620 }, sidebar: { width: 185, height: 320 }, bottom: { width: 960, height: 128 } },
  placements: [
    { id: 'summary', x: 0, y: 0 }, { id: 'queue', x: 240, y: 0 },
    { id: 'library', x: 650, y: 0 }, { id: 'notes', x: 0, y: 150 },
    { id: 'activity', x: 650, y: 240 }, { id: 'properties', x: 240, y: 310 }, { id: 'chart', x: 0, y: 460 }
  ].map(p => ({ ...p, ...CONSTRAINTS[p.id]!.default, region: 'main', preferred: { ...CONSTRAINTS[p.id]!.default } }))
}
export function constraintsFor(surface: Surface): Constraints {
  return Object.fromEntries(IDS.map(id => {
    const c = CONSTRAINTS[id]!
    return [id, { ...c,
      min: { width: surface.region === 'sidebar' ? Math.max(c.min.width, surface.width) : c.min.width,
        height: surface.region === 'bottom' ? Math.max(c.min.height, surface.height) : c.min.height },
      max: { width: surface.region === 'sidebar' ? surface.width : c.max.width,
        height: surface.region === 'bottom' ? surface.height : c.max.height },
      resizeX: c.resizeX && surface.region !== 'sidebar', resizeY: c.resizeY && surface.region !== 'bottom' }]
  }))
}
export function surfaceLimit(s: Surface) { return { width: s.expanded && s.region === 'main' ? POLICY.maxCoordinate : s.width,
  height: s.region === 'sidebar' ? POLICY.maxCoordinate : s.height } }
