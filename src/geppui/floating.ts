export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export function fitFloatingFrame(area: Size, preferred: Size, position: Point | null) {
  function axis(available: number, desired: number, offset: number | undefined, alignEnd: boolean) {
    const edge = Math.min(12, available / 2)
    const size = Math.min(desired, available - 2 * edge)
    const end = available - size - edge
    const start = offset ?? (alignEnd ? end - 20 : edge + 12)
    return { size, start: Math.max(edge, Math.min(start, end)) }
  }
  const horizontal = axis(area.width, preferred.width, position?.x, true)
  const vertical = axis(area.height, preferred.height, position?.y, false)
  return { x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size }
}

const direction: ReadonlyMap<string, Point> = new Map([
  ['ArrowLeft', { x: -1, y: 0 }], ['ArrowRight', { x: 1, y: 0 }],
  ['ArrowUp', { x: 0, y: -1 }], ['ArrowDown', { x: 0, y: 1 }]
])

/** Keyboard and pointer movement share CSS-pixel bounds. */
export function moveWithArrow(key: string, shifted: boolean, origin: Point, area: Size, size: Size): Point | null {
  const delta = direction.get(key)
  if (!delta) return null
  const step = shifted ? 10 : 1
  const { x, y } = fitFloatingFrame(area, size, { x: origin.x + step * delta.x, y: origin.y + step * delta.y })
  return { x, y }
}
