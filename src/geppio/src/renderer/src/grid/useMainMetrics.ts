import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GRID_POLICY } from '../../../shared/grid/policy.ts'
import { projectGrid } from '../../../shared/grid/projection.ts'
import type { GridViewport } from '../../../shared/grid/projection.ts'
import type { GridSnapshot } from '../../../shared/grid/types.ts'
import type { PanelState } from '../workbench/TestPanel.tsx'
import { horizontalMetrics } from '../../../shared/grid/horizontal.ts'

export function useMainMetrics(source: GridSnapshot, panel: PanelState, editViewport: GridViewport | null, engine: 'responsive' | 'horizontal' = 'responsive') {
  const main = useRef<HTMLElement>(null), tray = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0, tray: 0 })
  useLayoutEffect(() => {
    const element = main.current; if (!element) return
    const measure = () => { const rect = element.getBoundingClientRect(); setSize({ width: rect.width, height: rect.height, tray: tray.current?.getBoundingClientRect().height ?? 0 }) }
    const observer = new ResizeObserver(measure); observer.observe(element); if (tray.current) observer.observe(tray.current)
    measure(); return () => observer.disconnect()
  }, [])
  const inset = GRID_POLICY.inset, usableWidth = Math.max(0, size.width - 2 * inset), usableHeight = Math.max(0, size.height - 2 * inset - size.tray)
  const docked = panel.open && panel.presentation === 'docked'
  const dockWidth = docked && ['left', 'right'].includes(panel.anchor) ? Math.min(270, usableWidth / 3) : 0
  const dockHeight = docked && ['top', 'bottom'].includes(panel.anchor) ? Math.min(180, usableHeight / 3) : 0
  const width = Math.max(0, usableWidth - dockWidth), height = Math.max(0, usableHeight - dockHeight)
  // Source, explicit edit reference and exact CSS dimensions fully determine the result.
  const projection = useMemo(() => engine === 'horizontal' ? { snapshot: source, metrics: horizontalMetrics(size.width, size.height), requestedPitch: 0,
    warning: size.height < 120 || size.height > 2400 || size.width < 30 ? 'Main extrema: células/gutters limitados por segurança; as 10 linhas lógicas são mantidas.' : '', probes: 0 }
    : projectGrid(source, width, height, editViewport), [engine, source, width, height, size.width, size.height, editViewport])
  const metrics = projection.metrics
  const available = engine === 'horizontal' ? { width: metrics.width, height: Math.max(0, size.height - 30) } : { width, height }
  return { main, tray, metrics, requestedPitch: projection.requestedPitch, editViewport, snapshot: projection.snapshot, warning: projection.warning, probes: projection.probes,
    measurementKey: engine === 'horizontal' ? `${engine},${size.width},${size.height}` : `${size.width},${size.height},${size.tray},${dockWidth},${dockHeight},${panel.anchor}`,
    offset: engine === 'horizontal' ? { left: 0, top: 0 } : { left: inset + metrics.left + (panel.anchor === 'left' ? dockWidth : 0),
      top: inset + size.tray + metrics.top + (panel.anchor === 'top' ? dockHeight : 0) }, dockWidth, dockHeight, available }
}
