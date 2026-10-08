import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clamp } from '../../../shared/grid/geometry.ts'

/** Peer dimensions are CSS pixels and session-only, independent of grid units. */
export function useRegions() {
  const area = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 })
  const [requested, setRequested] = useState({ sidebar: 215, bottom: 43 })
  const active = useRef<{ kind: 'sidebar' | 'bottom'; pointer: number; x: number; y: number; original: number } | null>(null)
  useEffect(() => {
    const element = area.current; if (!element) return
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }) })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  const maxSidebar = Math.max(0, size.width - 165), maxBottom = Math.max(0, size.height - 165)
  const sidebar = clamp(requested.sidebar, Math.min(160, maxSidebar), maxSidebar), bottom = clamp(requested.bottom, Math.min(43, maxBottom), maxBottom)
  function set(kind: 'sidebar' | 'bottom', value: number) {
    const max = kind === 'sidebar' ? maxSidebar : maxBottom, min = Math.min(kind === 'sidebar' ? 160 : 43, max)
    setRequested(prev => ({ ...prev, [kind]: clamp(value, min, max) }))
  }
  function handlers(kind: 'sidebar' | 'bottom') {
    return {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || active.current) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        active.current = { kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, original: kind === 'sidebar' ? sidebar : bottom }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const a = active.current; if (!a || a.pointer !== event.pointerId) return
        set(kind, a.original + (kind === 'sidebar' ? event.clientX - a.x : a.y - event.clientY))
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (active.current?.pointer !== event.pointerId) return
        active.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel() { const a = active.current; active.current = null; if (a) set(a.kind, a.original) },
      onLostPointerCapture() { const a = active.current; active.current = null; if (a) set(a.kind, a.original) },
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape' && active.current) {
          event.preventDefault(); event.stopPropagation(); const a = active.current; active.current = null; set(a.kind, a.original)
          if (event.currentTarget.hasPointerCapture(a.pointer)) event.currentTarget.releasePointerCapture(a.pointer)
          return
        }
        const arrows = kind === 'sidebar' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowDown', 'ArrowUp']
        if (!arrows.includes(event.key)) return
        event.preventDefault(); const delta = (event.key === arrows[0] ? -1 : 1) * (event.shiftKey ? 30 : 10)
        set(kind, (kind === 'sidebar' ? sidebar : bottom) + delta)
      }
    }
  }
  return { area, sidebar, bottom, maxSidebar, maxBottom, handlers }
}
