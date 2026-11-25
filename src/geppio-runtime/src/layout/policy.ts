import type { Surface } from './types.ts'
export const POLICY = Object.freeze({ inset: 15, gap: 10, maxLocalTravel: 1024, maxCoordinate: 100_000, maxSize: 4096, maxWidgets: 16, maxBytes: 64 * 1024 })
export function surfaceLimit(s: Surface) { return { width: s.expanded && s.region === 'main' ? POLICY.maxCoordinate : s.width,
  height: s.region === 'sidebar' ? POLICY.maxCoordinate : s.height } }
