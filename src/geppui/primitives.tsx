import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode, RefObject, Ref } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useScrollState } from './scroll-area.js'

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: Ref<HTMLButtonElement> }) {
  return <button type="button" className={'ui-button ui-icon-button ' + className} aria-label={label} title={label} {...props}>{children}</button>
}
/** A backdrop click is a dismissal only when both ends began outside the box. */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, close: () => void, initialFocus = '[data-initial-focus]') {
  const callback = useRef(close); callback.current = close
  useEffect(() => {
    const dialog = ref.current!; let beganOutside = false
    const outside = (event: MouseEvent) => { const box = dialog.getBoundingClientRect(); return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) }
    const down = (event: PointerEvent) => { beganOutside = outside(event) }
    const click = (event: MouseEvent) => { const dismiss = beganOutside && outside(event); beganOutside = false; if (dismiss) callback.current() }
    dialog.showModal(); dialog.querySelector<HTMLElement>(initialFocus)?.focus()
    dialog.addEventListener('pointerdown', down); dialog.addEventListener('click', click)
    return () => { dialog.removeEventListener('pointerdown', down); dialog.removeEventListener('click', click); dialog.close() }
  }, [ref, initialFocus])
}
export function Dialog({ title, closeLabel, children, close, closeDisabled = false, className = '' }: { title: string; closeLabel: string; children: ReactNode; close(): void; closeDisabled?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId()
  useScrollState(ref)
  useModalDialog(ref, close)
  return <dialog ref={ref} className={'profile-dialog host-dialog ui-scrollbar ' + className} aria-labelledby={id} onCancel={event => { event.preventDefault(); close() }}>
    <header className="profile-dialog-heading"><h2 id={id}>{title}</h2><IconButton className="profile-dialog-close" label={closeLabel} disabled={closeDisabled} onClick={close}><XMarkIcon className="icon" /></IconButton></header>{children}
  </dialog>
}
export function Popover({ title, closeLabel, description, open, close, anchor, point, placement, children, className = '', bare = false }: { title: string; closeLabel: string; description?: string; open: boolean; close(): void; anchor?: RefObject<HTMLElement | null>; point?: { x: number; y: number }; placement?: 'rail'; children: ReactNode; className?: string; bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), id = useId()
  useScrollState(ref)
  useEffect(() => {
    const element = ref.current!
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return }
    const edge = placement === 'rail' ? 9 : 11
    element.style.visibility = 'hidden'
    element.style.setProperty('--popover-available-height', Math.max(0, innerHeight - 2 * edge) + 'px')
    element.showPopover()
    function position() {
      const at = anchor?.current?.getBoundingClientRect(), box = element.getBoundingClientRect()
      const left = Math.max(11, Math.min(point?.x ?? (placement === 'rail' && at ? at.right + 11 : at ? at.right - box.width : 70), innerWidth - box.width - 11))
      const below = point?.y ?? (at?.bottom ?? 60) + 9
      const top = placement === 'rail' && at ? Math.max(9, Math.min(at.bottom - box.height, innerHeight - box.height - 9)) : below + box.height <= innerHeight - 11 ? Math.max(11, below) : Math.max(11, (point?.y ?? at?.top ?? 60) - box.height - 9)
      element.style.left = left + 'px'; element.style.top = top + 'px'; element.style.visibility = ''
      element.style.setProperty('--popover-available-height', Math.max(0, innerHeight - top - edge) + 'px')
    }
    position()
    let frame = 0
    const resized = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; position() }) }
    const observer = new ResizeObserver(resized); observer.observe(element)
    window.addEventListener('resize', resized)
    if (bare) element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    else element.querySelector<HTMLInputElement>('input')?.focus()
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', resized) }
  }, [open, point?.x, point?.y, anchor, placement, bare])
  return <div ref={ref} popover="auto" role={bare ? 'menu' : 'dialog'} aria-label={bare ? title : undefined} aria-labelledby={bare ? undefined : id} className={(bare ? '' : 'workspace-popover ') + className} onToggle={event => { if (event.target === event.currentTarget && event.newState === 'closed' && open) close() }} onKeyDown={event => {
    if (!bare || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }}>
    {!bare && <header className="workspace-popover-heading"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div><IconButton className="workspace-popover-close" label={closeLabel} onClick={close}><XMarkIcon className="icon" /></IconButton></header>}{children}
  </div>
}
