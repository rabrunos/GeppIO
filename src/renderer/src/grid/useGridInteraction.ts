import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { moveRect, resizeRect } from '../../../shared/grid/geometry.ts'
import type { GridMetrics } from '../../../shared/grid/geometry.ts'
import { constraintsFor } from '../../../shared/grid/policy.ts'
import { reflow } from '../../../shared/grid/reflow.ts'
import type { Direction, GridPlacement, GridSnapshot } from '../../../shared/grid/types.ts'
import type { ProjectedTransaction } from './useProjectedTransaction.ts'

interface Gesture { id: string; pointer: number; kind: 'move' | Direction; x: number; y: number; pitch: number; original: GridPlacement; snapshot: GridPlacement[]; source: GridSnapshot; target: HTMLButtonElement }
export function useGridInteraction(tx: ProjectedTransaction, metrics: GridMetrics, measurementKey: string) {
  const gesture = useRef<Gesture | null>(null), [selected, setSelected] = useState<string | null>(null), [blocked, setBlocked] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  function end(cancel: boolean) {
    const active = gesture.current
    setBlocked(null)
    if (!active) return
    gesture.current = null
    if (cancel) { tx.put(active.source); tx.setMessage('Gesto cancelado. A prévia anterior foi restaurada.') }
    setDragging(false); setBlocked(null)
    if (active.target.hasPointerCapture(active.pointer)) active.target.releasePointerCapture(active.pointer)
  }
  // Restore the stable source before painting a changed viewport, including changed bounds.
  useLayoutEffect(() => { end(true) }, [measurementKey, metrics.pitch, metrics.left, metrics.top])
  function apply(ps: GridPlacement[], p: GridPlacement, dx: number, dy: number, kind: Gesture['kind']) {
    const bounds = tx.live.current, cs = constraintsFor(bounds)
    const candidate = kind === 'move' ? moveRect(p, dx, dy, bounds) : resizeRect(p, dx, dy, kind, bounds, cs[p.id]!)
    const result = reflow(ps, p.id, candidate, bounds, cs, kind)
    if (result.status === 'blocked') { setBlocked(p.id); tx.setMessage('Sem espaço dentro dos limites da grade. A última prévia válida foi mantida.'); return }
    tx.putPlacements(result.placements); setBlocked(null)
    tx.setMessage('Prévia válida. Salve ou cancele a composição; os tamanhos preferidos dos vizinhos são preservados.')
  }
  function start(event: PointerEvent<HTMLButtonElement>, p: GridPlacement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || event.button !== 0 || metrics.pitch <= 0) return
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { id: p.id, pointer: event.pointerId, kind, x: event.clientX, y: event.clientY, pitch: metrics.pitch,
      original: structuredClone(p), snapshot: structuredClone(tx.live.current.placements), source: structuredClone(tx.source.current), target: event.currentTarget }
    setSelected(p.id); setDragging(true)
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    apply(active.snapshot, active.original, (event.clientX - active.x) / active.pitch, (event.clientY - active.y) / active.pitch, active.kind)
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) { if (gesture.current?.pointer === event.pointerId) end(cancel) }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, p: GridPlacement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); const step = event.shiftKey ? 2 : 1
    setSelected(p.id); apply(tx.live.current.placements, p, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
      event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0, kind)
  }
  function handlers(p: GridPlacement, kind: Gesture['kind']) {
    return { onPointerDown: (e: PointerEvent<HTMLButtonElement>) => start(e, p, kind), onPointerMove: move,
      onPointerUp: (e: PointerEvent<HTMLButtonElement>) => finish(e), onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => finish(e, true),
      onLostPointerCapture: (e: PointerEvent<HTMLButtonElement>) => finish(e, true), onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => keyboard(e, p, kind) }
  }
  return { selected, setSelected, blocked, dragging, handlers, end, active: () => !!gesture.current }
}
export type GridInteraction = ReturnType<typeof useGridInteraction>
