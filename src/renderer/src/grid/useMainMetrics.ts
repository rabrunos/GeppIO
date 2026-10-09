import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fitGrid } from '../../../shared/grid/geometry.ts'
import { GRID_POLICY } from '../../../shared/grid/policy.ts'
import { projectGrid, viewportBand } from '../../../shared/grid/projection.ts'
import type { GridProjection } from '../../../shared/grid/projection.ts'
import type { GridSnapshot } from '../../../shared/grid/types.ts'
import type { PanelState } from '../workbench/TestPanel.tsx'

export function useMainMetrics(source: GridSnapshot, panel: PanelState) {
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
  const band = viewportBand(width, height)
  const previous = useRef<(GridProjection & { band: number }) | null>(null)
  // Packing runs once per source/aspect band, not for every pixel of a splitter drag.
  const projection = useMemo(() => {
    const cached = previous.current
    // Editing the current view fixes its bounds until the viewport crosses an aspect band.
    const next = cached?.band === band && source.columns === cached.snapshot.columns && source.rows === cached.snapshot.rows
      ? { snapshot: source, warning: cached.warning, probes: 0 } : projectGrid(source, width, height)
    previous.current = { ...next, band }; return next
  }, [source, band, width === 0, height === 0])
  const metrics = fitGrid(width, height, projection.snapshot)
  const available = { width, height }
  return { main, tray, metrics, snapshot: projection.snapshot, warning: projection.warning, probes: projection.probes, measurementKey: `${size.width},${size.height},${size.tray},${dockWidth},${dockHeight},${panel.anchor}`, offset: { left: inset + metrics.left + (panel.anchor === 'left' ? dockWidth : 0),
    top: inset + size.tray + metrics.top + (panel.anchor === 'top' ? dockHeight : 0) }, dockWidth, dockHeight, available }
}
