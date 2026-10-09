import { fitGrid } from './geometry.ts'
import { overlaps, validLayout } from './occupancy.ts'
import { constraintsFor, GRID_POLICY, RESPONSIVE_POLICY } from './policy.ts'
import type { GridBounds, GridPlacement, GridSnapshot } from './types.ts'

export interface GridProjection { snapshot: GridSnapshot; warning: string | null; probes: number }
interface Budget { probes: number; limit: number }
/** Quantized aspect bands are stable breakpoints, independent of resize history. */
export function viewportBand(width: number, height: number): number {
  if (![width, height].every(Number.isFinite) || width < 0 || height < 0) throw new Error('Invalid viewport')
  const gutter = Math.min(GRID_POLICY.gutter, width / (2 * GRID_POLICY.maxColumns), height / (2 * GRID_POLICY.maxRows))
  return Math.max(1, Math.round((width + gutter) / (height + gutter || 1) * RESPONSIVE_POLICY.ratioSteps))
}
function topologies(source: GridSnapshot, band: number): GridBounds[] {
  const minColumns = Math.max(...source.placements.map(p => p.preferred.w)), minRows = Math.max(...source.placements.map(p => p.preferred.h))
  const area = Math.max(GRID_POLICY.columns * GRID_POLICY.rows, source.placements.reduce((n, p) => n + p.preferred.w * p.preferred.h, 0))
  const maxArea = Math.max(RESPONSIVE_POLICY.maxArea, source.columns * source.rows, area)
  const minimaArea = Object.values(constraintsFor(source)).reduce((n, c) => n + c.min.w * c.min.h, 0)
  const candidates: (GridBounds & { score: number })[] = []
  for (let columns = minColumns; columns <= GRID_POLICY.maxColumns; columns++) {
    for (let rows = minRows; rows <= GRID_POLICY.maxRows; rows++) {
      if (columns * rows > maxArea || columns * rows < minimaArea) continue
      const ratioLoss = Math.abs(Math.log(columns / rows / (band / RESPONSIVE_POLICY.ratioSteps)))
      candidates.push({ columns, rows, score: ratioLoss + .025 * Math.abs(Math.log(columns * rows / area)) })
    }
  }
  return candidates.sort((a, b) => a.score - b.score || a.columns * a.rows - b.columns * b.rows || a.columns - b.columns)
    .slice(0, RESPONSIVE_POLICY.candidates).map(({ columns, rows }) => ({ columns, rows }))
}
/** Preserve edge anchors and normalized free-space position, including intentional vertical gaps. */
function anchor(position: number, size: number, sourceLimit: number, targetSize: number, targetLimit: number) {
  return Math.round((sourceLimit === size ? 0 : position / (sourceLimit - size)) * (targetLimit - targetSize))
}
function pack(source: GridSnapshot, bounds: GridBounds, mode: number, budget: Budget, directOnly = false): GridPlacement[] | null {
  const cs = constraintsFor(bounds)
  const projected = source.placements.map(p => {
    const w = mode === 0 ? p.preferred.w : mode === 1 ? p.w : Math.max(cs[p.id]!.min.w, Math.min(p.w, Math.floor(p.preferred.w * bounds.columns / source.columns)))
    const h = mode === 0 ? p.preferred.h : mode === 1 ? p.h : Math.max(cs[p.id]!.min.h, Math.min(p.h, Math.floor(p.preferred.h * bounds.rows / source.rows)))
    return { ...p, w, h, preferred: { ...p.preferred }, x: anchor(p.x, p.w, source.columns, w, bounds.columns), y: anchor(p.y, p.h, source.rows, h, bounds.rows) }
  })
  if (validLayout(projected, bounds, cs)) return projected
  if (directOnly) return null
  if (projected.reduce((n, p) => n + p.w * p.h, 0) > bounds.columns * bounds.rows) return null
  // Logical reading order is only a search order; slots rank against anchors, never gravity.
  const ordered = projected.map((p, i) => ({ p, i })).sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x || a.i - b.i)
  const placed: GridPlacement[] = [], slots = new Map<string, GridPlacement[]>()
  for (const { p } of ordered) {
    const choices: GridPlacement[] = []
    for (let y = 0; y <= bounds.rows - p.h; y++) for (let x = 0; x <= bounds.columns - p.w; x++) choices.push({ ...p, x, y })
    choices.sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - Math.abs(b.x - p.x) - Math.abs(b.y - p.y) || Math.abs(a.y - p.y) - Math.abs(b.y - p.y) || a.y - b.y || a.x - b.x)
    slots.set(p.id, choices)
  }
  let states = 0
  const startProbes = budget.probes
  function search(index: number): boolean {
    if (index === ordered.length) return true
    if (++states > RESPONSIVE_POLICY.states) return false
    for (const candidate of slots.get(ordered[index]!.p.id)!) {
      if (budget.probes >= budget.limit || budget.probes - startProbes >= RESPONSIVE_POLICY.attemptProbes) return false
      budget.probes++
      if (placed.some(p => overlaps(p, candidate))) continue
      placed.push(candidate)
      if (search(index + 1)) return true
      placed.pop()
    }
    return false
  }
  if (!search(0)) return null
  return source.placements.map(p => placed.find(q => q.id === p.id)!)
}
/** Pure, bounded, non-destructive presentation derived from one canonical saved/edit source. */
export function projectGrid(source: GridSnapshot, width: number, height: number): GridProjection {
  const band = viewportBand(width, height), budget: Budget = { probes: 0, limit: RESPONSIVE_POLICY.probes }
  if (!validLayout(source.placements, source, constraintsFor(source)) || source.placements.length > GRID_POLICY.maxWidgets) throw new Error('Invalid projection source')
  if (width === 0 || height === 0) return { snapshot: structuredClone(source), warning: null, probes: 0 }
  const candidates = topologies(source, band)
  // Prefer an anchor-preserving topology with small margins over gratuitous rearrangement.
  for (const bounds of candidates) {
    const coverage = Math.exp(-Math.abs(Math.log(bounds.columns / bounds.rows / (band / RESPONSIVE_POLICY.ratioSteps))))
    if (coverage < .955) continue
    const placements = bounds.columns === source.columns && bounds.rows === source.rows ? structuredClone(source.placements) : pack(source, bounds, 0, budget, true)
    if (placements) {
      const metrics = fitGrid(width, height, bounds)
      const warning = Math.min(metrics.width / width, metrics.height / height) < .85 ? 'Esta proporção exige margens maiores. A composição e os dados salvos foram preservados.' : null
      return { snapshot: { ...source, ...bounds, placements }, warning, probes: 0 }
    }
  }
  // Try preferred sizes across all candidates before allowing conservative temporary compression.
  for (let mode = 0; mode < 3; mode++) {
    const phaseLimit = Math.min(RESPONSIVE_POLICY.probes, budget.probes + Math.floor(RESPONSIVE_POLICY.probes / 3))
    budget.limit = phaseLimit
    for (const bounds of candidates) {
      if (budget.probes >= phaseLimit) break
      const placements = bounds.columns === source.columns && bounds.rows === source.rows ? structuredClone(source.placements) : pack(source, bounds, mode, budget)
      if (placements && validLayout(placements, bounds, constraintsFor(bounds))) {
        const metrics = fitGrid(width, height, bounds)
        const warning = Math.min(metrics.width / width, metrics.height / height) < .85
          ? 'Os limites e tamanhos deste layout exigem margens maiores. A composição e os dados salvos foram preservados.' : null
        return { snapshot: { ...source, ...bounds, placements }, warning, probes: budget.probes }
      }
    }
  }
  return { snapshot: structuredClone(source), warning: 'Não foi possível redistribuir todos os widgets nesta proporção. A composição válida foi ajustada com células quadradas; os dados salvos foram preservados.', probes: Math.min(budget.probes, RESPONSIVE_POLICY.probes) }
}
