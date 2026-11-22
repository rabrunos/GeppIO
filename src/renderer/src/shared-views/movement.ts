import { floatingBounds } from './definition.ts'
import type { Point, Size } from './definition.ts'

const direction: ReadonlyMap<string, Point> = new Map([
  ['ArrowLeft', { x: -1, y: 0 }], ['ArrowRight', { x: 1, y: 0 }],
  ['ArrowUp', { x: 0, y: -1 }], ['ArrowDown', { x: 0, y: 1 }]
])

/** Keyboard and pointer movement share CSS-pixel bounds. */
export function moveWithArrow(key: string, shifted: boolean, origin: Point, area: Size, size: Size): Point | null {
  const delta = direction.get(key)
  if (!delta) return null
  const step = shifted ? 10 : 1
  const { x, y } = floatingBounds(area, size, { x: origin.x + step * delta.x, y: origin.y + step * delta.y })
  return { x, y }
}
