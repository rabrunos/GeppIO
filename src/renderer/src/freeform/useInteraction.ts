import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { candidate } from '../../../shared/freeform/geometry.ts'
import { constraintsFor, POLICY } from '../../../shared/freeform/policy.ts'
import { reflow } from '../../../shared/freeform/reflow.ts'
import { transfer, REGION_LABELS } from '../../../shared/freeform/transfer.ts'
import { REGIONS } from '../../../shared/freeform/types.ts'
import type { Direction, Placement, Region, Snapshot, Surface } from '../../../shared/freeform/types.ts'
import type { Transaction } from './useTransaction.ts'
import type { Surfaces } from './useSurfaces.ts'

interface Gesture {
  id: string; pointer: number; kind: 'move' | Direction; x: number; y: number; original: Placement;
  snapshot: Snapshot; source: Snapshot; target: HTMLButtonElement; scrollX: number; scrollY: number;
  clientX: number; clientY: number; time: number; last: string; extension: number; directionX: number
}
export function useInteraction(tx: Transaction, view: Snapshot, surfaces: Surfaces, expanded: boolean, feasible: Record<Region, boolean>) {
  const gesture = useRef<Gesture | null>(null), animation = useRef(0)
  const [selected, setSelected] = useState<string | null>(null), [blocked, setBlocked] = useState<string | null>(null)
  const [heldExtent, setHeldExtent] = useState<{ region: Region; width: number } | null>(null)
  const latest = useRef({ view, apply, tick, surfaces }); latest.current = { view, apply, tick, surfaces }
  function surface(region: Region): Surface { return { ...surfaces.measures[region], region, expanded: expanded && region !== 'sidebar' } }
  function end(cancel: boolean) {
    const a = gesture.current
    if (!a) return
    gesture.current = null; cancelAnimationFrame(animation.current); setBlocked(null); setHeldExtent(null)
    if (cancel) { tx.put(a.source); tx.setMessage('Gesto cancelado. A prévia anterior foi restaurada.') }
    if (a.target.hasPointerCapture(a.pointer)) a.target.releasePointerCapture(a.pointer)
  }
  const measurementKey = REGIONS.map(r => `${surfaces.measures[r].width},${surfaces.measures[r].height},${surfaces.measures[r].left},${surfaces.measures[r].top}`).join(';') + expanded
  useLayoutEffect(() => { end(true) }, [measurementKey])
  useLayoutEffect(() => () => cancelAnimationFrame(animation.current), [])
  function apply(snapshot: Snapshot, p: Placement, dx: number, dy: number, kind: Gesture['kind']) {
    if (!feasible[p.region]) return
    const s = surface(p.region), cs = constraintsFor(s), requested = candidate(p, dx, dy, kind, s, cs[p.id]!)
    const result = reflow(snapshot.placements.filter(q => q.region === p.region), p.id, requested, s, cs, kind)
    if (result.status === 'blocked') { setBlocked(p.id); tx.setMessage('Sem espaço para os mínimos deste widget. A última prévia válida foi mantida.'); return }
    tx.put({ ...snapshot, placements: snapshot.placements.map(q => result.placements.find(next => next.id === q.id) ?? q) })
    setBlocked(null); tx.setMessage('Prévia válida. Salve ou cancele; a compressão dos vizinhos preserva seus tamanhos preferidos.')
  }
  function update(a: Gesture) {
    const port = latest.current.surfaces.ports[a.original.region].current
    const dx = a.clientX - a.x + (port?.scrollLeft ?? 0) - a.scrollX + a.extension, dy = a.clientY - a.y + (port?.scrollTop ?? 0) - a.scrollY
    const key = `${dx},${dy}`
    if (key === a.last) return
    a.last = key; latest.current.apply(a.snapshot, a.original, dx, dy, a.kind)
  }
  function tick(time: number) {
    const a = gesture.current
    if (!a) return
    const port = latest.current.surfaces.ports[a.original.region].current
    if (!port) return
    const r = port.getBoundingClientRect(), elapsed = a.time ? Math.min(32, time - a.time) / 16.67 : 1
    a.time = time
    // No speculative giant world: an intended active position determines temporary extent.
    // Existing occupied range is scrollable immediately; direct pointer movement grows it.
    if (expanded && a.original.region !== 'sidebar' && a.clientY >= r.top && a.clientY <= r.bottom) {
      const delta = a.clientX > r.right - 30 && a.clientX <= r.right + 30 ? Math.min(20, (a.clientX - r.right + 30) / 2)
        : a.clientX < r.left + 30 && a.clientX >= r.left - 30 ? -Math.min(20, (r.left + 30 - a.clientX) / 2) : 0
      if (delta && Math.sign(delta) === a.directionX && (a.kind === 'move' || /[ew]/.test(a.kind))) {
        const before = port.scrollLeft
        port.scrollLeft += delta * elapsed
        const unscrolled = delta * elapsed - (port.scrollLeft - before)
        // Keep real pointer coordinates intact. Only the successful active intention
        // extends occupancy; there is no allocated speculative world or pixel array.
        a.extension = Math.max(-POLICY.maxCoordinate, Math.min(POLICY.maxCoordinate, a.extension + unscrolled))
      }
    }
    update(a); animation.current = requestAnimationFrame(next => latest.current.tick(next))
  }
  function transferTo(id: string, region: Region, at?: { x: number; y: number }) {
    if (!tx.editing || !feasible[region]) { tx.setMessage('Região sem espaço disponível. Reabra ou amplie a região antes de transferir.'); return false }
    const result = transfer(latest.current.view, id, surface(region), at)
    if (!result) { tx.setMessage(`Transferência para ${REGION_LABELS[region]} incompatível ou sem espaço para os mínimos. Composição preservada.`); setBlocked(id); return false }
    tx.put(result); setBlocked(null); tx.setMessage(`Widget transferido para ${REGION_LABELS[region]} na prévia. Salve ou cancele.`); return true
  }
  function start(e: PointerEvent<HTMLButtonElement>, p: Placement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || e.button !== 0 || !feasible[p.region]) return
    e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId)
    const port = surfaces.ports[p.region].current!
    // Native scroll clamping caused by shrinking our own occupied extent must not feed
    // back into this gesture's pointer delta. Hold only its starting occupied width,
    // then contract and clamp on release. This is bounded transient gesture state.
    setHeldExtent({ region: p.region, width: Math.max(surfaces.measures[p.region].width,
      ...view.placements.filter(q => q.region === p.region).map(q => q.x + q.width)) })
    gesture.current = { id: p.id, pointer: e.pointerId, kind, x: e.clientX, y: e.clientY, original: structuredClone(p),
      snapshot: structuredClone(view), source: structuredClone(tx.live.current), target: e.currentTarget,
      scrollX: port.scrollLeft, scrollY: port.scrollTop, clientX: e.clientX, clientY: e.clientY, time: 0, last: '0,0', extension: 0, directionX: 0 }
    setSelected(p.id); animation.current = requestAnimationFrame(time => latest.current.tick(time))
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const a = gesture.current
    if (!a || a.pointer !== e.pointerId) return
    if (e.clientX !== a.clientX) a.directionX = Math.sign(e.clientX - a.clientX)
    a.clientX = e.clientX; a.clientY = e.clientY; update(a)
  }
  function finish(e: PointerEvent<HTMLButtonElement>, cancel = false) {
    const a = gesture.current
    if (!a || a.pointer !== e.pointerId) return
    if (!cancel && a.kind === 'move') {
      for (const region of REGIONS) {
        if (region === a.original.region) continue
        const element = surfaces.ports[region].current, r = element?.getBoundingClientRect(), regionRect = element?.closest('[data-region]')?.getBoundingClientRect()
        if (!r || !regionRect || e.clientX < regionRect.left || e.clientX > regionRect.right || e.clientY < regionRect.top || e.clientY > regionRect.bottom) continue
        // Transfer uses the pre-gesture composition so failed drops cannot leave a
        // partly displaced origin. A rejected cross-region drop restores it atomically.
        end(true)
        const s = surface(region), result = feasible[region] ? transfer(a.snapshot, a.id, s, {
          x: e.clientX - r.left + (surfaces.ports[region].current?.scrollLeft ?? 0),
          y: e.clientY - r.top + (surfaces.ports[region].current?.scrollTop ?? 0) }) : null
        if (result) { tx.put(result); tx.setMessage(`Widget transferido para ${REGION_LABELS[region]}. Salve ou cancele.`) }
        else { setBlocked(a.id); tx.setMessage('Transferência incompatível ou sem espaço. A composição anterior foi restaurada.') }
        return
      }
    }
    end(cancel)
  }
  function keyboard(e: KeyboardEvent<HTMLButtonElement>, p: Placement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault(); const step = e.shiftKey ? 10 : 1
    setSelected(p.id); apply(view, p, e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0,
      e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0, kind)
    requestAnimationFrame(() => {
      const port = surfaces.ports[p.region].current, next = tx.live.current.placements.find(q => q.id === p.id)
      if (!port || !next) return
      if (next.x < port.scrollLeft) port.scrollLeft = next.x
      else if (next.x + next.width > port.scrollLeft + port.clientWidth) port.scrollLeft = next.x + next.width - port.clientWidth
      surfaces.measure()
    })
  }
  function handlers(p: Placement, kind: Gesture['kind']) {
    return { onPointerDown: (e: PointerEvent<HTMLButtonElement>) => start(e, p, kind), onPointerMove: move,
      onPointerUp: (e: PointerEvent<HTMLButtonElement>) => finish(e), onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => finish(e, true),
      onLostPointerCapture: (e: PointerEvent<HTMLButtonElement>) => finish(e, true), onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => keyboard(e, p, kind) }
  }
  return { selected, setSelected, blocked, heldExtent, handlers, end, active: () => !!gesture.current, transferTo }
}
export type Interaction = ReturnType<typeof useInteraction>
