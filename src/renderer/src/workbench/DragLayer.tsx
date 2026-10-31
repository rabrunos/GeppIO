import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'

type Box = { left: number; top: number; width: number; height: number }
export interface DragPicture {
  key: number; typeId: string; viewId: string | null; sourceBar: string | null; catalog: boolean;
  source: HTMLElement | null; tile: HTMLElement; origin: Box; width: number; height: number;
  started: number; originClip: string;
  released: boolean; accepted: boolean
}
const EASING = 'cubic-bezier(.2,.8,.2,1)'
type Pointer = { x: number; y: number }
type Controller = { wake(): void; flush(): void }
function progress(elapsed: number) {
  let lo = 0, hi = 1
  const bezier = (u: number, p: number, q: number) => 3 * (1 - u) ** 2 * u * p + 3 * (1 - u) * u ** 2 * q + u ** 3
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (bezier(mid, .2, .2) < elapsed) lo = mid; else hi = mid }
  return elapsed === 1 ? 1 : bezier((lo + hi) / 2, .8, 1)
}
/** Only a visual snapshot leaves the region. The actual view, its inputs and
 * the App-owned plugin runtime stay mounted with their original identity. */
export function useDragVisual() {
  const [picture, setPicture] = useState<DragPicture | null>(null), live = useRef(picture), serial = useRef(0), queue = useRef<(() => void)[]>([])
  const pointer = useRef<Pointer>({ x: 0, y: 0 }), controller = useRef<Controller | null>(null)
  const measure = useRef<((pointer: Pointer) => boolean) | null>(null)
  function put(next: DragPicture | null) { live.current = next; setPicture(next) }
  function begin(typeId: string, viewId: string | null, sourceBar: string | null, tile: HTMLElement, source: HTMLElement | null, catalog: boolean, x: number, y: number) {
    const box = source?.getBoundingClientRect(), visible = !!source && !source.hidden && !!box?.width && !!box.height
    const origin = visible ? box! : tile.getBoundingClientRect()
    pointer.current = { x, y }
    put({ key: ++serial.current, typeId, viewId, sourceBar, catalog, source, tile, origin,
      width: catalog ? Math.min(280, Math.max(210, visible ? box!.width : 238)) : origin.width,
      height: catalog ? Math.min(260, Math.max(150, visible ? box!.height : 200)) : origin.height,
      started: performance.now(), originClip: source?.style.clipPath ?? '', released: false, accepted: false })
    document.documentElement.dataset.layoutDragging = ''
  }
  function move(x: number, y: number) { if (live.current && !live.current.released) { pointer.current = { x, y }; controller.current?.wake() } }
  function release(accepted: boolean, viewId?: string) { const p = live.current; if (p && !p.released) { controller.current?.flush(); put({ ...p, viewId: viewId ?? p.viewId, released: true, accepted }); delete document.documentElement.dataset.layoutDragging } }
  function complete() { put(null); delete document.documentElement.dataset.layoutDragging; const pending = queue.current.splice(0); pending.forEach(run => run()) }
  useLayoutEffect(() => () => { delete document.documentElement.dataset.layoutDragging; queue.current = [] }, [])
  return { picture, pointer, controller, measure, begin, move, release, complete, active: () => !!live.current, after(run: () => void) { if (live.current?.released) queue.current.push(run); else if (!live.current) run() } }
}

export function DragLayer({ picture: p, label, children, complete, pointer, controller, measure }: { picture: DragPicture; label: string; children: ReactNode; complete(): void; pointer: RefObject<Pointer>; controller: RefObject<Controller | null>; measure: RefObject<((pointer: Pointer) => boolean) | null> }) {
  const layer = useRef<HTMLDivElement>(null), node = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), labelNode = useRef<HTMLSpanElement>(null)
  const labelSize = useRef({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const host = content.current!, source = p.source
    if (source) {
      const clone = source.cloneNode(true) as HTMLElement
      // Inert pictures never participate in identity, focus, commands or tests.
      for (const element of [clone, ...clone.querySelectorAll('*')]) for (const name of element.getAttributeNames()) {
        if (name === 'id' || name === 'for' || name === 'hidden' || name === 'inert' || name.startsWith('aria-') || name.startsWith('data-')) element.removeAttribute(name)
      }
      const fields = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')
      clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select').forEach((field, index) => { field.value = fields[index]!.value; if (field instanceof HTMLInputElement && fields[index] instanceof HTMLInputElement) field.checked = fields[index].checked })
      clone.querySelectorAll('.layout-widget-grip,.layout-widget-remove,.widget-swap-control,.resize-zone').forEach(control => control.remove())
      clone.classList.remove('widget-frame', 'editing', 'selected', 'invalid'); clone.classList.add('drag-picture-content')
      clone.removeAttribute('style'); clone.inert = true; clone.setAttribute('aria-hidden', 'true'); host.replaceChildren(clone)
    }
    layer.current!.showPopover()
    return () => { if (layer.current?.matches(':popover-open')) layer.current.hidePopover() }
  }, [p.key])
  useLayoutEffect(() => {
    const rect = labelNode.current!.getBoundingClientRect(); labelSize.current = { width: rect.width, height: rect.height }
  }, [p.key, label])
  useLayoutEffect(() => {
    const element = node.current!, caption = labelNode.current!
    let frame = 0, flight: Animation | null = null, canceled = false
    function paint(now: number) {
      frame = 0
      const state = pointer.current, size = labelSize.current, elapsed = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min(1, (now - p.started) / 220), value = progress(elapsed)
      const x = p.origin.left + (state.x - 4 - p.origin.left) * value, y = p.origin.top + (state.y - 4 - p.origin.top) * value
      const scrolling = measure.current?.(state)
      element.style.transform = `translate3d(${x}px,${y}px,0)`
      caption.style.left = Math.max(8, Math.min(innerWidth - size.width - 8, state.x + 12)) + 'px'
      caption.style.top = Math.max(8, state.y - size.height - 12) + 'px'
      if (elapsed < 1 || scrolling) frame = requestAnimationFrame(paint)
    }
    if (!p.released) {
      controller.current = { wake() { if (!frame) frame = requestAnimationFrame(paint) }, flush() { cancelAnimationFrame(frame); frame = 0; paint(performance.now()) } }
      paint(performance.now())
    }
    else {
      caption.hidden = true
      // Transaction geometry is committed before this next read. Measure once;
      // the completion animation changes geometry, never nonuniform scale.
      frame = requestAnimationFrame(() => {
        const frameNode = p.viewId ? document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(p.viewId)}"]`) : [...document.querySelectorAll<HTMLElement>('.widget-frame')].find(element => element.dataset.modelId === `model:${p.typeId}` && !element.hidden)
        const returningToBar = p.sourceBar && document.querySelector('.workbench')?.getAttribute('data-active-bar') !== p.sourceBar
        const target = p.accepted ? frameNode : returningToBar ? document.querySelector<HTMLElement>(`[data-bar-id="${CSS.escape(p.sourceBar!)}"]`) : p.catalog && (!p.source || p.source.hidden) ? p.tile : p.source
        const to = target?.getBoundingClientRect() ?? p.origin, from = element.getBoundingClientRect()
        const shrink = !p.accepted && (target === p.tile || returningToBar)
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) { complete(); return }
        flight = element.animate(shrink ? [
          { transform: `translate(${from.left}px,${from.top}px) scale(1)`, opacity: 1 },
          { transform: `translate(${to.left}px,${to.top}px) scale(${Math.min(to.width / p.width, to.height / p.height)})`, opacity: .15 }
        ] : [
          { transform: `translate(${from.left}px,${from.top}px)`, width: from.width + 'px', height: from.height + 'px' },
          { transform: `translate(${to.left}px,${to.top}px)`, width: to.width + 'px', height: to.height + 'px' }
        ], { duration: shrink ? 220 : 240, easing: EASING, fill: 'forwards' })
        void flight.finished.then(() => { if (!canceled) complete() }).catch(() => {})
      })
    }
    return () => { canceled = true; controller.current = null; cancelAnimationFrame(frame); flight?.cancel() }
  }, [p.key, p.released])
  return <div ref={layer} className="layout-drag-layer" popover="manual" aria-hidden="true" inert><div ref={node} className={p.released ? 'layout-flight-context drag-picture-flight' : 'layout-drag-node'} style={{ '--layout-drag-width': p.width + 'px', '--layout-drag-height': p.height + 'px', width: p.width, height: p.height } as CSSProperties}><div ref={content} className="drag-picture-content">{!p.source && children}</div></div><span ref={labelNode} className="layout-drag-label">{label}</span></div>
}
