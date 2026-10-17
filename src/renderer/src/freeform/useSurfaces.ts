import { useLayoutEffect, useRef, useState } from 'react'
import { REGIONS } from '../../../shared/freeform/types.ts'
import type { Region, Size } from '../../../shared/freeform/types.ts'

export interface Measurement extends Size { left: number; top: number; scrollLeft: number; scrollTop: number }
const empty = (): Measurement => ({ width: 0, height: 0, left: 0, top: 0, scrollLeft: 0, scrollTop: 0 })
export function useSurfaces() {
  const root = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLDivElement>(null), sidebar = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null)
  const ports = { main, sidebar, bottom }
  const [measures, setMeasures] = useState<Record<Region, Measurement>>({ main: empty(), sidebar: empty(), bottom: empty() })
  function measure() {
    const area = root.current?.getBoundingClientRect()
    if (!area) return
    const next = Object.fromEntries(REGIONS.map(region => {
      const port = ports[region].current, r = port?.getBoundingClientRect()
      return [region, port && r ? { width: port.clientWidth, height: port.clientHeight,
        left: r.left - area.left, top: r.top - area.top, scrollLeft: port.scrollLeft, scrollTop: port.scrollTop } : empty()]
    })) as Record<Region, Measurement>
    setMeasures(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
  }
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    for (const region of REGIONS) if (ports[region].current) observer.observe(ports[region].current!)
    measure()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(measure)
  return { root, ports, measures, measure }
}
export type Surfaces = ReturnType<typeof useSurfaces>
