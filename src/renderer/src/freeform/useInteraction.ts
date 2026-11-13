import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { candidate } from '../../../shared/freeform/geometry.ts'
import { constraintsFor, POLICY } from '../../../shared/freeform/policy.ts'
import { activePlacements, constraintsForViews, sidebarInsertion, widgetRegistry } from '../../../shared/workbench/model.ts'
import type { Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import { reflow } from '../../../shared/freeform/reflow.ts'
import type { Result } from '../../../shared/freeform/reflow.ts'
import { settleSnapshot } from '../../../shared/freeform/settlement.ts'
import { projectRegion } from '../../../shared/freeform/projection.ts'
import { REGION_LABELS } from '../../../shared/freeform/transfer.ts'
import { moveView, reconcileBarHeights } from '../../../shared/workbench/commands.ts'
import { REGIONS } from '../../../shared/freeform/types.ts'
import type { Direction, Placement, Region, Surface } from '../../../shared/freeform/types.ts'
import type { Transaction } from './useTransaction.ts'
import type { Surfaces } from './useSurfaces.ts'
import { useDragVisual } from '../workbench/DragLayer.tsx'
import type { SlotIntention } from '../../../shared/workbench/slots.ts'
import { panelIds } from '../../../shared/workbench/presentations.ts'
import { alignedGesture } from '../../../shared/freeform/alignment.ts'
import { groupTransferPlan } from '../../../shared/workbench/groups.ts'
import type { AlignmentGuide, AlignmentLocks } from '../../../shared/freeform/alignment.ts'

interface Gesture {
  id: string; pointer: number; kind: 'move' | Direction; x: number; y: number; original: Placement; sourceBar: string;
  snapshot: WorkbenchSnapshot; source: WorkbenchSnapshot; target: HTMLElement; scrollX: number; scrollY: number;
  clientX: number; clientY: number; time: number; last: string; extension: number; directionX: number; preview: WorkbenchSnapshot | null
  alignment?: AlignmentLocks
}
export function useInteraction(tx: Transaction, view: WorkbenchSnapshot, surfaces: Surfaces, expanded: boolean, feasible: Record<Region, boolean>, registry: Registry = widgetRegistry(), catalog?: {
  select?(viewId: string): void; available(typeId: string, region: Region): boolean; commit(typeId: string, region: Region, at: { x: number; y: number }): boolean;
  group?(source: WorkbenchSnapshot, moving: string, target: string): WorkbenchSnapshot | null;
  reservationKey: string; reservation(id: string, intention: SlotIntention, baseline: WorkbenchSnapshot | null, commit: boolean): boolean
}) {
  const baseConstraints = constraintsForViews(tx.snapshot, registry)
  const [alignmentRegion, setAlignmentRegion] = useState<Region>('main')
  const visual = useDragVisual()
  const gesture = useRef<Gesture | null>(null), animation = useRef(0), shortClick = useRef<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null), [blocked, setBlocked] = useState<string | null>(null)
  const [heldExtent, setHeldExtent] = useState<{ region: Region; width: number; height: number } | null>(null)
  const [catalogDrag, setCatalogDrag] = useState<{ typeId: string; targets: Region[]; over: Region | null } | null>(null)
  const [frameDrop, setFrameDrop] = useState<{ targets: Region[]; over: Region | null } | null>(null)
  const [groupTransfer, setGroupTransfer] = useState<{ going: number; staying: number; region: Region; allowed: boolean; reason: string | null } | null>(null)
  const [sidebarInsert, setSidebarInsert] = useState<number | null>(null)
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([])
  const frameTargets = useRef<Region[]>([])
  const catalogGesture = useRef<{ typeId: string; x: number; y: number; left: number; top: number; pointer: number; target: HTMLElement; targets: Region[]; started: number; lifted: boolean; suppress: boolean } | null>(null)
  const catalogPointer = useRef({ x: 0, y: 0 }), suppressCatalogClick = useRef(false)
  const currentCatalog = useRef(catalog); currentCatalog.current = catalog
  const dwell = useRef<{ id: string; element: HTMLElement; timer: ReturnType<typeof setTimeout> | null } | null>(null)
  const slotHover = useRef<{ element: HTMLElement; allowed: boolean } | null>(null)
  const [gestureLabel, setGestureLabel] = useState<{ id: string; region: Region } | null>(null)
  const rejection = useRef<Animation | null>(null)
  const [released, setReleased] = useState<{ snapshot: WorkbenchSnapshot; region: Region } | null>(null)
  const latest = useRef({ view, apply, tick, surfaces }); latest.current = { view, apply, tick, surfaces }
  function surface(region: Region): Surface { return { ...surfaces.measures[region], region, expanded: expanded && region === 'main' } }
  function end(cancel: boolean, releaseVisual = true) {
    if (releaseVisual) visual.release(!cancel)
    clearSlotHover()
    rejection.current?.cancel(); rejection.current = null
    if (dwell.current) { if (dwell.current.timer) clearTimeout(dwell.current.timer); dwell.current.element.removeAttribute('data-drag-hover'); dwell.current = null }
    setGestureLabel(null)
    setSidebarInsert(null)
    setAlignmentGuides([])
    setFrameDrop(null); frameTargets.current = []
    setGroupTransfer(null)
    if (catalogGesture.current) {
      const entry = catalogGesture.current; catalogGesture.current = null; setCatalogDrag(null)
      suppressCatalogClick.current = entry.suppress
      if (entry.target.hasPointerCapture(entry.pointer)) entry.target.releasePointerCapture(entry.pointer)
      if (entry.lifted) { if (cancel) tx.cancelGesture(); else tx.finishGesture() }
      return
    }
    const a = gesture.current
    if (!a) return
    gesture.current = null; cancelAnimationFrame(animation.current); setBlocked(null); setHeldExtent(null)
    if (cancel) { tx.cancelGesture(); tx.put(a.source); tx.setMessage('Gesto cancelado. A prévia anterior foi restaurada.') }
    else {
      let settled = settleSnapshot(tx.live.current)
      const port = surfaces.ports.main.current
      if (a.original.region === 'main' && expanded && port && port.scrollWidth > port.clientWidth
        && settled.placements.filter(p => p.region === 'main').every(p => p.x + p.width <= port.clientWidth)) {
        // Dropping the held extent removes the scrollbar. Accept the same rectangles
        // at that full usable height, and bridge the ResizeObserver notification.
        settled = { ...settled, reference: { ...settled.reference, main: { ...settled.reference.main,
          height: Math.floor(port.getBoundingClientRect().height) } } }
        setReleased({ snapshot: settled, region: 'main' })
      }
      if (settled !== tx.live.current) tx.put(settled)
      tx.finishGesture()
    }
    if (a.target.hasPointerCapture(a.pointer)) a.target.releasePointerCapture(a.pointer)
  }
  const measurementKey = REGIONS.map(r => `${surfaces.measures[r].frameWidth},${surfaces.measures[r].frameHeight},${surfaces.measures[r].left},${surfaces.measures[r].top}`).join(';') + expanded
  useLayoutEffect(() => { end(true) }, [measurementKey])
  // Releasing occupied extent can synchronously clamp the native scroll offset.
  // Refresh the frame mapping before paint, rather than waiting for its scroll event.
  useLayoutEffect(() => { surfaces.measure() }, [heldExtent])
  useLayoutEffect(() => {
    if (released && released.snapshot.reference[released.region].height === surfaces.measures[released.region].height) setReleased(null)
  }, [released, surfaces.measures.main.height])
  useLayoutEffect(() => () => { cancelAnimationFrame(animation.current); rejection.current?.cancel(); if (dwell.current) { if (dwell.current.timer) clearTimeout(dwell.current.timer); dwell.current.element.removeAttribute('data-drag-hover') } }, [])
  useLayoutEffect(() => {
    const cancel = () => end(true)
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [])
  useLayoutEffect(() => {
    const entry = catalogGesture.current
    if (entry?.lifted) {
      entry.targets = REGIONS.filter(region => currentCatalog.current?.available(entry.typeId, region))
      setCatalogDrag(previous => previous ? { ...previous, targets: entry.targets, over: targetRegion(catalogPointer.current.x, catalogPointer.current.y, entry.targets) } : previous)
    }
    const a = gesture.current
    if (a?.kind === 'move' && visual.active()) { frameTargets.current = movementTargets(a); setFrameDrop({ targets: frameTargets.current, over: targetRegion(a.clientX, a.clientY, frameTargets.current) }) }
  }, [tx.snapshot.organization.activeBar])
  const slotPolicyKey = REGIONS.map(region => `${surfaces.measures[region].width},${surfaces.measures[region].height}`).join(';') + catalog?.reservationKey
  useLayoutEffect(() => { clearSlotHover(); visual.controller.current?.wake() }, [tx.slots, tx.snapshot.organization.activeBar, tx.editing, registry, measurementKey, slotPolicyKey])
  useLayoutEffect(() => () => clearSlotHover(), [])
  function clearSlotHover() { slotHover.current?.element.removeAttribute('data-drag-hover'); slotHover.current = null }
  function reservationAt(x: number, y: number) {
    // Native capture retargets pointer events, but elementFromPoint still resolves
    // the visible, clipped hit beneath our pointer-transparent top-layer picture.
    const hit = document.elementFromPoint(x, y)
    if (hit?.closest('dialog[open],.editor-panel,[popover]:popover-open')) return null
    const element = hit?.closest<HTMLElement>('[data-session-slot]')
    if (!element || (element.dataset.slotBar && element.dataset.slotBar !== tx.live.current.organization.activeBar)) return null
    return { element, id: element.dataset.sessionSlot! }
  }
  function reservationIntent(): { intention: SlotIntention; baseline: WorkbenchSnapshot | null } | null {
    const a = gesture.current, entry = catalogGesture.current
    if (a?.kind === 'move') return { intention: { kind: 'move', viewId: a.id, sourceBar: a.sourceBar }, baseline: { ...a.snapshot, organization: { ...a.snapshot.organization, activeBar: tx.live.current.organization.activeBar } } }
    return entry?.lifted ? { intention: { kind: 'catalog', typeId: entry.typeId }, baseline: null } : null
  }
  function hoverReservation(x: number, y: number) {
    const hit = reservationAt(x, y)
    if (hit?.element === slotHover.current?.element) return
    clearSlotHover()
    const intent = reservationIntent()
    if (!hit || !intent) return
    const allowed = !!currentCatalog.current?.reservation(hit.id, intent.intention, intent.baseline, false)
    slotHover.current = { element: hit.element, allowed }
    if (allowed) hit.element.setAttribute('data-drag-hover', '')
  }
  function destinationId(result: WorkbenchSnapshot, typeId: string, region: Region) {
    const a = gesture.current, plan = a && groupTransferPlan(a.source, registry, a.id, region)
    if (plan?.destinationFrame && result.placements.some(p => p.id === plan.destinationFrame && p.region === region)) return plan.destinationFrame
    return activePlacements(result).find(p => p.region === region && result.organization.views.some(v => v.id === p.id && v.typeId === typeId))?.id
  }
  function movementTargets(a: Gesture) {
    const source = { ...a.snapshot, organization: { ...a.snapshot.organization, activeBar: tx.live.current.organization.activeBar } }
    return REGIONS.filter(region => feasible[region] && (region === a.original.region && (region !== 'sidebar' || a.sourceBar === source.organization.activeBar)
      || !!moveView(source, registry, a.id, surface(region), undefined, a.sourceBar)
      || tx.currentSlots().some(slot => slot.region === region && currentCatalog.current?.reservation(slot.id, { kind: 'move', viewId: a.id, sourceBar: a.sourceBar }, source, false))))
  }
  function targetRegion(x: number, y: number, targets: readonly Region[]) {
    return targets.find(region => {
      const element = surfaces.ports[region].current, rect = element?.getBoundingClientRect()
      const clip = region === 'sidebar' ? surfaces.scroller(region)?.getBoundingClientRect() : rect
      return rect && clip && x >= rect.left && x <= rect.right && y >= Math.max(rect.top, clip.top) && y <= (region === 'sidebar' ? clip.bottom : Math.min(rect.bottom, clip.bottom))
    }) ?? null
  }
  // The picture's RAF reads target geometry before writing its transform. Pointer
  // events only update the latest intention; labels are measured once per drag.
  visual.measure.current = pointer => {
    hoverBar(pointer.x, pointer.y)
    hoverReservation(pointer.x, pointer.y)
    const catalog = catalogGesture.current
    let over: Region | null = null
    if (catalog?.lifted) {
      over = targetRegion(pointer.x, pointer.y, catalog.targets)
      setCatalogDrag(previous => previous?.targets === catalog.targets && previous.over === over ? previous : { typeId: catalog.typeId, targets: catalog.targets, over })
    } else if (gesture.current?.kind === 'move') {
      const targets = frameTargets.current; over = targetRegion(pointer.x, pointer.y, targets)
      setFrameDrop(previous => previous?.targets === targets && previous.over === over ? previous : { targets, over })
      const region = targetRegion(pointer.x, pointer.y, REGIONS), plan = region && groupTransferPlan(gesture.current.source, registry, gesture.current.id, region)
      const preview = plan && region ? { going: plan.going.length, staying: plan.staying.length, region, allowed: plan.allowed && targets.includes(region), reason: plan.reason ?? (targets.includes(region) ? null : 'Sem espaço para todas as abas elegíveis.') } : null
      setGroupTransfer(previous => JSON.stringify(previous) === JSON.stringify(preview) ? previous : preview)
    }
    if (over !== 'sidebar' || slotHover.current) { setSidebarInsert(null); return false }
    const rect = surfaces.ports.sidebar.current?.getBoundingClientRect()
    if (rect) {
      const baseline = gesture.current?.snapshot ?? tx.live.current
      const source = { ...baseline, organization: { ...baseline.organization, activeBar: tx.live.current.organization.activeBar } }
      setSidebarInsert(sidebarInsertion(source, gesture.current?.id ?? null, pointer.y - rect.top).y)
    }
    const owner = latest.current.surfaces.scroller('sidebar'), box = owner?.getBoundingClientRect()
    if (!owner || !box) return false
    const previous = owner.scrollTop, delta = pointer.y < box.top + 28 ? -7 : pointer.y > box.bottom - 28 ? 7 : 0
    if (!delta) return false
    owner.scrollTop += delta
    const scrolling = previous !== owner.scrollTop
    if (scrolling && gesture.current?.original.region === 'sidebar' && !animation.current) animation.current = requestAnimationFrame(time => latest.current.tick(time))
    return scrolling
  }
  function catalogHandlers(typeId: string) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!tx.editing || event.button || gesture.current || catalogGesture.current || visual.active()) return
        const rect = event.currentTarget.getBoundingClientRect()
        event.currentTarget.setPointerCapture(event.pointerId)
        catalogGesture.current = { typeId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, pointer: event.pointerId, target: event.currentTarget,
          targets: REGIONS.filter(region => catalog?.available(typeId, region)), started: 0, lifted: false, suppress: false }
        catalogPointer.current = { x: event.clientX, y: event.clientY }; suppressCatalogClick.current = false
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const a = catalogGesture.current; if (!a || a.pointer !== event.pointerId) return
        catalogPointer.current = { x: event.clientX, y: event.clientY }
        if (!a.lifted && Math.hypot(event.clientX - a.x, event.clientY - a.y) < 5) return
        if (!a.lifted) {
          a.suppress = true
          if (!a.targets.length) {
            end(true)
            if (!matchMedia('(prefers-reduced-motion: reduce)').matches) rejection.current = (a.target.closest('.widget-browser-item') ?? a.target).animate([
              { translate: '0 0', offset: 0 }, { translate: '0 -4px', offset: .18 }, { translate: '-3px -4px', offset: .32 }, { translate: '3px -4px', offset: .48 }, { translate: '-2px -3px', offset: .64 }, { translate: '2px -2px', offset: .8 }, { translate: '0 0', offset: 1 }
            ], { duration: 280, easing: 'ease-out' })
            tx.setMessage('Não há área compatível com espaço disponível para este widget.'); return
          }
          tx.beginGesture(); a.lifted = true; a.started = performance.now()
          const viewId = tx.live.current.organization.views.find(v => v.typeId === typeId && view.placements.some(p => p.id === v.id))?.id ?? null
          const source = viewId ? document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(viewId)}"]`) : null
          const moving = !!viewId && registry.get(typeId)?.presence === 'single-view'
          const origin = view.placements.find(p => p.id === viewId)
          visual.begin(typeId, moving ? viewId : null, moving && origin?.region === 'sidebar' ? tx.live.current.organization.activeBar : null, a.target, moving ? source : null, !moving, event.clientX, event.clientY)
        }
        visual.move(event.clientX, event.clientY)
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const a = catalogGesture.current; if (!a || a.pointer !== event.pointerId) return
        const slot = a.lifted ? reservationAt(event.clientX, event.clientY) : null
        const region = slot ? slot.element.dataset.ownerRegion as Region : a.lifted ? targetRegion(event.clientX, event.clientY, REGIONS.filter(region => currentCatalog.current?.available(a.typeId, region))) : null
        let accepted = false
        if (slot) accepted = !!currentCatalog.current?.reservation(slot.id, { kind: 'catalog', typeId }, null, true)
        else if (region) {
          const rect = surfaces.ports[region].current!.getBoundingClientRect(), scroller = surfaces.scroller(region)
          accepted = !!catalog?.commit(typeId, region, { x: event.clientX - rect.left + (scroller?.scrollLeft ?? 0), y: event.clientY - rect.top + (region === 'sidebar' ? 0 : scroller?.scrollTop ?? 0) })
        }
        end(!accepted, false)
        const destination = accepted && region ? destinationId(tx.live.current, typeId, region) : undefined
        visual.release(accepted, destination)
      },
      onPointerCancel() { end(true) }, onLostPointerCapture() { if (catalogGesture.current) end(true) },
      onClickCapture(event: React.MouseEvent<HTMLButtonElement>) { if (suppressCatalogClick.current) { suppressCatalogClick.current = false; event.preventDefault(); event.stopPropagation() } }
    }
  }
  function hoverBar(x: number, y: number) {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-bar-id]'), id = element?.dataset.barId
    if (id === dwell.current?.id) return
    if (dwell.current) { if (dwell.current.timer) clearTimeout(dwell.current.timer); dwell.current.element.removeAttribute('data-drag-hover'); dwell.current = null }
    if (!element || !id || !tx.editing) return
    element.setAttribute('data-drag-hover', '')
    dwell.current = { id, element, timer: id === tx.live.current.organization.activeBar ? null : setTimeout(() => {
      if (!gesture.current && !catalogGesture.current) return
      if (!tx.live.current.organization.bars.some(bar => bar.id === id && !bar.archived)) return
      tx.put({ ...tx.live.current, organization: { ...tx.live.current.organization, activeBar: id } })
      if (gesture.current) { gesture.current.snapshot.organization.activeBar = id; gesture.current.preview = null }
    }, 250) }
  }
  function apply(snapshot: WorkbenchSnapshot, p: Placement, dx: number, dy: number, kind: Gesture['kind']) {
    if (!feasible[p.region]) return
    if (p.region === 'sidebar' && gesture.current && gesture.current.sourceBar !== tx.live.current.organization.activeBar) return
    if (p.region === 'sidebar') {
      // Movement commits at release; only the insertion line follows the pointer.
      if (kind === 'move') return
      const c = constraintsFor(surface('sidebar'), baseConstraints)[p.id]!
      const height = Math.max(c.min.height, Math.min(c.max.height, p.height + (kind.includes('n') ? -dy : dy)))
      const next = reconcileBarHeights({ ...snapshot, placements: snapshot.placements.map(q => q.id === p.id ? { ...q, height, preferred: { width: q.width, height } } : q) })
      if (!next) { setBlocked(p.id); return }
      if (gesture.current) gesture.current.preview = next
      tx.put(next); setBlocked(null); return
    }
    // Opt-in, bounded browser-only diagnostics. No bridge, storage or user telemetry.
    const profiling = performance.getEntriesByName('geppio:profile').length > 0, started = profiling ? performance.now() : 0
    const tracing = performance.getEntriesByName('geppio:anchors').length > 0
    const attempts: unknown[] = []
    let s = surface(p.region)
    const panels = panelIds(snapshot)
    const peers = snapshot.placements.filter(q => q.region === p.region && !panels.has(q.id))
    let alignment: ReturnType<typeof alignedGesture> | null = null
    function solve(at: Surface, budget?: { probes: number; states: number }): Result {
      const cs = constraintsFor(at, baseConstraints)
      const adapted = p.region === 'main' && snapshot.reference.main.height !== at.height ? projectRegion({ ...snapshot, placements: peers }, 'main', at, at.expanded, baseConstraints) : null
      if (adapted && !adapted.feasible) return { status: 'blocked', placements: peers, reason: 'space', probes: 0, states: 0, candidates: 0 }
      const source = adapted?.placements ?? peers
      // Responsive neighbor fitting cannot change a resize's stable opposite edges.
      const original = kind === 'move' ? source.find(q => q.id === p.id)! : p
      const requested = candidate(original, dx, dy, kind, at, cs[p.id]!)
      const pointer = gesture.current, overRegion = !pointer || targetRegion(pointer.clientX, pointer.clientY, [p.region]) === p.region
      alignment = pointer && overRegion ? alignedGesture(source, p.id, requested, at, cs, kind, pointer.alignment, budget) : null
      const result = alignment?.result ?? reflow(source, p.id, requested, at, cs, kind, budget)
      if (tracing) attempts.push({ source: original, requested, activeResult: result.placements.find(q => q.id === p.id), status: result.status, surface: at })
      return result
    }
    let result = solve(s)
    const port = surfaces.ports.main.current
    if (result.status === 'valid' && p.region === 'main' && s.expanded && port && port.scrollWidth <= port.clientWidth
      && result.placements.some(q => q.x + q.width > s.width)) {
      // Solve against the measured future client height before the first scrollbar
      // is committed. Share one operation budget with the initial collision pass.
      s = { ...s, height: s.height - surfaces.scrollbarHeight.current }
      const initial = result
      result = solve(s, { probes: 8192 - initial.probes, states: 2048 - initial.states })
      result = { ...result, probes: result.probes + initial.probes, states: result.states + initial.states, candidates: result.candidates + initial.candidates }
    }
    if (profiling) {
      performance.clearMeasures('geppio:reflow')
      performance.measure('geppio:reflow', { start: started, end: performance.now(), detail: { status: result.status,
        states: result.states, probes: result.probes, candidates: result.candidates,
        affected: result.placements.filter(q => q.id !== p.id && peers.some(old => old.id === q.id && (old.x !== q.x || old.y !== q.y || old.width !== q.width || old.height !== q.height))).length } })
    }
    if (tracing) {
      performance.clearMeasures('geppio:anchor-solve')
      performance.measure('geppio:anchor-solve', { start: performance.now(), detail: { kind, dx, dy, stable: p, reference: snapshot.reference[p.region],
        measurement: surfaces.measures[p.region], attempts, probes: result.probes, states: result.states } })
    }
    const acceptedAlignment = alignment as ReturnType<typeof alignedGesture> | null
    setAlignmentGuides(result.status === 'valid' ? acceptedAlignment?.guides ?? [] : [])
    setAlignmentRegion(p.region)
    if (gesture.current) gesture.current.alignment = result.status === 'valid' ? acceptedAlignment?.locks : undefined
    if (result.status === 'blocked') { setBlocked(p.id); tx.setMessage('Sem espaço para os mínimos deste widget. A última prévia válida foi mantida.'); return }
    const next = { ...snapshot, organization: { ...tx.live.current.organization, bars: tx.live.current.organization.bars.map(bar => bar.id === tx.live.current.organization.activeBar ? { ...bar, members: [...bar.members], positions: { ...bar.positions } } : bar) }, reference: { ...snapshot.reference, [p.region]: { width: s.width, height: s.height } },
      placements: snapshot.placements.map(q => result.placements.find(next => next.id === q.id) ?? q) }
    if (gesture.current) gesture.current.preview = next
    tx.put(next)
    setBlocked(null); tx.setMessage('Prévia válida. Ao soltar, posições e tamanhos serão mantidos para o próximo gesto. Salve ou cancele.')
  }
  function update(a: Gesture) {

    if (a.kind === 'move' && !visual.active()) return
    const port = latest.current.surfaces.scroller(a.original.region)
    const dx = a.clientX - a.x + (port?.scrollLeft ?? 0) - a.scrollX + a.extension, dy = a.clientY - a.y + (port?.scrollTop ?? 0) - a.scrollY
    const m = latest.current.surfaces.measures[a.original.region]
    const key = `${dx},${dy},${m.width},${m.height}`
    if (key === a.last) return
    a.last = key; latest.current.apply(a.snapshot, a.original, dx, dy, a.kind)
  }
  function tick(time: number) {
    animation.current = 0
    const a = gesture.current
    if (!a) return
    if (a.kind === 'move' && !visual.active()) return
    const port = latest.current.surfaces.ports[a.original.region].current
    if (!port) return
    const r = port.getBoundingClientRect(), elapsed = a.time ? Math.min(32, time - a.time) / 16.67 : 1
    a.time = time
    // No speculative giant world: an intended active position determines temporary extent.
    // Existing occupied range is scrollable immediately; direct pointer movement grows it.
    let scrolling = false
    const before = tx.live.current.placements.find(p => p.id === a.id)
    const oldExtension = a.extension
    if (expanded && a.original.region === 'main' && a.clientY >= r.top && a.clientY <= r.bottom) {
      const delta = a.clientX > r.right - 30 && a.clientX <= r.right + 30 ? Math.min(20, (a.clientX - r.right + 30) / 2)
        : a.clientX < r.left + 30 && a.clientX >= r.left - 30 ? -Math.min(20, (r.left + 30 - a.clientX) / 2) : 0
      if (delta && Math.sign(delta) === a.directionX && (a.kind === 'move' || /[ew]/.test(a.kind))) {
        const before = port.scrollLeft
        port.scrollLeft += delta * elapsed
        const unscrolled = delta * elapsed - (port.scrollLeft - before)
        // Keep real pointer coordinates intact. Only the successful active intention
        // extends occupancy; there is no allocated speculative world or pixel array.
        a.extension = Math.max(-POLICY.maxCoordinate, Math.min(POLICY.maxCoordinate, a.extension + unscrolled))
        scrolling = port.scrollLeft !== before
      }
    }
    update(a)
    const after = tx.live.current.placements.find(p => p.id === a.id)
    if (oldExtension !== a.extension && before && after && (before.x !== after.x || before.width !== after.width)) scrolling = true
    if (scrolling) animation.current = requestAnimationFrame(next => latest.current.tick(next))
  }
  function transferTo(id: string, region: Region, at?: { x: number; y: number }) {
    const typeId = tx.live.current.organization.views.find(view => view.id === id)?.typeId
    if (typeId && registry.get(typeId)?.preserveNormalGeometry && panelIds(tx.live.current).has(id) && tx.live.current.placements.find(p => p.id === id)?.region !== region) {
      tx.setMessage('Volte a Normal antes de transferir este widget para outra região.'); return false
    }
    if (!tx.editing || !feasible[region]) { tx.setMessage('Região sem espaço disponível. Reabra ou amplie a região antes de transferir.'); return false }
    const result = moveView(settleSnapshot(latest.current.view), registry, id, surface(region), at)
    if (!result) { tx.setMessage(`Transferência para ${REGION_LABELS[region]} incompatível ou sem espaço para os mínimos. Composição preservada.`); setBlocked(id); return false }
    tx.action(settleSnapshot(result)); setBlocked(null); tx.setMessage(`Widget transferido para ${REGION_LABELS[region]} na prévia. Salve ou cancele.`)
    requestAnimationFrame(() => {
      const moved = result.placements.find(p => p.id === id)!, owner = surfaces.scroller(region)
      if (owner && region === 'sidebar') owner.scrollTop += moved.y - surfaces.measures.sidebar.scrollTop
      surfaces.measure()
    })
    return true
  }
  function start(e: PointerEvent<HTMLElement>, p: Placement, kind: Gesture['kind']) {
    if (!tx.editing || gesture.current || visual.active() || e.button !== 0 || !feasible[p.region]) return
    e.preventDefault(); shortClick.current = null; setReleased(null); e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId)
    tx.beginGesture()
    const port = surfaces.scroller(p.region)!
    // Native scroll clamping caused by shrinking our own occupied extent must not feed
    // back into this gesture's pointer delta. Hold only its starting occupied width,
    // then contract and clamp on release. This is bounded transient gesture state.
    const peers = view.placements.filter(q => q.region === p.region)
    setHeldExtent({ region: p.region, width: Math.max(surfaces.measures[p.region].width, ...peers.map(q => q.x + q.width)),
      height: p.region === 'sidebar' ? Math.max(0, ...peers.map(q => q.y + q.height)) : 0 })
    gesture.current = { id: p.id, pointer: e.pointerId, kind, x: e.clientX, y: e.clientY, original: structuredClone(p), sourceBar: tx.live.current.organization.activeBar,
      snapshot: settleSnapshot(structuredClone(view)), source: structuredClone(tx.live.current), target: e.currentTarget,
      scrollX: port.scrollLeft, scrollY: port.scrollTop, clientX: e.clientX, clientY: e.clientY, time: 0,
      last: `0,0,${surfaces.measures[p.region].width},${surfaces.measures[p.region].height}`, extension: 0, directionX: 0, preview: null }
    setSelected(p.id); animation.current = requestAnimationFrame(time => latest.current.tick(time))
    if (kind === 'move') setGestureLabel({ id: p.id, region: p.region })
  }
  function move(e: PointerEvent<HTMLElement>) {
    const a = gesture.current
    if (!a || a.pointer !== e.pointerId) return
    if (e.clientX !== a.clientX) a.directionX = Math.sign(e.clientX - a.clientX)
    // Keep only the newest intention. Solving in every pointer event can queue work
    // faster than the display commits it; the RAF remains live throughout the gesture.
    a.clientX = e.clientX; a.clientY = e.clientY
    if (a.kind === 'move') {
      if (!visual.active() && Math.hypot(e.clientX - a.x, e.clientY - a.y) >= 5) {
        const source = document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(a.id)}"]`), typeId = a.source.organization.views.find(v => v.id === a.id)!.typeId
        visual.begin(typeId, a.id, a.original.region === 'sidebar' ? a.sourceBar : null, a.target, source, false, e.clientX, e.clientY)
        frameTargets.current = movementTargets(a)
      }
      visual.move(e.clientX, e.clientY)
    }
    if (!animation.current) animation.current = requestAnimationFrame(time => latest.current.tick(time))
  }
  function finish(e: PointerEvent<HTMLElement>, cancel = false) {
    const a = gesture.current
    if (!a || a.pointer !== e.pointerId) return
    if (!cancel && a.kind === 'move' && visual.active()) {
      const target = document.elementsFromPoint(e.clientX, e.clientY).map(node => node.closest<HTMLElement>('[data-group-target]')).find(Boolean)?.dataset.groupTarget
      if (target && currentCatalog.current?.group) {
        const result = currentCatalog.current.group(a.snapshot, a.id, target)
        end(true, false)
        if (result) { tx.action(settleSnapshot(result)); tx.setMessage('Widgets agrupados. Salve ou cancele.') }
        else tx.setMessage('Agrupamento incompatível ou sem espaço. Composição preservada.')
        visual.release(!!result, result ? target : undefined); return
      }
    }
    const slot = !cancel && a.kind === 'move' && visual.active() ? reservationAt(e.clientX, e.clientY) : null
    if (slot) {
      const intent = reservationIntent()!, region = slot.element.dataset.ownerRegion as Region
      end(true, false)
      const accepted = !!currentCatalog.current?.reservation(slot.id, intent.intention, intent.baseline, true)
      const typeId = a.source.organization.views.find(v => v.id === a.id)!.typeId
      visual.release(accepted, accepted ? destinationId(tx.live.current, typeId, region) : undefined)
      return
    }
    if (!cancel && a.kind === 'move' && visual.active() && a.original.region === 'sidebar' && targetRegion(e.clientX, e.clientY, ['sidebar']) === 'sidebar') {
      const owner = surfaces.scroller('sidebar')!, box = owner.getBoundingClientRect(), bar = tx.live.current.organization.activeBar
      const source = { ...a.snapshot, organization: { ...a.snapshot.organization, activeBar: bar } }
      const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
      end(true, false)
      const rect = surfaces.ports.sidebar.current!.getBoundingClientRect()
      const result = inside ? moveView(source, registry, a.id, surface('sidebar'), { x: 0, y: e.clientY - rect.top }, a.sourceBar) : null
      if (result) { tx.action(settleSnapshot(result)); tx.setMessage('Widget inserido na barra lateral. Salve ou cancele.') }
      else { tx.put({ ...a.source, organization: { ...a.source.organization, activeBar: bar } }); tx.setMessage('Destino incompatível. A composição anterior foi preservada.') }
      visual.release(!!result, result ? destinationId(result, a.source.organization.views.find(v => v.id === a.id)!.typeId, 'sidebar') : undefined)
      return
    }
    if (!cancel && a.kind === 'move') {
      for (const region of REGIONS) {
        if (region === a.original.region) continue
        const element = surfaces.ports[region].current, r = element?.getBoundingClientRect(), regionRect = element?.closest('[data-region]')?.getBoundingClientRect()
        if (!r || !regionRect || e.clientX < regionRect.left || e.clientX > regionRect.right || e.clientY < regionRect.top || e.clientY > regionRect.bottom) continue
        // Transfer uses the pre-gesture composition so failed drops cannot leave a
        // partly displaced origin. A rejected cross-region drop restores it atomically.
        end(true, false)
        const s = surface(region), result = feasible[region] ? moveView(a.snapshot, registry, a.id, s, {
          x: e.clientX - r.left + (surfaces.ports[region].current?.scrollLeft ?? 0),
          y: e.clientY - r.top + (region === 'sidebar' ? 0 : surfaces.ports[region].current?.scrollTop ?? 0) }, a.sourceBar) : null
        if (result) { tx.action(settleSnapshot(result)); tx.setMessage(`Widget transferido para ${REGION_LABELS[region]}. Salve ou cancele.`) }
        else { setBlocked(a.id); tx.setMessage('Transferência incompatível ou sem espaço. A composição anterior foi restaurada.') }
        const plan = groupTransferPlan(a.source, registry, a.id, region)
        if (!result && plan) tx.setMessage(plan.reason ?? 'Sem espaço para todas as abas elegíveis. Composição preservada.')
        visual.release(!!result, result ? plan?.destinationFrame ?? destinationId(result, a.source.organization.views.find(v => v.id === a.id)!.typeId, region) : undefined)
        return
      }
    }
    if (!cancel && a.kind === 'move' && !visual.active() && Math.hypot(e.clientX - a.x, e.clientY - a.y) < 5) shortClick.current = a.id
    if (!cancel) { a.clientX = e.clientX; a.clientY = e.clientY; update(a) }
    end(cancel)
  }
  function keyboard(e: KeyboardEvent<HTMLElement>, p: Placement, kind: Gesture['kind']) {
    if (!import.meta.env.DEV || !tx.editing || gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault(); const step = e.shiftKey ? 10 : 1
    // Several key events can arrive before React renders. Each discrete action uses
    // the synchronous live draft, never the preceding render's stale placement.
    const live = tx.live.current, at = surface(p.region), projection = projectRegion(live, p.region, at, at.expanded, baseConstraints)
    if (!projection.feasible) return
    const action = settleSnapshot({ ...live, reference: { ...live.reference, [p.region]: { width: at.width,
      height: p.region === 'sidebar' ? Math.max(at.height, projection.world.height) : at.height } },
      placements: live.placements.map(q => projection.placements.find(next => next.id === q.id) ?? q) })
    const active = action.placements.find(q => q.id === p.id)!
    tx.beginGesture()
    setSelected(p.id); apply(action, active, e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0,
      e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0, kind)
    const settled = settleSnapshot(tx.live.current)
    if (settled !== tx.live.current) tx.put(settled)
    tx.finishGesture()
    requestAnimationFrame(() => {
      const port = surfaces.scroller(p.region), next = tx.live.current.placements.find(q => q.id === p.id)
      if (!port || !next) return
      if (p.region === 'main') {
        if (next.x < port.scrollLeft) port.scrollLeft = next.x
        else if (next.x + next.width > port.scrollLeft + port.clientWidth) port.scrollLeft = next.x + next.width - port.clientWidth
      } else if (p.region === 'sidebar') {
        const m = surfaces.measures.sidebar
        if (next.y < m.scrollTop) port.scrollTop += next.y - m.scrollTop
        else if (next.y + next.height > m.scrollTop + m.height) port.scrollTop += next.y + next.height - m.scrollTop - m.height
      }
      surfaces.measure()
    })
  }
  function handlers(p: Placement, kind: Gesture['kind']) {
    return { onClick: () => { if (kind === 'move' && shortClick.current === p.id) { shortClick.current = null; currentCatalog.current?.select?.(p.id) } }, onPointerDown: (e: PointerEvent<HTMLElement>) => start(e, p, kind), onPointerMove: move,
      onPointerUp: (e: PointerEvent<HTMLElement>) => finish(e), onPointerCancel: (e: PointerEvent<HTMLElement>) => finish(e, true),
      onLostPointerCapture: (e: PointerEvent<HTMLElement>) => finish(e, true), onKeyDown: (e: KeyboardEvent<HTMLElement>) => keyboard(e, p, kind) }
  }
    return { selected, setSelected, blocked, heldExtent, handlers, catalogHandlers, catalogDrag, frameDrop, groupTransfer, sidebarInsert, alignmentGuides, alignmentRegion, gestureLabel, visual,
    catalogSurfaceKey: REGIONS.map(region => `${surfaces.measures[region].width},${surfaces.measures[region].height}`).join(';') + expanded + JSON.stringify(tx.slots),
    canCatalogPlace: (typeId: string, region: Region) => !!currentCatalog.current?.available(typeId, region),
    activeId: gesture.current?.id ?? null,
    movingId: gesture.current?.kind === 'move' ? gesture.current.id : null, sourceBar: gesture.current?.sourceBar ?? null,
    end, active: () => !!gesture.current || !!catalogGesture.current || rejection.current?.playState === 'running', transferTo,
    preview: gesture.current?.preview ?? released?.snapshot ?? null, activeRegion: gesture.current?.original.region ?? released?.region ?? null }
}
export type Interaction = ReturnType<typeof useInteraction>
