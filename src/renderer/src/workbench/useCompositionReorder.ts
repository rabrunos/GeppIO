import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Transaction } from '../freeform/useTransaction.ts'

/** Provisional card order never reaches storage/history until a valid release.
 * Native content/views are not involved; only the static library card is cloned.
 */
export function useCompositionReorder(list: RefObject<HTMLDivElement | null>, enabled: boolean, move: (id: string, before: string | null) => void, transaction: Transaction) {
  const callback = useRef(move); callback.current = move
  const owner = useRef(transaction); owner.current = transaction
  useLayoutEffect(() => {
    const root = list.current, viewport = root?.closest<HTMLElement>('[data-composition-scroll]'); if (!root || !viewport || !enabled) return
    type Gesture = { node: HTMLElement; id: string; button: HTMLElement; pointer: number; x: number; y: number; px: number; py: number; dx: number; dy: number; order: HTMLElement[]; preview: HTMLElement | null }
    let gesture: Gesture | null = null, frame = 0, suppressed = false
    const animations = new Set<Animation>()
    const nodes = () => [...root.querySelectorAll<HTMLElement>(':scope > [data-composition-card]')]
    const positions = () => new Map(nodes().map(node => [node, node.getBoundingClientRect()]))
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
    const inside = (node: HTMLElement, x: number, y: number) => { const r = node.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom }
    function animate(before: Map<HTMLElement, DOMRect>, skip: HTMLElement) {
      if (reduced()) return
      for (const node of nodes()) {
        const old = before.get(node), next = node.getBoundingClientRect(); if (!old || node === skip) continue
        const x = old.left - next.left, y = old.top - next.top; if (Math.hypot(x, y) < .5) continue
        const animation = node.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: 'translate(0,0)' }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' })
        animations.add(animation); void animation.finished.catch(() => undefined).then(() => animations.delete(animation))
      }
    }
    function update() {
      const g = gesture; if (!g?.preview) return
      g.preview.style.left = `${g.px - g.dx}px`; g.preview.style.top = `${g.py - g.dy}px`
      if (!inside(root!, g.px, g.py) || !inside(viewport!, g.px, g.py)) return
      const cards = nodes(), rect = root!.getBoundingClientRect()
      const target = cards.reduce((best, node, index) => {
        const distance = Math.hypot(g.px - rect.left - node.offsetLeft - node.offsetWidth / 2, g.py - rect.top - node.offsetTop - node.offsetHeight / 2)
        return distance < best.distance ? { index, distance } : best
      }, { index: 0, distance: Infinity }).index
      if (cards.indexOf(g.node) === target) return
      const before = positions(), peers = cards.filter(node => node !== g.node)
      root!.insertBefore(g.node, peers[target] ?? null); animate(before, g.node)
    }
    function tick() {
      frame = 0; const g = gesture; if (!g?.preview) return
      const r = viewport!.getBoundingClientRect(), speed = inside(viewport!, g.px, g.py) ? g.py < r.top + 24 ? -7 : g.py > r.bottom - 24 ? 7 : 0 : 0
      if (!speed) return
      const old = viewport!.scrollTop; viewport!.scrollTop += speed; update()
      if (viewport!.scrollTop !== old) frame = requestAnimationFrame(tick)
    }
    function finish(cancel = false, immediate = false) {
      const g = gesture; if (!g) return
      gesture = null; cancelAnimationFrame(frame); root!.removeAttribute('data-composition-reordering')
      if (root!.hasPointerCapture(g.pointer)) root!.releasePointerCapture(g.pointer)
      if (!g.preview) return
      suppressed = true
      const before = positions(), valid = !cancel && inside(root!, g.px, g.py) && inside(viewport!, g.px, g.py), next = g.node.nextElementSibling?.getAttribute('data-composition-card') ?? null
      for (const node of g.order) root!.append(node)
      if (valid) { callback.current(g.id, next); owner.current.finishGesture() }
      else owner.current.cancelGesture()
      if (immediate) { g.preview.remove(); g.node.removeAttribute('data-composition-dragging'); return }
      requestAnimationFrame(() => {
        animate(before, g.node)
        const from = g.preview!.getBoundingClientRect(), to = g.node.getBoundingClientRect()
        if (reduced() || !g.node.isConnected) { g.preview!.remove(); g.node.removeAttribute('data-composition-dragging'); return }
        const animation = g.preview!.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${to.left - from.left}px,${to.top - from.top}px)` }], { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })
        animations.add(animation); void animation.finished.catch(() => undefined).then(() => { animations.delete(animation); g.preview!.remove(); g.node.removeAttribute('data-composition-dragging') })
      })
    }
    const down = (event: PointerEvent) => {
      suppressed = false
      const button = (event.target as Element).closest<HTMLElement>('[data-composition-reorder]'), node = button?.closest<HTMLElement>('[data-composition-card]')
      if (!button || !node || event.button || gesture) return
      const r = node.getBoundingClientRect(); root!.setPointerCapture(event.pointerId)
      gesture = { node, button, id: node.dataset.compositionCard!, pointer: event.pointerId, x: event.clientX, y: event.clientY, px: event.clientX, py: event.clientY, dx: event.clientX - r.left, dy: event.clientY - r.top, order: nodes(), preview: null }
    }
    const pointermove = (event: PointerEvent) => {
      const g = gesture; if (!g || g.pointer !== event.pointerId) return
      g.px = event.clientX; g.py = event.clientY
      if (!g.preview) {
        if (Math.hypot(g.px - g.x, g.py - g.y) < 4) return
        owner.current.beginGesture()
        const preview = g.node.cloneNode(true) as HTMLElement, r = g.node.getBoundingClientRect()
        preview.removeAttribute('data-composition-card'); preview.removeAttribute('data-composition-id'); preview.classList.add('composition-drag-preview'); preview.inert = true
        for (const element of preview.querySelectorAll('[id]')) element.removeAttribute('id')
        preview.setAttribute('popover', 'manual'); preview.setAttribute('aria-hidden', 'true'); preview.style.width = `${r.width}px`; preview.style.height = `${r.height}px`
        root!.append(preview); preview.showPopover(); g.preview = preview; g.node.setAttribute('data-composition-dragging', ''); root!.setAttribute('data-composition-reordering', '')
      }
      event.preventDefault(); update(); if (!frame) frame = requestAnimationFrame(tick)
    }
    const up = () => finish(), cancel = () => finish(true)
    const click = (event: MouseEvent) => { if (suppressed) { suppressed = false; event.preventDefault(); event.stopImmediatePropagation() } }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture) { event.preventDefault(); event.stopImmediatePropagation(); finish(true) } }
    root.addEventListener('pointerdown', down); window.addEventListener('pointermove', pointermove, { passive: false }); window.addEventListener('pointerup', up)
    root.addEventListener('lostpointercapture', cancel); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel); root.addEventListener('click', click, true); window.addEventListener('keydown', key, true)
    return () => { finish(true, true); for (const animation of animations) animation.cancel(); root.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', pointermove); window.removeEventListener('pointerup', up); root.removeEventListener('lostpointercapture', cancel); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); root.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true) }
  }, [enabled])
}
