import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import { activePlacements } from '../../../shared/workbench/model.ts'
import { resizePair } from '../../../shared/workbench/commands.ts'
import type { Transaction } from '../freeform/useTransaction.ts'
import type { Surfaces } from '../freeform/useSurfaces.ts'
import { useLocale } from './Locale.tsx'

type Pair = { first: string; second: string; axis: 'x' | 'y' }
export function PairDividers({ tx, registry, view, surfaces, preview, snap, suspendMain = false }: { suspendMain?: boolean; tx: Transaction; registry: Registry; view: WorkbenchSnapshot; surfaces: Surfaces; preview(value: WorkbenchSnapshot | null): void; snap: boolean }) {
  const { t } = useLocale(), [active, setActive] = useState<string | null>(null)
  const [guide, setGuide] = useState<{ left: number; top: number; height: number; zIndex: number } | null>(null), snapped = useRef(false)
  const gesture = useRef<{ pair: Pair; source: WorkbenchSnapshot; delta: number; x: number; y: number; pointer: number; scale: number; target: HTMLButtonElement } | null>(null)
  const frame = useRef(0), latest = useRef({ x: 0, y: 0 })
  const pairs: Pair[] = []
  const visible = activePlacements(view), layers = { main: 16, bottom: 36, sidebar: 42 }
  for (const a of visible) for (const b of visible) {
    if (a.id === b.id || a.region !== b.region || (suspendMain && a.region === 'main')) continue
    if (a.region !== 'sidebar' && Math.abs(b.x - a.x - a.width - 10) < .1 && a.y < b.y + b.height && b.y < a.y + a.height) pairs.push({ first: a.id, second: b.id, axis: 'x' })
    if (a.region !== 'bottom' && Math.abs(b.y - a.y - a.height - 10) < .1 && a.x < b.x + b.width && b.x < a.x + a.width) pairs.push({ first: a.id, second: b.id, axis: 'y' })
  }
  function update() {
    frame.current = 0
    const a = gesture.current; if (!a) return
    let delta = (a.pair.axis === 'x' ? latest.current.x - a.x : latest.current.y - a.y) * a.scale
    if (snap && a.pair.axis === 'x') {
      const first = a.source.placements.find(p => p.id === a.pair.first)!, second = a.source.placements.find(p => p.id === a.pair.second)!
      const centerDelta = (first.width + second.width) / 2 - first.width, distance = Math.abs(delta - centerDelta) / a.scale
      snapped.current = distance <= (snapped.current ? 14 : 7)
      if (snapped.current) delta = centerDelta
    } else snapped.current = false
    const next = resizePair(a.source, registry, { kind: 'resizePair', ...a.pair, delta })
    if (next) {
      a.delta = delta; if (tx.editing) tx.put(next); else preview(next)
      const first = view.placements.find(p => p.id === a.pair.first)!, second = view.placements.find(p => p.id === a.pair.second)!, m = surfaces.measures[first.region]
      setGuide(snapped.current ? { left: m.left + (first.x + second.x + second.width) / 2 - m.scrollLeft, top: m.top + Math.max(first.y, second.y) - m.scrollTop, height: Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y), zIndex: layers[first.region] } : null)
    }
  }
  function end(cancel: boolean) {
    const a = gesture.current; if (!a) return
    cancelAnimationFrame(frame.current); frame.current = 0; gesture.current = null; setActive(null); setGuide(null); snapped.current = false
    if (tx.editing) { if (cancel) tx.cancelGesture(); else tx.finishGesture() }
    else { preview(null); if (!cancel && a.delta !== 0) void tx.commitPair({ kind: 'resizePair', ...a.pair, delta: a.delta }) }
    if (a.target.hasPointerCapture(a.pointer)) a.target.releasePointerCapture(a.pointer)
  }
  const geometry = Object.values(surfaces.measures).map(m => `${m.frameWidth},${m.frameHeight}`).join(';')
  useLayoutEffect(() => { end(true) }, [geometry])
  useLayoutEffect(() => () => { cancelAnimationFrame(frame.current) }, [])
  useLayoutEffect(() => { const cancel = () => end(true); window.addEventListener('blur', cancel); return () => window.removeEventListener('blur', cancel) }, [tx.editing])
  useLayoutEffect(() => { const root = surfaces.root.current?.closest<HTMLElement>('.workbench'); if (!root || !gesture.current) return; root.classList.add('is-widget-resizing'); root.dataset.widgetResizeAxis = gesture.current.pair.axis; return () => { root.classList.remove('is-widget-resizing'); delete root.dataset.widgetResizeAxis } }, [active])
  function start(event: PointerEvent<HTMLButtonElement>, pair: Pair) {
    if (event.button || gesture.current || tx.recovery || tx.saving) return
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId)
    const source = structuredClone(tx.editing ? view : tx.live.current), placement = source.placements.find(p => p.id === pair.first)!
    const dimension = pair.axis === 'x' ? 'width' : 'height'
    const sourcePair = resizePair(source, registry, { kind: 'resizePair', ...pair, delta: 0 })
    if (!sourcePair) { event.currentTarget.releasePointerCapture(event.pointerId); return }
    if (tx.editing) tx.beginGesture()
    gesture.current = { pair, source, delta: 0, x: event.clientX, y: event.clientY, pointer: event.pointerId, target: event.currentTarget,
      scale: tx.editing ? 1 : source.reference[placement.region][dimension] / view.reference[placement.region][dimension] }
    latest.current = { x: event.clientX, y: event.clientY }; setActive(pair.first + pair.second)
  }
  function keyResize(event: React.KeyboardEvent<HTMLButtonElement>, pair: Pair) {
    if (event.key === 'Escape') { event.stopPropagation(); end(true); return }
    const horizontal = pair.axis === 'x', negative = horizontal ? 'ArrowLeft' : 'ArrowUp', positive = horizontal ? 'ArrowRight' : 'ArrowDown'
    if (![negative, positive, 'Home', 'End'].includes(event.key) || gesture.current || tx.saving || tx.recovery) return
    event.preventDefault(); event.stopPropagation()
    const source = tx.editing ? view : tx.live.current, first = source.placements.find(p => p.id === pair.first)!, second = source.placements.find(p => p.id === pair.second)!, extent = horizontal ? 'width' : 'height'
    const firstType = registry.get(source.organization.views.find(v => v.id === first.id)!.typeId)!, secondType = registry.get(source.organization.views.find(v => v.id === second.id)!.typeId)!
    const delta = event.key === 'Home' ? firstType.constraint.min[extent] - first[extent] : event.key === 'End' ? second[extent] - secondType.constraint.min[extent] : (event.key === positive ? 1 : -1) * (first[extent] + second[extent]) * (event.shiftKey ? .1 : .02)
    const intent = { kind: 'resizePair' as const, ...pair, delta }, next = resizePair(source, registry, intent)
    if (next) { if (tx.editing) tx.action(next); else void tx.commitPair(intent) }
  }
  return <div className="host-pair-dividers">{guide && <div className="widget-center-guide" data-label={t('Centro')} aria-hidden="true" style={guide} />}{pairs.map(pair => {
    const a = view.placements.find(p => p.id === pair.first)!, b = view.placements.find(p => p.id === pair.second)!, m = surfaces.measures[a.region], horizontal = pair.axis === 'x'
    const left = m.left + (horizontal ? a.x + a.width : Math.max(a.x, b.x)) - m.scrollLeft, top = m.top + (horizontal ? Math.max(a.y, b.y) : a.y + a.height) - m.scrollTop
    const width = horizontal ? 10 : Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height = horizontal ? Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) : 10
    const right = m.left + (m.clipWidth ?? m.width), bottom = m.top + (m.clipHeight ?? m.height)
    const outside = left + width <= m.left || left >= right || top + height <= m.top || top >= bottom
    return <button key={pair.first + ':' + pair.second + pair.axis} className={'host-pair-divider ' + (horizontal ? 'vertical widget-width-splitter' : 'horizontal widget-height-splitter')} data-owner-region={a.region} data-active={active === pair.first + pair.second ? '' : undefined} data-pair-first={pair.first} data-pair-second={pair.second} data-pair-axis={pair.axis}
      inert={outside && active !== pair.first + pair.second} style={{ left, top, width, height, zIndex: layers[a.region], clipPath: `inset(${Math.max(0, m.top - top)}px ${Math.max(0, left + width - right)}px ${Math.max(0, top + height - bottom)}px ${Math.max(0, m.left - left)}px)` }}
      role="separator" aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuenow={horizontal ? a.width : a.height} aria-label={t('Redimensionar widgets em conjunto')} onPointerDown={event => start(event, pair)} onPointerMove={event => { if (!gesture.current) return; latest.current = { x: event.clientX, y: event.clientY }; if (!frame.current) frame.current = requestAnimationFrame(update) }}
      onPointerUp={event => { if (!gesture.current) return; latest.current = { x: event.clientX, y: event.clientY }; update(); end(false) }} onPointerCancel={() => end(true)} onLostPointerCapture={() => end(true)} onKeyDown={event => keyResize(event, pair)} />
  })}</div>
}
