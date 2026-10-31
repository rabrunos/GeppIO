import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode, RefObject, Ref } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useLocale } from './Locale.tsx'
import { useScrollState } from './ScrollArea.tsx'

export function IconButton({ label, literalLabel = false, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; literalLabel?: boolean; ref?: Ref<HTMLButtonElement> }) {
  const { t } = useLocale()
  const accessible = literalLabel ? label : t(label)
  return <button type="button" className={'ui-button ui-icon-button ' + className} aria-label={accessible} title={accessible} {...props}>{children}</button>
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
  }, [])
}
export function Dialog({ title, children, close, className = '' }: { title: string; children: ReactNode; close(): void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId(), { t } = useLocale()
  useScrollState(ref)
  useModalDialog(ref, close)
  return <dialog ref={ref} className={'profile-dialog host-dialog ui-scrollbar ' + className} aria-labelledby={id} onCancel={event => { event.preventDefault(); close() }}>
    <header className="profile-dialog-heading"><h2 id={id}>{t(title)}</h2><IconButton className="profile-dialog-close" label="Fechar" onClick={close}><XMarkIcon className="icon" /></IconButton></header>{children}
  </dialog>
}
export function Confirm({ title, text, confirm, close, destructive = true, label = 'Confirmar' }: { title: string; text: string; confirm(): void; close(): void; destructive?: boolean; label?: string }) {
  const { t } = useLocale()
  return <Dialog title={title} close={close} className="confirmation-dialog"><p className="profile-dialog-description">{text}</p><div className="workspace-dialog-actions"><button className="ui-button workspace-secondary" onClick={close}>{t('Cancelar')}</button><button className={'ui-button workspace-primary ' + (destructive ? 'is-destructive' : '')} onClick={() => { confirm(); close() }}>{t(label)}</button></div></Dialog>
}
export function Popover({ title, description, open, close, anchor, point, placement, children, className = '', bare = false }: { title: string; description?: string; open: boolean; close(): void; anchor?: RefObject<HTMLElement | null>; point?: { x: number; y: number }; placement?: 'rail'; children: ReactNode; className?: string; bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), id = useId(), { t } = useLocale()
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
    window.addEventListener('resize', resized)
    if (bare) element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    else element.querySelector<HTMLInputElement>('input')?.focus()
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resized) }
  }, [open, point?.x, point?.y])
  return <div ref={ref} popover="auto" role={bare ? 'menu' : 'dialog'} aria-label={bare ? t(title) : undefined} aria-labelledby={bare ? undefined : id} className={(bare ? '' : 'workspace-popover ') + className} onToggle={event => { if (event.target === event.currentTarget && event.newState === 'closed' && open) close() }} onKeyDown={event => {
    if (!bare || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }}>
    {!bare && <header className="workspace-popover-heading"><div><h2 id={id}>{t(title)}</h2>{description && <p>{t(description)}</p>}</div><IconButton className="workspace-popover-close" label="Fechar" onClick={close}><XMarkIcon className="icon" /></IconButton></header>}{children}
  </div>
}
