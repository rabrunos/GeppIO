import type { Composition } from '../../../shared/workbench/model.ts'

type Cell = { x: number; y: number; width: number; height: number; role: string }
const cache = new Map<string, Cell[]>()
/** Saved percentages only. No workspace measurement on menu opening or scroll. */
function cells(composition: Composition) {
  const key = JSON.stringify([composition.reference, composition.format, composition.scopes, composition.chrome])
  const cached = cache.get(key); if (cached) return cached
  const sideSize = composition.chrome?.sidebar?.size ?? composition.reference.sidebar.width + 30, bottomSize = composition.chrome?.bottom?.size ?? composition.reference.bottom.height + 20
  const side = composition.chrome?.sidebar?.visible === false ? 0 : sideSize <= 250 ? 22 : sideSize <= 340 ? 28 : 38
  const bottom = composition.chrome?.bottom?.visible === false ? 0 : bottomSize <= 160 ? 14 : 21, left = 3 + side + (side ? 3 : 0), width = 157 - left
  const result: Cell[] = side ? [{ x: 3, y: 3, width: side, height: 74, role: 'sidebar' }] : []
  for (const region of ['main', 'bottom'] as const) {
    if (region === 'bottom' && !bottom) continue
    const top = region === 'main' ? 3 : 77 - bottom, height = region === 'main' ? 74 - bottom - (bottom ? 3 : 0) : bottom
    if (!composition.scopes.includes(region)) { result.push({ x: left, y: top, width, height, role: `${region} thumbnail-omitted` }); continue }
    const reference = composition.reference[region]
    for (const slot of composition.format.filter(cell => cell.region === region)) result.push({ x: left + slot.x / reference.width * width, y: top + slot.y / reference.height * height,
      width: slot.width / reference.width * width, height: slot.height / reference.height * height, role: `${region} thumbnail-widget` })
  }
  if (cache.size >= 128) cache.delete(cache.keys().next().value!)
  cache.set(key, result); return result
}
export function CompositionThumbnail({ composition }: { composition: Composition }) {
  return <svg viewBox="0 0 160 80" className="saved-layout-thumbnail" aria-hidden="true">{cells(composition).map((cell, i) => <rect key={i} x={cell.x} y={cell.y} width={cell.width} height={cell.height} rx="4" className={`thumbnail-${cell.role}`} stroke={cell.role.includes('widget') ? 'var(--color-surface)' : undefined} strokeWidth="1" />)}</svg>
}
