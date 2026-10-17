import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { REGION_POLICY, regionBounds, regionSize } from './region-policy.ts'
import type { RegionKind } from './region-policy.ts'

/** Peer dimensions are CSS pixels and session-only, independent of widget geometry. */
export function useRegions() {
  const area = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 })
  const [requested, setRequested] = useState<{ sidebar: number; bottom: number }>({ sidebar: REGION_POLICY.sidebar.initial, bottom: REGION_POLICY.bottom.initial })
  const [collapsed, setCollapsed] = useState({ sidebar: false, bottom: false })
  const keyboard = useRef<{ kind: RegionKind; requested: number; collapsed: boolean } | null>(null)
  const active = useRef<{ kind: RegionKind; pointer: number; x: number; y: number; original: number; requested: number; collapsed: boolean; target: HTMLDivElement } | null>(null)
  function cancel() {
    const a = active.current; if (!a) return
    active.current = null
    // Restore the request, even when the current viewport can only render a smaller size.
    setRequested(prev => ({ ...prev, [a.kind]: a.requested }))
    setCollapsed(prev => ({ ...prev, [a.kind]: a.collapsed }))
    if (a.target.hasPointerCapture(a.pointer)) a.target.releasePointerCapture(a.pointer)
  }
  useLayoutEffect(() => {
    const element = area.current; if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      cancel()
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  const bounds = { sidebar: regionBounds('sidebar', size.width), bottom: regionBounds('bottom', size.height) }
  const sidebar = collapsed.sidebar ? 0 : regionSize(requested.sidebar, bounds.sidebar), bottom = collapsed.bottom ? 0 : regionSize(requested.bottom, bounds.bottom)
  function set(kind: RegionKind, value: number) {
    const next = regionSize(value, bounds[kind])
    setRequested(prev => regionSize(prev[kind], bounds[kind]) === next ? prev : { ...prev, [kind]: next })
  }
  function handlers(kind: RegionKind) {
    return {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || active.current) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        keyboard.current = null
        active.current = { kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, original: kind === 'sidebar' ? sidebar : bottom, requested: requested[kind], collapsed: collapsed[kind], target: event.currentTarget }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const a = active.current; if (!a || a.kind !== kind || a.pointer !== event.pointerId) return
        const value = a.original + (kind === 'sidebar' ? event.clientX - a.x : a.y - event.clientY)
        if (value < bounds[kind].min - 20) {
          setCollapsed(prev => ({ ...prev, [kind]: true })); setRequested(prev => ({ ...prev, [kind]: a.requested }))
        } else { setCollapsed(prev => ({ ...prev, [kind]: false })); set(kind, value) }
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (active.current?.kind !== kind || active.current.pointer !== event.pointerId) return
        active.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel(event: PointerEvent<HTMLDivElement>) { if (active.current?.kind === kind && active.current.pointer === event.pointerId) cancel() },
      onLostPointerCapture(event: PointerEvent<HTMLDivElement>) { if (active.current?.kind === kind && active.current.pointer === event.pointerId) cancel() },
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape' && active.current) {
          event.preventDefault(); event.stopPropagation(); cancel()
          return
        }
        const arrows = kind === 'sidebar' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowDown', 'ArrowUp']
        if (event.key === 'Escape' && keyboard.current?.kind === kind) {
          event.preventDefault(); event.stopPropagation()
          const previous = keyboard.current; keyboard.current = null
          setRequested(prev => ({ ...prev, [kind]: previous.requested })); setCollapsed(prev => ({ ...prev, [kind]: previous.collapsed })); return
        }
        if (event.key === 'Home') {
          event.preventDefault(); keyboard.current ??= { kind, requested: requested[kind], collapsed: collapsed[kind] }
          setCollapsed(prev => ({ ...prev, [kind]: true })); return
        }
        if (!arrows.includes(event.key)) return
        event.preventDefault(); if (active.current) return
        keyboard.current ??= { kind, requested: requested[kind], collapsed: collapsed[kind] }
        const delta = (event.key === arrows[0] ? -1 : 1) * (event.shiftKey ? REGION_POLICY.shiftStep : REGION_POLICY.step)
        const value = (kind === 'sidebar' ? sidebar : bottom) + delta
        if (value < bounds[kind].min - 5) setCollapsed(prev => ({ ...prev, [kind]: true }))
        else { setCollapsed(prev => ({ ...prev, [kind]: false })); set(kind, value) }
      },
      onBlur() { keyboard.current = null }
    }
  }
  return { area, sidebar, bottom, bounds, collapsed, splitter: REGION_POLICY.splitter, handlers,
    reopen(kind: RegionKind) { setCollapsed(prev => ({ ...prev, [kind]: false })) } }
}
