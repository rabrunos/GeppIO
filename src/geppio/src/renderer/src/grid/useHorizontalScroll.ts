import { useLayoutEffect, useRef, useState } from 'react'
import { HORIZONTAL, horizontalExtent } from '../../../shared/grid/horizontal.ts'
import type { GridMetrics } from '../../../shared/grid/geometry.ts'
import type { GridPlacement } from '../../../shared/grid/types.ts'

export function useHorizontalScroll(enabled: boolean, placements: GridPlacement[], metrics: GridMetrics) {
  const port = useRef<HTMLDivElement>(null)
  const [temporary, setTemporary] = useState(0), [position, setPosition] = useState(0), [maximum, setMaximum] = useState(0)
  const width = enabled ? horizontalExtent(placements, metrics, temporary) : metrics.width
  function sync() {
    const element = port.current; if (!element) return
    const max = enabled ? Math.max(0, element.scrollWidth - element.clientWidth) : 0
    if (element.scrollLeft > max || !enabled) element.scrollLeft = max
    // Main never has a vertical scroll domain; focus reveal must not scroll its vertical axis.
    if (element.scrollTop) element.scrollTop = 0
    setPosition(element.scrollLeft); setMaximum(max)
  }
  useLayoutEffect(sync, [enabled, width, metrics.width, metrics.height])
  useLayoutEffect(() => {
    const element = port.current; if (!enabled || !element) return
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.deltaX || !event.deltaY) return
      event.preventDefault()
      element.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [enabled])
  const occupied = Math.max(0, ...placements.map(p => p.x + p.w))
  const exactMaximum = Math.max(0, width - metrics.width)
  // Native scrollWidth/clientWidth are integer-rounded. Map that range to the exact CSS extent
  // so the last occupied edge meets the frame without even a fractional blank tail.
  function offset() {
    const element = port.current; if (!element) return 0
    const nativeMaximum = element.scrollWidth - element.clientWidth
    return nativeMaximum > 0 ? element.scrollLeft * exactMaximum / nativeMaximum : 0
  }
  const roundedMaximum = Math.max(0, Math.round(width) - Math.round(metrics.width))
  const correction = roundedMaximum > 0 ? Math.min(position, roundedMaximum) * (1 - exactMaximum / roundedMaximum) : 0
  return { port, width, position, maximum, correction, offset, sync,
    extend(pixelRight: number) { if (enabled && metrics.pitch > 0) setTemporary(Math.min(HORIZONTAL.maxColumns, occupied + HORIZONTAL.extension, Math.ceil(pixelRight / metrics.pitch) + HORIZONTAL.extension)) },
    clearExtension() { setTemporary(0) },
    to(value: number) { if (port.current) { port.current.scrollLeft = Math.max(0, Math.min(maximum, value)); sync() } }
  }
}
export type HorizontalScroll = ReturnType<typeof useHorizontalScroll>
