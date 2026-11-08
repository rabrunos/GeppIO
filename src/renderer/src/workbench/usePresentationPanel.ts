import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Transaction } from '../freeform/useTransaction.ts'
import { PANEL_BAR_HEIGHT, PANEL_MIN } from '../../../shared/workbench/presentations.ts'
import type { WidgetPresentation } from '../../../shared/workbench/presentations.ts'
import { REGION_POLICY } from './region-policy.ts'

/** Pointer previews and hover visibility never enter the document or history. */
export function usePresentationPanel(tx: Transaction, state: WidgetPresentation, maximum: number, viewport: string) {
  const [preview, setPreview] = useState<{ height: number; open: boolean } | null>(null)
  const [peek, setPeek] = useState(false), [menu, setMenu] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), inside = useRef(false)
  const active = useRef<{ pointer: number; y: number; x: number; height: number; started: boolean; next: { height: number; open: boolean }; target: HTMLDivElement } | null>(null)
  function clearTimer() { if (timer.current) clearTimeout(timer.current); timer.current = null }
  function hover(value: boolean) {
    inside.current = value; clearTimer()
    timer.current = setTimeout(() => {
      if (value || !document.querySelector('#properties-presentation:focus-within')) setPeek(value)
    }, value ? 100 : 280)
  }
  function cancel() {
    const gesture = active.current; active.current = null; setPreview(null)
    if (gesture?.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer)
  }
  useEffect(() => { cancel(); clearTimer(); setPeek(false); inside.current = false }, [state.presentation, tx.editing, viewport])
  useEffect(() => {
    const blur = () => { cancel(); clearTimer(); setPeek(false) }
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('blur', blur); clearTimer() }
  }, [])
  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = active.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    const delta = gesture.y - event.clientY
    if (!gesture.started && Math.abs(delta) < 4) return
    gesture.started = true
    const height = gesture.height + delta
    gesture.next = { height: Math.max(PANEL_MIN.height, Math.min(maximum, height)), open: maximum >= PANEL_MIN.height && height >= PANEL_MIN.height - REGION_POLICY.collapseDistance }
    setPreview(gesture.next)
  }
  return {
    preview, revealed: peek || menu, hover, active: () => !!active.current,
    focus() { clearTimer(); setPeek(true) },
    blur() { if (!inside.current) hover(false) },
    hold(open: boolean) { setMenu(open); if (!open && !inside.current) hover(false) },
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || tx.saving || tx.recovery || tx.gestureActive || active.current) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        active.current = { pointer: event.pointerId, y: event.clientY, x: event.clientX, height: state.open && maximum >= PANEL_MIN.height ? Math.min(maximum, state.preferred.height) : PANEL_BAR_HEIGHT,
          started: false, next: { height: state.preferred.height, open: state.open }, target: event.currentTarget }
      },
      onPointerMove: move,
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        const gesture = active.current; if (!gesture || gesture.pointer !== event.pointerId) return
        move(event); active.current = null; setPreview(null)
        if (!gesture.started && Math.abs(event.clientX - gesture.x) + Math.abs(event.clientY - gesture.y) < 4) void tx.present({ open: !state.open })
        else if (gesture.started) void tx.present({ open: gesture.next.open, preferred: { ...state.preferred, height: gesture.next.open ? gesture.next.height : state.preferred.height } })
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel: cancel, onLostPointerCapture: cancel,
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape' && active.current) { event.preventDefault(); event.stopPropagation(); cancel() }
      }
    }
  }
}
