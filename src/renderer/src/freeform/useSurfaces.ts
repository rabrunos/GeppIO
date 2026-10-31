import { useLayoutEffect, useRef, useState } from 'react'
import { REGIONS } from '../../../shared/freeform/types.ts'
import type { Region, Size } from '../../../shared/freeform/types.ts'

export interface Measurement extends Size { frameWidth: number; frameHeight: number; left: number; top: number; scrollLeft: number; scrollTop: number; clipWidth?: number; clipHeight?: number; ownerWidth?: number; ownerHeight?: number }
const empty = (): Measurement => ({ width: 0, height: 0, frameWidth: 0, frameHeight: 0, left: 0, top: 0, scrollLeft: 0, scrollTop: 0 })
export function useSurfaces() {
  const root = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLDivElement>(null), sidebar = useRef<HTMLDivElement>(null), bottom = useRef<HTMLDivElement>(null)
  const ports = { main, sidebar, bottom }
  const scrollbarHeight = useRef(0)
  function scroller(region: Region) { return region === 'sidebar' ? ports.sidebar.current?.closest<HTMLElement>('[data-region="sidebar"]') ?? null : ports[region].current }
  const [measures, setMeasures] = useState<Record<Region, Measurement>>({ main: empty(), sidebar: empty(), bottom: empty() })
  function measure() {
    const area = root.current?.getBoundingClientRect()
    if (!area) return
    const next = Object.fromEntries(REGIONS.map(region => {
      const port = ports[region].current, r = port?.getBoundingClientRect()
      if (region === 'sidebar' && port && r) {
        const owner = scroller(region)!, box = owner.getBoundingClientRect()
        const style = getComputedStyle(owner), paddingTop = parseFloat(style.paddingTop) || 0, paddingBottom = parseFloat(style.paddingBottom) || 0
        const clip = owner.closest<HTMLElement>('.host-sidebar-content')?.getBoundingClientRect()
        const transform = new DOMMatrixReadOnly(getComputedStyle(owner.closest<HTMLElement>('.host-sidebar-content')!).transform)
        return [region, { width: port.clientWidth, height: Math.max(0, owner.clientHeight - paddingTop - paddingBottom),
          frameWidth: box.width, frameHeight: box.height,
          left: r.left - area.left - transform.e, top: box.top + owner.clientTop + paddingTop - area.top - transform.f, scrollLeft: 0,
          scrollTop: box.top + owner.clientTop + paddingTop - r.top,
          clipWidth: clip ? Math.max(0, Math.min(port.clientWidth, clip.right - r.left - (parseFloat(style.paddingRight) || 0))) : port.clientWidth }]
      }
      const owner = port?.closest<HTMLElement>('[data-region]'), style = owner ? getComputedStyle(owner) : null
      return [region, port && r ? { width: port.clientWidth, height: port.clientHeight,
        frameWidth: r.width, frameHeight: r.height,
        ownerWidth: owner && style ? owner.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) : port.clientWidth,
        ownerHeight: owner && style ? owner.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) : port.clientHeight,
        ...(region === 'bottom' && owner ? { clipHeight: Math.max(0, Math.min(port.clientHeight, owner.getBoundingClientRect().bottom - r.top)) } : {}),
        left: r.left - area.left, top: r.top - area.top, scrollLeft: port.scrollLeft, scrollTop: port.scrollTop } : empty()]
    })) as Record<Region, Measurement>
    setMeasures(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
  }
  useLayoutEffect(() => {
    // Measure this renderer's actual thin native horizontal scrollbar reservation,
    // including its DPR. The probe is transient, hidden, and has no scroll/storage state.
    const probe = document.createElement('div')
    probe.className = 'placement-port'
    probe.style.cssText = 'position:absolute;left:-10000px;width:100px;height:100px;flex:none;overflow-x:scroll;overflow-y:hidden;visibility:hidden'
    root.current?.append(probe)
    scrollbarHeight.current = probe.getBoundingClientRect().height - probe.clientHeight
    probe.remove()
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    for (const region of REGIONS) if (ports[region].current) observer.observe(ports[region].current!)
    if (scroller('sidebar')) observer.observe(scroller('sidebar')!)
    const sidebarClip = scroller('sidebar')?.closest<HTMLElement>('.host-sidebar-content')
    if (sidebarClip) observer.observe(sidebarClip)
    measure()
    return () => observer.disconnect()
  }, [])
  return { root, ports, measures, measure, scroller, scrollbarHeight }
}
export type Surfaces = ReturnType<typeof useSurfaces>
