import { useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { swapViews } from '../../../shared/workbench/commands.ts'
import type { Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import type { Transaction } from '../freeform/useTransaction.ts'

/** Selection and the floating label are transient; only an accepted bilateral
 * swap enters the transaction/history. Capturing the button never clones a view.
 */
export function useSwap(tx: Transaction, view: WorkbenchSnapshot, registry: Registry, selected: string[], completed: () => void) {
  const gesture = useRef<{ id: string; pointer: number; x: number; y: number; button: HTMLButtonElement; source: WorkbenchSnapshot; started: boolean; target: string | null } | null>(null)
  const [preview, setPreview] = useState<{ id: string; x: number; y: number; target: string | null } | null>(null)
  const suppress = useRef(false)
  function cancel() {
    const old = gesture.current; gesture.current = null; setPreview(null)
    if (old?.button.hasPointerCapture(old.pointer)) old.button.releasePointerCapture(old.pointer)
  }
  useLayoutEffect(() => { cancel() }, [tx.editing, tx.motionRevision, view.reference.main.width, view.reference.main.height])
  useLayoutEffect(() => {
    const blur = () => { cancel(); suppress.current = false }
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('blur', blur); cancel() }
  }, [])
  function handlers(id: string) {
    return {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (!tx.editing || event.button || event.ctrlKey || event.metaKey || selected.length < 2 || gesture.current) return
        event.preventDefault(); event.stopPropagation(); suppress.current = false
        event.currentTarget.setPointerCapture(event.pointerId)
        gesture.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, button: event.currentTarget, source: structuredClone(view), started: false, target: null }
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const g = gesture.current; if (!g || g.pointer !== event.pointerId) return
        if (!g.started && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 5) return
        g.started = true; event.preventDefault(); event.stopPropagation()
        const hit = document.elementsFromPoint(event.clientX, event.clientY).map(node => node.closest<HTMLElement>('[data-widget]')?.dataset.widget).find(value => value && value !== id)
        g.target = hit && selected.includes(hit) && swapViews(g.source, registry, id, hit) ? hit : null
        setPreview({ id, x: event.clientX + 14, y: event.clientY + 14, target: g.target })
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        const g = gesture.current; if (!g || g.pointer !== event.pointerId) return
        const next = g.started && g.target ? swapViews(g.source, registry, g.id, g.target) : null
        suppress.current = g.started; cancel()
        if (next) { tx.action(next); completed() }
      },
      onPointerCancel: cancel, onLostPointerCapture: cancel,
      onClickCapture(event: React.MouseEvent<HTMLButtonElement>) { if (suppress.current) { suppress.current = false; event.preventDefault(); event.stopPropagation() } },
      onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel() } }
    }
  }
  return { handlers, preview, cancel, active: () => !!gesture.current }
}
