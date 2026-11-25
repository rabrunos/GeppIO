import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { groupWidgets } from '../../../shared/workbench/groups.ts'
import type { Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import type { Transaction } from '../freeform/useTransaction.ts'

/** Explicit grouping gestures never run a placement preview or a second solver. */
export function useGroupDrag(tx: Transaction, registry: Registry, view: WorkbenchSnapshot) {
  const [picture, setPicture] = useState<{ id: string; x: number; y: number } | null>(null), [armed, setArmed] = useState<string | null>(null), [over, setOver] = useState<string | null>(null)
  const armedRef = useRef<string | null>(null), suppress = useRef(false)
  const gesture = useRef<{ id: string; pointer: number; target: HTMLElement; baseline: WorkbenchSnapshot; x: number; y: number; moved: boolean } | null>(null)
  const latest = useRef({ tx, registry, view }); latest.current = { tx, registry, view }
  function targetAt(x: number, y: number) { return document.elementsFromPoint(x, y).map(node => node.closest<HTMLElement>('[data-group-target]')).find(Boolean)?.dataset.groupTarget ?? null }
  function finish(cancel: boolean, x = 0, y = 0, paint = true) {
    const g = gesture.current; gesture.current = null
    if (g?.target.hasPointerCapture(g.pointer)) g.target.releasePointerCapture(g.pointer)
    if (paint) { setPicture(null); setOver(null) }
    if (!g || !paint || !latest.current.tx.editing) return
    const target = !cancel && g.moved ? targetAt(x, y) : null
    const result = target ? groupWidgets(g.baseline, latest.current.registry, g.id, target) : null
    if (result) { latest.current.tx.put(result); latest.current.tx.finishGesture(); latest.current.tx.setMessage('Widgets agrupados. Salve ou cancele.') }
    else { latest.current.tx.cancelGesture(); if (g.moved) latest.current.tx.setMessage(target ? 'Agrupamento incompatível ou sem espaço. Composição preservada.' : 'Agrupamento cancelado. Composição preservada.') }
    suppress.current = g.moved
  }
  function cancel() { armedRef.current = null; setArmed(null); finish(true) }
  async function choose(target: string) {
    const source = armedRef.current; if (!source) return
    const next = groupWidgets(latest.current.view, latest.current.registry, source, target)
    if (next) {
      latest.current.tx.action(next); latest.current.tx.setMessage('Widgets agrupados. Salve ou cancele.')
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(target)}"][data-group-host] [role="tab"][aria-selected="true"]`)?.focus())
    }
    else latest.current.tx.setMessage('Agrupamento incompatível ou sem espaço. Composição preservada.')
    armedRef.current = null; setArmed(null); setOver(null)
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && (gesture.current || armedRef.current)) { event.preventDefault(); event.stopImmediatePropagation(); cancel() } }
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel)
    return () => { finish(true, 0, 0, false); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel) }
  }, [])
  useEffect(() => { if (!tx.editing) cancel() }, [tx.editing])
  useEffect(() => { if (armed) document.querySelector<HTMLElement>('[data-group-target][data-group-allowed="true"]')?.focus() }, [armed])
  function handlers(id: string) {
    return {
      onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (!tx.editing || tx.gestureActive || event.button || gesture.current) return
        suppress.current = false; armedRef.current = null; setArmed(null); event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
        tx.beginGesture(); gesture.current = { id, pointer: event.pointerId, target: event.currentTarget, baseline: structuredClone(view), x: event.clientX, y: event.clientY, moved: false }; setPicture({ id, x: event.clientX, y: event.clientY })
      },
      onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) { const g = gesture.current; if (!g || g.pointer !== event.pointerId) return; g.moved ||= Math.hypot(event.clientX - g.x, event.clientY - g.y) >= 4; setPicture({ id, x: event.clientX, y: event.clientY }); setOver(targetAt(event.clientX, event.clientY)) },
      onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) { if (gesture.current?.pointer === event.pointerId) finish(false, event.clientX, event.clientY) },
      onPointerCancel() { cancel() }, onLostPointerCapture() { if (gesture.current) cancel() },
      onClick() { if (suppress.current) { suppress.current = false; return }; armedRef.current = id; setArmed(id) }
    }
  }
  return { sourceId: picture?.id ?? armed, picture, over, handlers, choose, cancel, targetAt, hover(x: number, y: number) { const target = targetAt(x, y); setOver(previous => previous === target ? previous : target) } }
}
