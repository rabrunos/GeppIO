import { useLayoutEffect, useRef, useState } from 'react'
import { REGIONS } from '../../../shared/freeform/types.ts'
import type { Region, Size } from '../../../shared/freeform/types.ts'

export interface Measurement extends Size { frameWidth: number; frameHeight: number; left: number; top: number; scrollLeft: number; scrollTop: number }
const empty = (): Measurement => ({ width: 0, height: 0, frameWidth: 0, frameHeight: 0, left: 0, top: 0, scrollLeft: 0, scrollTop: 0 })
export function useSurfaces() {
  const root = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLDivElement>(null), sidebar = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null)
  const ports = { main, sidebar, bottom }
  function scroller(region: Region) { return region === 'sidebar' ? ports.sidebar.current?.closest<HTMLElement>('[data-region="sidebar"]') ?? null : ports[region].current }
  const [measures, setMeasures] = useState<Record<Region, Measurement>>({ main: empty(), sidebar: empty(), bottom: empty() })
  function measure() {
    const area = root.current?.getBoundingClientRect()
    if (!area) return
    const next = Object.fromEntries(REGIONS.map(region => {
      const port = ports[region].current, r = port?.getBoundingClientRect()
      if (region === 'sidebar' && port && r) {
        const owner = scroller(region)!, box = owner.getBoundingClientRect()
        return [region, { width: port.clientWidth, height: Math.max(0, owner.clientHeight - 30),
          frameWidth: box.width, frameHeight: box.height,
          left: r.left - area.left, top: box.top + 15 - area.top, scrollLeft: 0, scrollTop: box.top + 15 - r.top }]
      }
      return [region, port && r ? { width: port.clientWidth, height: port.clientHeight,
        frameWidth: r.width, frameHeight: r.height,
        left: r.left - area.left, top: r.top - area.top, scrollLeft: port.scrollLeft, scrollTop: port.scrollTop } : empty()]
    })) as Record<Region, Measurement>
    setMeasures(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
  }
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    for (const region of REGIONS) if (ports[region].current) observer.observe(ports[region].current!)
    if (scroller('sidebar')) observer.observe(scroller('sidebar')!)
    measure()
    return () => observer.disconnect()
  }, [])
  return { root, ports, measures, measure, scroller }
}
export type Surfaces = ReturnType<typeof useSurfaces>
