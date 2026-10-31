import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Transaction } from '../freeform/useTransaction.ts'

/** Pointer-owned rail order/archived restore. Provisional DOM order is restored
 * before one host command; no native HTML drag image or per-view execution.
 */
export function useBarReorder(list: RefObject<HTMLDivElement | null>, enabled: boolean, move: (id: string, before: string | null) => void, transaction: Transaction) {
  type Gesture = { id: string; node: HTMLElement | null; order: HTMLElement[]; pointer: number; x: number; y: number; px: number; py: number; offset: number; style: string | null; started: boolean; ghost: HTMLElement | null; panel: HTMLElement | null }
  const command = useRef(move); command.current = move
  const owner = useRef(transaction); owner.current = transaction
  const [zone, setZone] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const restore = useRef<((event: ReactPointerEvent<HTMLButtonElement>, id: string, label: string) => void) | null>(null)
  useLayoutEffect(() => {
    const candidate = list.current, scrollOwner = candidate?.closest<HTMLElement>('.sidebar-rail-tools'), shell = candidate?.closest<HTMLElement>('.workbench')
    if (!candidate || !scrollOwner || !shell || !enabled) { restore.current = null; return }
    const root = candidate, area = scrollOwner, workbench = shell
    let gesture: Gesture | null = null, frame = 0, suppressed = false, disposed = false
    const animations = new Map<HTMLElement, Animation>()
    const nodes = () => [...root.querySelectorAll<HTMLElement>(':scope > [data-sidebar-custom]')]
    const snapshot = () => new Map(nodes().map(node => [node, node.getBoundingClientRect()]))
    const inside = (x: number, y: number) => { const r = area.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom }
    function animate(before: Map<HTMLElement, DOMRect>, skip?: HTMLElement) {
      if (disposed || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      for (const node of nodes()) {
        animations.get(node)?.cancel(); const old = before.get(node), next = node.getBoundingClientRect()
        if (!old || node === skip || Math.abs(old.top - next.top) < .5) continue
        const animation = node.animate([{ transform: `translateY(${old.top - next.top}px)` }, { transform: 'translateY(0)' }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' })
        animations.set(node, animation); void animation.finished.catch(() => undefined).then(() => { if (animations.get(node) === animation) animations.delete(node) })
      }
    }
    function update() {
      const g = gesture; if (!g?.started) return
      if (g.node) {
        const before = snapshot(), top = root.getBoundingClientRect().top
        const next = nodes().find(node => node !== g.node && g.py < top + node.offsetTop + node.offsetHeight / 2) ?? null
        if (g.node.nextElementSibling !== next) { root.insertBefore(g.node, next); animate(before, g.node) }
        g.node.style.removeProperty('transform'); const natural = g.node.getBoundingClientRect().top
        g.node.style.transform = `translateY(${g.py - g.offset - natural}px)`
      } else if (g.ghost) { g.ghost.style.left = `${g.px + 14}px`; g.ghost.style.top = `${g.py + 12}px` }
      workbench.querySelector('[data-layout-rail-zone]')?.toggleAttribute('data-over', inside(g.px, g.py))
    }
    function tick() {
      frame = 0; const g = gesture; if (!g?.started || !inside(g.px, g.py)) return
      const r = area.getBoundingClientRect(), speed = g.py < r.top + 24 ? -8 : g.py > r.bottom - 24 ? 8 : 0
      if (!speed) return
      const before = area.scrollTop; area.scrollTop += speed; update()
      if (area.scrollTop !== before) frame = requestAnimationFrame(tick)
    }
    function finish(cancel = false) {
      const g = gesture; if (!g) return
      if (!g.started) {
        // Native click synthesis requires the pressed node to remain in place.
        // A short press owns no provisional order or transaction to restore.
        gesture = null
        if (!g.node && document.body.hasPointerCapture(g.pointer)) document.body.releasePointerCapture(g.pointer)
        g.ghost?.remove()
        return
      }
      const before = snapshot(), next = g.node ? g.node.nextElementSibling?.getAttribute('data-sidebar-custom') ?? null : nodes().find(node => g.py < node.getBoundingClientRect().top + node.offsetHeight / 2)?.dataset.sidebarCustom ?? null
      gesture = null; cancelAnimationFrame(frame); setZone(null); workbench.removeAttribute('data-sidebar-bar-dragging'); g.panel?.removeAttribute('data-bar-library-dragging')
      const capture = g.node ? root : document.body
      if (capture.hasPointerCapture(g.pointer)) capture.releasePointerCapture(g.pointer)
      if (g.node) { g.node.removeAttribute('data-rail-dragging'); if (g.style === null) g.node.removeAttribute('style'); else g.node.setAttribute('style', g.style); for (const node of g.order) root.append(node) }
      g.ghost?.remove(); workbench.querySelector('[data-layout-rail-zone]')?.removeAttribute('data-over')
      suppressed = true
      if (!cancel && inside(g.px, g.py)) { command.current(g.id, next); owner.current.finishGesture() }
      else owner.current.cancelGesture()
      if (!disposed) requestAnimationFrame(() => animate(before))
    }
    const down = (event: PointerEvent) => {
      suppressed = false
      const node = (event.target as Element).closest<HTMLElement>('[data-sidebar-custom]')
      if (!node || event.button || gesture) return
      animations.get(node)?.cancel(); const r = node.getBoundingClientRect()
      gesture = { id: node.dataset.sidebarCustom!, node, order: nodes(), pointer: event.pointerId, x: event.clientX, y: event.clientY, px: event.clientX, py: event.clientY, offset: event.clientY - r.top, style: node.getAttribute('style'), started: false, ghost: null, panel: null }
    }
    restore.current = (event, id, label) => {
      if (event.button || gesture) return
      suppressed = false; event.preventDefault(); document.body.setPointerCapture(event.pointerId)
      const ghost = document.createElement('div'); ghost.className = 'bar-library-drag-ghost'; ghost.setAttribute('popover', 'manual'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true; ghost.textContent = label
      gesture = { id, node: null, order: nodes(), pointer: event.pointerId, x: event.clientX, y: event.clientY, px: event.clientX, py: event.clientY, offset: 0, style: null, started: false, ghost, panel: event.currentTarget.closest<HTMLElement>('.sidebar-bars-library') }
    }
    const pointermove = (event: PointerEvent) => {
      const g = gesture; if (!g || event.pointerId !== g.pointer) return
      g.px = event.clientX; g.py = event.clientY
      if (!g.started) {
        if (Math.hypot(g.px - g.x, g.py - g.y) < (g.node ? 4 : 5)) return
        g.started = true; owner.current.beginGesture(); workbench.setAttribute('data-sidebar-bar-dragging', '')
        const rail = area.getBoundingClientRect(), workArea = workbench.querySelector('.work-area')!.getBoundingClientRect()
        setZone({ left: rail.left - workArea.left + 2, top: rail.top - workArea.top + 2, width: Math.max(0, rail.width - 4), height: Math.max(0, rail.height - 4) })
        if (g.node) { root.setPointerCapture(g.pointer); g.node.setAttribute('data-rail-dragging', '') }
        else { g.panel?.setAttribute('data-bar-library-dragging', ''); document.body.append(g.ghost!); g.ghost!.showPopover() }
      }
      event.preventDefault(); update(); if (!frame) frame = requestAnimationFrame(tick)
    }
    const up = (event: PointerEvent) => { if (gesture?.pointer === event.pointerId) { gesture.px = event.clientX; gesture.py = event.clientY; finish() } }
    const cancel = () => finish(true), click = (event: MouseEvent) => { if (suppressed) { suppressed = false; event.preventDefault(); event.stopImmediatePropagation() } }
    const newIntention = () => { suppressed = false }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopImmediatePropagation(); finish(true) } }
    root.addEventListener('pointerdown', down); root.addEventListener('lostpointercapture', cancel); document.body.addEventListener('lostpointercapture', cancel)
    window.addEventListener('pointerdown', newIntention, true)
    window.addEventListener('pointermove', pointermove, { capture: true, passive: false }); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true); window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('click', click, true); window.addEventListener('keydown', key, true)
    return () => { disposed = true; finish(true); restore.current = null; for (const animation of animations.values()) animation.cancel(); root.removeEventListener('pointerdown', down); root.removeEventListener('lostpointercapture', cancel); document.body.removeEventListener('lostpointercapture', cancel); window.removeEventListener('pointerdown', newIntention, true); window.removeEventListener('pointermove', pointermove, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true) }
  }, [enabled])
  return { zone, restore(event: ReactPointerEvent<HTMLButtonElement>, id: string, label: string) { restore.current?.(event, id, label) } }
}
