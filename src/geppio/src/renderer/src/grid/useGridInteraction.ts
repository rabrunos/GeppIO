import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { moveRect, resizeRect } from '../../../shared/grid/geometry.ts'
import type { GridMetrics } from '../../../shared/grid/geometry.ts'
import { constraintsFor } from '../../../shared/grid/policy.ts'
import { reflow } from '../../../shared/grid/reflow.ts'
import type { Direction, GridPlacement } from '../../../shared/grid/types.ts'
import type { GridEditSource } from './useLayoutTransaction.ts'
import type { ProjectedTransaction } from './useProjectedTransaction.ts'
import { horizontalCandidate } from '../../../shared/grid/horizontal.ts'
import { horizontalReflow } from '../../../shared/grid/horizontal-reflow.ts'
import type { HorizontalScroll } from './useHorizontalScroll.ts'

interface Gesture { id: string; pointer: number; kind: 'move' | Direction; x: number; y: number; pitch: number; original: GridPlacement; snapshot: GridPlacement[]; source: GridEditSource; target: HTMLButtonElement;
  scroll: number; clientX: number; clientY: number; last: string; time: number }
export function useGridInteraction(tx: ProjectedTransaction, metrics: GridMetrics, measurementKey: string, horizontal?: HorizontalScroll) {
  const gesture = useRef<Gesture | null>(null), [selected, setSelected] = useState<string | null>(null), [blocked, setBlocked] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const animation = useRef(0), latest = useRef({ horizontal, apply, tick }); latest.current = { horizontal, apply, tick }
  function end(cancel: boolean) {
    const active = gesture.current
    setBlocked(null)
    if (!active) return
    gesture.current = null
    cancelAnimationFrame(animation.current); latest.current.horizontal?.clearExtension()
    if (cancel) { tx.restoreSource(active.source); tx.setMessage('Gesto cancelado. A prévia anterior foi restaurada.') }
    setDragging(false); setBlocked(null)
    if (active.target.hasPointerCapture(active.pointer)) active.target.releasePointerCapture(active.pointer)
  }
  // Restore the stable source before painting a changed viewport, including changed bounds.
  useLayoutEffect(() => { end(true) }, [measurementKey, metrics.pitch, metrics.left, metrics.top])
  function apply(ps: GridPlacement[], p: GridPlacement, dx: number, dy: number, kind: Gesture['kind']) {
    const bounds = tx.live.current, cs = constraintsFor(bounds)
    const candidate = horizontal ? horizontalCandidate(p, dx, dy, kind) : kind === 'move' ? moveRect(p, dx, dy, bounds) : resizeRect(p, dx, dy, kind, bounds, cs[p.id]!)
    const result = horizontal ? horizontalReflow(ps, p.id, candidate, kind) : reflow(ps, p.id, candidate, bounds, cs, kind)
    if (result.status === 'blocked') { setBlocked(p.id); tx.setMessage('Sem espaço dentro dos limites da grade. A última prévia válida foi mantida.'); return }
    tx.putPlacements(result.placements); setBlocked(null)
    tx.setMessage('Prévia válida. Salve ou cancele a composição; os tamanhos preferidos dos vizinhos são preservados.')
  }
  function start(event: PointerEvent<HTMLButtonElement>, p: GridPlacement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || event.button !== 0 || metrics.pitch <= 0) return
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { id: p.id, pointer: event.pointerId, kind, x: event.clientX, y: event.clientY, pitch: metrics.pitch,
      original: structuredClone(p), snapshot: structuredClone(tx.live.current.placements), source: tx.captureSource(), target: event.currentTarget,
      scroll: horizontal?.offset() ?? 0, clientX: event.clientX, clientY: event.clientY, last: '0,0', time: 0 }
    setSelected(p.id); setDragging(true)
    if (horizontal) animation.current = requestAnimationFrame(time => latest.current.tick(time))
  }
  function update(active: Gesture) {
    const dx = (active.clientX - active.x + (latest.current.horizontal?.offset() ?? 0) - active.scroll) / active.pitch
    const dy = (active.clientY - active.y) / active.pitch, key = `${Math.round(dx)},${Math.round(dy)}`
    if (key === active.last) return
    active.last = key; latest.current.apply(active.snapshot, active.original, dx, dy, active.kind)
  }
  function tick(time: number) {
    const active = gesture.current, scroll = latest.current.horizontal, port = scroll?.port.current
    if (!active || !port || !scroll) return
    const r = port.getBoundingClientRect(), elapsed = active.time ? Math.min(32, time - active.time) / 16.67 : 1
    active.time = time
    const delta = active.clientX > r.right - 36 ? Math.min(24, (active.clientX - r.right + 36) / 2)
      : active.clientX < r.left + 36 ? -Math.min(24, (r.left + 36 - active.clientX) / 2) : 0
    if (delta > 0) scroll.extend(port.scrollLeft + port.clientWidth)
    if (delta) port.scrollLeft += delta * elapsed
    update(active); animation.current = requestAnimationFrame(next => latest.current.tick(next))
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    active.clientX = event.clientX; active.clientY = event.clientY
    if (horizontal) update(active)
    else apply(active.snapshot, active.original, (event.clientX - active.x) / active.pitch, (event.clientY - active.y) / active.pitch, active.kind)
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) { if (gesture.current?.pointer === event.pointerId) end(cancel) }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, p: GridPlacement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); const step = event.shiftKey ? 2 : 1
    setSelected(p.id); apply(tx.live.current.placements, p, event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
      event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0, kind)
    if (horizontal) requestAnimationFrame(() => {
      const port = horizontal.port.current, next = tx.live.current.placements.find(q => q.id === p.id)
      if (!port || !next) return
      const left = next.x * metrics.pitch, right = (next.x + next.w) * metrics.pitch - metrics.gutter
      if (left < port.scrollLeft) port.scrollLeft = left
      else if (right > port.scrollLeft + port.clientWidth) port.scrollLeft = right - port.clientWidth
    })
  }
  function handlers(p: GridPlacement, kind: Gesture['kind']) {
    return { onPointerDown: (e: PointerEvent<HTMLButtonElement>) => start(e, p, kind), onPointerMove: move,
      onPointerUp: (e: PointerEvent<HTMLButtonElement>) => finish(e), onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => finish(e, true),
      onLostPointerCapture: (e: PointerEvent<HTMLButtonElement>) => finish(e, true), onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => keyboard(e, p, kind) }
  }
  return { selected, setSelected, blocked, dragging, handlers, end, active: () => !!gesture.current }
}
export type GridInteraction = ReturnType<typeof useGridInteraction>
