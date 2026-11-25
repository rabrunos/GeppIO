import type { LayoutStorage } from '../storage.ts'
import { clamp, validConstraint } from './geometry.ts'
import type { GridMetrics } from './geometry.ts'
import { overlaps } from './occupancy.ts'
import { DEFAULT_GRID, GRID_IDS } from './policy.ts'
import type { GridBounds, GridConstraint, GridConstraints, GridPlacement, GridRect, GridSnapshot } from './types.ts'
import type { GridRestoration } from './storage.ts'

/** Independent experiment. The v2 renderer-shaped view is never serialized as grid v2. */
export const HORIZONTAL = Object.freeze({ rows: 10, inset: 15, gutter: 10, maxColumns: 4096, maxSpan: 24,
  maxBytes: 64 * 1024, maxPixels: 1_000_000, extension: 12 })
export const HORIZONTAL_KEY = 'geppio:layout:horizontal:v1'
export const HORIZONTAL_BOUNDS: GridBounds = { columns: HORIZONTAL.maxColumns, rows: HORIZONTAL.rows }
export const DEFAULT_HORIZONTAL: GridSnapshot = { ...structuredClone(DEFAULT_GRID), ...HORIZONTAL_BOUNDS,
  placements: DEFAULT_GRID.placements.map(p => p.id === 'chart' ? { ...structuredClone(p), y: 8 } : structuredClone(p)) }
export function horizontalConstraints(): GridConstraints {
  return Object.fromEntries(GRID_IDS.map(id => [id, { min: { w: 3, h: 2 }, max: { w: HORIZONTAL.maxSpan, h: 10 }, resizeX: true, resizeY: true }]))
}
export function validHorizontalRect(p: GridRect, b: GridBounds = HORIZONTAL_BOUNDS, c?: GridConstraint): boolean {
  return b.columns === HORIZONTAL.maxColumns && b.rows === 10
    && [p.x, p.y, p.w, p.h].every(Number.isInteger) && p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0
    && p.x + p.w <= b.columns && p.y + p.h <= 10 && p.w <= HORIZONTAL.maxSpan
    && (!c || (validConstraint(c, b) && p.w >= c.min.w && p.h >= c.min.h && p.w <= c.max.w && p.h <= c.max.h))
}
export function validHorizontalLayout(ps: readonly GridPlacement[], b: GridBounds, cs: GridConstraints): boolean {
  return ps.length > 0 && ps.length <= 16 && new Set(ps.map(p => p.id)).size === ps.length && ps.every((p, i) => !!cs[p.id]
    && validHorizontalRect(p, b, cs[p.id]) && Number.isInteger(p.preferred?.w) && Number.isInteger(p.preferred?.h)
    && p.preferred.w >= p.w && p.preferred.h >= p.h && p.preferred.w <= cs[p.id]!.max.w && p.preferred.h <= cs[p.id]!.max.h
    && ps.slice(i + 1).every(q => !overlaps(p, q)))
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function parseHorizontal(text: string): GridSnapshot {
  if (text.length > HORIZONTAL.maxBytes || new TextEncoder().encode(text).length > HORIZONTAL.maxBytes) throw new Error('Horizontal input too large')
  const data: unknown = JSON.parse(text)
  if (!object(data) || data.schemaVersion !== 1 || data.engine !== 'horizontal' || data.rows !== 10
    || !Array.isArray(data.placements) || data.placements.length !== GRID_IDS.length) throw new Error('Unsupported horizontal layout')
  const placements = data.placements.map((p: unknown) => {
    if (!object(p) || typeof p.id !== 'string' || !GRID_IDS.includes(p.id) || !object(p.preferred)) throw new Error('Invalid horizontal widget')
    return { id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, preferred: { w: p.preferred.w, h: p.preferred.h } } as GridPlacement
  })
  if (!validHorizontalLayout(placements, HORIZONTAL_BOUNDS, horizontalConstraints())) throw new Error('Invalid horizontal placements')
  return { schemaVersion: 2, theme: 'dark', ...HORIZONTAL_BOUNDS, placements: GRID_IDS.map(id => placements.find(p => p.id === id)!) }
}
export function serializeHorizontal(snapshot: GridSnapshot): string {
  if (snapshot.columns !== HORIZONTAL.maxColumns || snapshot.rows !== 10) throw new Error('Invalid horizontal view')
  const data = { schemaVersion: 1, engine: 'horizontal', rows: 10, placements: snapshot.placements }
  const validated = parseHorizontal(JSON.stringify(data))
  return JSON.stringify({ ...data, placements: validated.placements })
}
export function readHorizontal(storage: LayoutStorage): GridRestoration {
  let raw: string | null = null
  try {
    raw = storage.getItem(HORIZONTAL_KEY)
    return { snapshot: raw === null ? structuredClone(DEFAULT_HORIZONTAL) : parseHorizontal(raw), raw, writable: true, recovery: false,
      message: 'Horizontal experimental · 10 linhas. Somente Salvar grava esta composição.' }
  } catch {
    return { snapshot: structuredClone(DEFAULT_HORIZONTAL), raw, writable: false, recovery: true,
      message: 'Layout horizontal inválido ou indisponível. Dados preservados. Importe uma cópia válida ou abra a prévia inicial em Configurações.' }
  }
}
export function writeHorizontal(storage: LayoutStorage, snapshot: GridSnapshot, expected: string | null) {
  try {
    const raw = serializeHorizontal(snapshot)
    if (storage.getItem(HORIZONTAL_KEY) !== expected) return { raw: expected, error: 'O layout salvo mudou em outra sessão. Reabra o aplicativo antes de salvar; sua prévia foi mantida.' }
    storage.setItem(HORIZONTAL_KEY, raw); return { raw, error: null }
  } catch { return { raw: expected, error: 'Não foi possível salvar o layout horizontal. A prévia e os dados anteriores foram preservados.' } }
}
export function horizontalMetrics(width: number, height: number): GridMetrics {
  const w = Number.isFinite(width) ? clamp(width - 30, 0, HORIZONTAL.maxPixels) : 0
  const h = Number.isFinite(height) ? Math.max(0, height - 30) : 0
  const gutter = Math.min(10, h / 18)
  const cell = Math.max(0, Math.min((h - 9 * gutter) / 10, HORIZONTAL.maxPixels / HORIZONTAL.maxColumns - gutter))
  return { cell, gutter, pitch: cell + gutter, width: w, height: 10 * cell + 9 * gutter, left: 0, top: 0 }
}
export function horizontalExtent(ps: readonly GridPlacement[], m: GridMetrics, temporary = 0): number {
  const occupied = Math.max(0, ...ps.map(p => p.x + p.w))
  return Math.min(HORIZONTAL.maxPixels, Math.max(m.width, Math.max(occupied, clamp(temporary, 0, HORIZONTAL.maxColumns)) * m.pitch - m.gutter))
}
export function horizontalCandidate(p: GridPlacement, dx: number, dy: number, kind: 'move' | import('./types.ts').Direction): GridRect {
  if (![dx, dy].every(Number.isFinite) || !validHorizontalRect(p)) throw new Error('Invalid horizontal gesture')
  const c = horizontalConstraints()[p.id]; if (!c) throw new Error('Unknown horizontal widget')
  const next = { ...p }, x = Math.round(dx), y = Math.round(dy)
  if (kind === 'move') return { ...p, x: clamp(p.x + x, 0, HORIZONTAL.maxColumns - p.w), y: clamp(p.y + y, 0, 10 - p.h) }
  if (kind.includes('e')) next.w = clamp(p.w + x, c.min.w, Math.min(c.max.w, HORIZONTAL.maxColumns - p.x))
  if (kind.includes('w')) { next.w = clamp(p.w - x, c.min.w, Math.min(c.max.w, p.x + p.w)); next.x = p.x + p.w - next.w }
  if (kind.includes('s')) next.h = clamp(p.h + y, c.min.h, 10 - p.y)
  if (kind.includes('n')) { next.h = clamp(p.h - y, c.min.h, p.y + p.h); next.y = p.y + p.h - next.h }
  return next
}
