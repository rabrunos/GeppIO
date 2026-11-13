import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Transaction } from '../freeform/useTransaction.ts'
import { horizontal, PANEL_BAR_HEIGHT, PANEL_MIN } from '../../../shared/workbench/presentations.ts'
import type { PanelGeometry, PresentationLayout, PresentationPatch, WidgetPresentation } from '../../../shared/workbench/presentations.ts'
import { clamp } from '../../../shared/freeform/geometry.ts'
import { REGION_POLICY } from './region-policy.ts'

/** One transient gesture owner for all panels. Hover and previews never enter history. */
export function usePresentationPanel(tx: Transaction, layout: PresentationLayout, viewport: string) {
  const [preview, setPreview] = useState<{ id: string; patch: PresentationPatch } | null>(null)
  const [peek, setPeek] = useState<Record<string, boolean>>({}), [menus, setMenus] = useState<Record<string, boolean>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()), inside = useRef(new Set<string>())
  const active = useRef<{ id: string; pointer: number; x: number; y: number; state: WidgetPresentation; rect: PanelGeometry['expanded']; started: boolean; next: PresentationPatch; target: HTMLElement; free: boolean; compact: boolean } | null>(null)
  function clearTimer(id: string) { clearTimeout(timers.current.get(id)); timers.current.delete(id) }
  function hover(id: string, value: boolean) {
    if (value) inside.current.add(id); else inside.current.delete(id)
    clearTimer(id)
    timers.current.set(id, setTimeout(() => {
      if (!value && active.current?.id === id) return
      const focused = document.querySelector(`[data-widget-id="${CSS.escape(id)}"] .widget-content:focus-within`)
      if (value || !focused) setPeek(previous => ({ ...previous, [id]: value }))
    }, value ? 100 : 280))
  }
  function cancel() {
    const gesture = active.current; active.current = null; setPreview(null)
    if (gesture?.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer)
  }
  const modes = Object.values(layout.panels).map(p => `${p.state.viewId}:${p.state.presentation}:${p.state.anchor}`).sort().join(';')
  useEffect(() => { cancel(); for (const id of timers.current.keys()) clearTimer(id); setPeek({}); inside.current.clear() }, [modes, tx.editing, viewport])
  useEffect(() => {
    const blur = () => { cancel(); for (const id of timers.current.keys()) clearTimer(id); setPeek({}) }
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('blur', blur); for (const id of timers.current.keys()) clearTimer(id) }
  }, [])
  function move(event: PointerEvent<HTMLElement>) {
    const gesture = active.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
    if (!gesture.started && Math.hypot(dx, dy) < 4) return
    gesture.started = true
    if (gesture.compact) return
    if (gesture.free) {
      const area = layout.normal
      gesture.next = { position: { x: clamp(gesture.rect.x + dx, area.x, area.x + area.width - gesture.rect.width),
        y: clamp(gesture.rect.y + dy, area.y, area.y + area.height - gesture.rect.height) } }
    } else {
      const state = gesture.state, axis = horizontal(state.anchor) ? 'height' : 'width'
      const delta = state.anchor === 'top' ? dy : state.anchor === 'bottom' ? -dy : state.anchor === 'left' ? dx : -dx
      const extent = (layout.panels[gesture.id]?.shown && state.open ? gesture.rect[axis] : PANEL_BAR_HEIGHT) + delta
      const maximum = axis === 'height' ? layout.normal.height + (state.anchor === 'top' ? layout.reservations.top : layout.reservations.bottom) : layout.normal.width + (state.anchor === 'left' ? layout.reservations.left : layout.reservations.right)
      const open = maximum >= PANEL_MIN[axis] && extent >= PANEL_MIN[axis] - REGION_POLICY.collapseDistance
      gesture.next = { open, preferred: { ...state.preferred, [axis]: open ? Math.max(PANEL_MIN[axis], Math.min(4096, maximum, extent)) : state.preferred[axis] } }
    }
    setPreview({ id: gesture.id, patch: gesture.next })
  }
  return {
    preview, active: () => !!active.current, cancel,
    for(state: WidgetPresentation, geometry?: PanelGeometry) {
      const id = state.viewId
      return {
        revealed: !!peek[id] || !!menus[id],
        hover(value: boolean) { hover(id, value) },
        blur() { if (!inside.current.has(id)) hover(id, false) },
        hold(value: boolean) { setMenus(previous => previous[id] === value ? previous : { ...previous, [id]: value }); if (!value && !inside.current.has(id)) hover(id, false) },
        handlers(free = false, compact = false) {
          return {
            onPointerDown(event: PointerEvent<HTMLElement>) {
              if (!geometry || event.button !== 0 || tx.saving || tx.recovery || tx.gestureActive || active.current || (free && !tx.editing)) return
              event.preventDefault(); event.stopPropagation(); clearTimer(id); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
              const rect = free ? { ...geometry.collapsed, ...((peek[id] || menus[id]) ? { x: geometry.expanded.x, y: geometry.expanded.y } : {}) } : geometry.expanded
              active.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, rect, state, started: false, next: {}, target: event.currentTarget, free, compact }
            },
            onPointerMove: move,
            onPointerUp(event: PointerEvent<HTMLElement>) {
              const gesture = active.current; if (!gesture || gesture.pointer !== event.pointerId) return
              move(event); active.current = null; setPreview(null)
              if (!gesture.started && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) {
                if (gesture.free) setPeek(previous => ({ ...previous, [id]: true }))
                else void tx.present({ open: gesture.compact ? true : !state.open }, id)
              } else if (gesture.started && !gesture.compact) {
                void tx.present(gesture.next, id)
                if (gesture.free) { setPeek(previous => ({ ...previous, [id]: true })); if (!inside.current.has(id)) hover(id, false) }
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            },
            onPointerCancel: cancel, onLostPointerCapture: cancel,
            onKeyDown(event: KeyboardEvent<HTMLElement>) {
              if (event.key === 'Escape' && active.current) { event.preventDefault(); event.stopPropagation(); cancel() }
              if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && !active.current && !tx.saving && !tx.recovery && !tx.gestureActive) {
                event.preventDefault(); event.stopPropagation()
                if (free) setPeek(previous => ({ ...previous, [id]: true }))
                else void tx.present({ open: compact ? true : !state.open }, id)
              }
            }
          }
        }
      }
    }
  }
}
