import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { REGION_POLICY, regionBounds, regionSize } from './region-policy.ts'
import type { RegionKind } from './region-policy.ts'
import { CHROME_LIMITS, defaultChrome } from '../../../shared/workbench/chrome.ts'
import type { WorkbenchChrome } from '../../../shared/workbench/chrome.ts'

/** Confirmed chrome is independent of widget geometry. Held previews and forced
 * edit visibility stay local until an accepted user intention is recorded.
 */
export function useRegions(forced = false, confirmed: WorkbenchChrome = defaultChrome(), commit?: (chrome: WorkbenchChrome) => Promise<boolean>) {
  // The native window minimum can contain the approved initial chrome. Avoid a
  // fictitious zero-size first frame starting collapse/reopen animations.
  const area = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 1024, height: 768 })
  const [requested, setRequested] = useState(() => ({ sidebar: confirmed.sidebar.size, bottom: confirmed.bottom.size }))
  const [collapsed, setCollapsed] = useState(() => ({ sidebar: !confirmed.sidebar.visible, bottom: !confirmed.bottom.visible }))
  const canonical = useRef(confirmed); canonical.current = confirmed
  const changeEpoch = useRef(0)
  const [peek, setPeek] = useState(false), [floating, setFloating] = useState(false), [resizing, setResizing] = useState<RegionKind | null>(null)
  const [bottomReveal, setBottomReveal] = useState<number | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null), blockPeek = useRef(false)
  const keyboard = useRef<{ kind: RegionKind; requested: number; collapsed: boolean } | null>(null)
  const active = useRef<{ kind: RegionKind; pointer: number; x: number; y: number; original: number; requested: number; collapsed: boolean; gestureCollapsed: boolean; started: boolean; target: HTMLDivElement; preview: { size: number; collapsed: boolean; reveal: number | null } } | null>(null)
  function synchronize() {
    setRequested({ sidebar: canonical.current.sidebar.size, bottom: canonical.current.bottom.size })
    setCollapsed({ sidebar: !canonical.current.sidebar.visible, bottom: !canonical.current.bottom.visible })
  }
  function publish(kind: RegionKind, value: number, visible: boolean) {
    if (!commit) return
    const ticket = ++changeEpoch.current, policy = CHROME_LIMITS[kind]
    const chrome = { ...canonical.current, [kind]: { size: Math.max(policy.min, Math.min(policy.max, value)), visible: forced ? canonical.current[kind].visible : visible } }
    if (JSON.stringify(chrome) === JSON.stringify(canonical.current)) return
    void commit(chrome).then(ok => { if (!ok && ticket === changeEpoch.current) synchronize() })
  }
  function commitKeyboard() {
    const previous = keyboard.current; keyboard.current = null
    if (previous) publish(previous.kind, requested[previous.kind], !collapsed[previous.kind])
  }
  useLayoutEffect(() => { if (!active.current && !keyboard.current) synchronize() }, [confirmed.sidebar.size, confirmed.sidebar.visible, confirmed.bottom.size, confirmed.bottom.visible])
  useLayoutEffect(() => { cancel(); keyboard.current = null; synchronize() }, [forced])
  function cancel() {
    const a = active.current; if (!a) return
    active.current = null
    changeEpoch.current++
    setResizing(null)
    setBottomReveal(null)
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
  useLayoutEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])
  useLayoutEffect(() => {
    const blur = () => {
      cancel()
      const previous = keyboard.current; keyboard.current = null
      if (previous) { setRequested(value => ({ ...value, [previous.kind]: previous.requested })); setCollapsed(value => ({ ...value, [previous.kind]: previous.collapsed })) }
    }
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [])
  const bounds = { sidebar: regionBounds('sidebar', size.width), bottom: regionBounds('bottom', size.height) }
  const sidebar = collapsed.sidebar && !forced ? 0 : regionSize(requested.sidebar, bounds.sidebar)
  const bottom = bottomReveal ?? (collapsed.bottom && !forced ? 0 : regionSize(requested.bottom, bounds.bottom))
  function set(kind: RegionKind, value: number) {
    const next = regionSize(value, bounds[kind])
    setRequested(prev => regionSize(prev[kind], bounds[kind]) === next ? prev : { ...prev, [kind]: next })
  }
  function handlers(kind: RegionKind) {
    function previewPointer(event: PointerEvent<HTMLDivElement>) {
      const a = active.current; if (!a || a.kind !== kind || a.pointer !== event.pointerId) return
      const value = a.original + (kind === 'sidebar' ? event.clientX - a.x : a.y - event.clientY)
      if (!a.started && Math.abs(value - a.original) < 4) return
      a.started = true
      setResizing(kind)
      if (kind === 'bottom' && a.collapsed && !forced) {
        const reveal = Math.max(0, Math.min(bounds.bottom.max, value))
        a.preview = { size: reveal > 0 ? Math.max(bounds.bottom.min, reveal) : a.requested, collapsed: reveal === 0, reveal }
        setBottomReveal(reveal); setCollapsed(prev => ({ ...prev, bottom: reveal === 0 })); return
      }
      if (a.gestureCollapsed && value < bounds[kind].min) return
      const collapse = !forced && value < bounds[kind].min - REGION_POLICY.collapseDistance
      a.gestureCollapsed = collapse
      a.preview = { size: regionSize(value, bounds[kind]), collapsed: collapse, reveal: null }
      if (collapse && kind === 'sidebar') setFloating(false)
      setCollapsed(prev => ({ ...prev, [kind]: collapse })); set(kind, value)
    }
    return {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || active.current) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        keyboard.current = null
        active.current = { kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, original: kind === 'sidebar' ? sidebar : bottom, requested: requested[kind], collapsed: collapsed[kind], gestureCollapsed: false, started: false, target: event.currentTarget, preview: { size: requested[kind], collapsed: collapsed[kind], reveal: null } }
      },
      onPointerMove: previewPointer,
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (active.current?.kind !== kind || active.current.pointer !== event.pointerId) return
        const a = active.current
        // Pointer-up owns the final intention even when React has not painted
        // the last coalesced move. Never publish a stale render's request.
        previewPointer(event)
        active.current = null; setResizing(null)
        if (kind === 'bottom' && a.preview.reveal !== null) {
          if (a.preview.reveal > 0) set('bottom', a.preview.size)
          setCollapsed(prev => ({ ...prev, bottom: a.preview.collapsed })); setBottomReveal(null)
        }
        if (!a.started && Math.abs(event.clientX - a.x) + Math.abs(event.clientY - a.y) < 4 && !forced) {
          if (kind === 'bottom' && a.collapsed) set('bottom', bounds.bottom.min)
          setCollapsed(prev => ({ ...prev, [kind]: !a.collapsed }))
          publish(kind, kind === 'bottom' && a.collapsed ? bounds.bottom.min : requested[kind], a.collapsed)
        } else {
          publish(kind, a.preview.size, !a.preview.collapsed)
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
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
        if (['Enter', ' '].includes(event.key)) {
          event.preventDefault()
          if (!forced) { keyboard.current = null; if (kind === 'bottom' && collapsed.bottom) set('bottom', bounds.bottom.min); setCollapsed(prev => ({ ...prev, [kind]: !prev[kind] })); publish(kind, kind === 'bottom' && collapsed.bottom ? bounds.bottom.min : requested[kind], collapsed[kind]) }
          return
        }
        if (['Home', 'End'].includes(event.key)) {
          event.preventDefault(); keyboard.current ??= { kind, requested: requested[kind], collapsed: collapsed[kind] }
          set(kind, event.key === 'Home' ? bounds[kind].min : bounds[kind].max); setCollapsed(prev => ({ ...prev, [kind]: false })); return
        }
        if (!arrows.includes(event.key)) return
        event.preventDefault(); if (active.current) return
        keyboard.current ??= { kind, requested: requested[kind], collapsed: collapsed[kind] }
        const delta = (event.key === arrows[0] ? -1 : 1) * (event.shiftKey ? REGION_POLICY.shiftStep : REGION_POLICY.step)
        if (collapsed[kind] && delta > 0) { if (kind === 'bottom') set('bottom', bounds.bottom.min); setCollapsed(prev => ({ ...prev, [kind]: false })); return }
        const value = (kind === 'sidebar' ? sidebar : bottom) + delta
        if (!forced && value < bounds[kind].min - 5) setCollapsed(prev => ({ ...prev, [kind]: true }))
        else { setCollapsed(prev => ({ ...prev, [kind]: false })); set(kind, value) }
      },
      onBlur: commitKeyboard
    }
  }
  return { area, sidebar, bottom, bounds, collapsed: forced ? { sidebar: false, bottom: false } : collapsed, splitter: REGION_POLICY.splitter, handlers,
    resizing, floating: !forced && collapsed.sidebar && floating, bottomRevealing: bottomReveal !== null, sidebarMode: forced || !collapsed.sidebar ? 'docked' : peek ? 'peek' : 'hidden',
    contentWidth: regionSize(requested.sidebar, bounds.sidebar),
    contentHeight: regionSize(requested.bottom, bounds.bottom),
    toggle(kind: RegionKind) { if (forced) return; blockPeek.current = true; setPeek(false); if (kind === 'sidebar') setFloating(false); setCollapsed(prev => ({ ...prev, [kind]: !prev[kind] })); publish(kind, requested[kind], collapsed[kind]) },
    closePeek() { setPeek(false) },

    revealSidebar() { if (forced || !collapsed.sidebar) return; if (hoverTimer.current) clearTimeout(hoverTimer.current); blockPeek.current = false; setFloating(true); setPeek(true) },
    hover(inside: boolean) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (forced || !collapsed.sidebar) return
      if (inside && !blockPeek.current) hoverTimer.current = setTimeout(() => { setFloating(true); setPeek(true) }, 100)
      else if (!inside) { blockPeek.current = false; hoverTimer.current = setTimeout(() => { if (!area.current?.querySelector('.host-sidebar-content:focus-within')) setPeek(false) }, 280) }
    },
    cancel, commitKeyboard, active: () => !!active.current,
    expand(kind: RegionKind) { set(kind, bounds[kind].max); setCollapsed(prev => ({ ...prev, [kind]: false })); publish(kind, bounds[kind].max, true) },
    reopen(kind: RegionKind) { setCollapsed(prev => ({ ...prev, [kind]: false })); publish(kind, requested[kind], true) } }
}
