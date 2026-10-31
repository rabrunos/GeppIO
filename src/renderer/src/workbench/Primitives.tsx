import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode, RefObject, Ref } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useLocale } from './Locale.tsx'

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: Ref<HTMLButtonElement> }) {
  const { t } = useLocale()
  return <button type="button" className={'ui-button ui-icon-button ' + className} aria-label={t(label)} title={t(label)} {...props}>{children}</button>
}
export function Dialog({ title, children, close, className = '' }: { title: string; children: ReactNode; close(): void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId(), { t } = useLocale()
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={'profile-dialog host-dialog ' + className} aria-labelledby={id} onCancel={event => { event.preventDefault(); close() }}>
    <header className="profile-dialog-heading"><h2 id={id}>{t(title)}</h2><IconButton className="profile-dialog-close" label="Fechar" onClick={close}><XMarkIcon className="icon" /></IconButton></header>{children}
  </dialog>
}
export function Confirm({ title, text, confirm, close, destructive = true, label = 'Confirmar' }: { title: string; text: string; confirm(): void; close(): void; destructive?: boolean; label?: string }) {
  const { t } = useLocale()
  return <Dialog title={title} close={close} className="confirmation-dialog"><p className="profile-dialog-description">{text}</p><div className="workspace-dialog-actions"><button className="ui-button workspace-secondary" onClick={close}>{t('Cancelar')}</button><button className={'ui-button workspace-primary ' + (destructive ? 'is-destructive' : '')} onClick={() => { confirm(); close() }}>{t(label)}</button></div></Dialog>
}
export function Popover({ title, description, open, close, anchor, point, placement, children, className = '', bare = false }: { title: string; description?: string; open: boolean; close(): void; anchor?: RefObject<HTMLElement | null>; point?: { x: number; y: number }; placement?: 'rail'; children: ReactNode; className?: string; bare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), id = useId(), { t } = useLocale()
  useEffect(() => {
    const element = ref.current!
    if (!open) { if (element.matches(':popover-open')) element.hidePopover(); return }
    element.style.visibility = 'hidden'
    element.style.setProperty('--popover-available-height', Math.max(0, innerHeight - 18) + 'px')
    element.showPopover()
    function position() {
      const at = anchor?.current?.getBoundingClientRect(), box = element.getBoundingClientRect()
      const left = Math.max(11, Math.min(point?.x ?? (placement === 'rail' && at ? at.right + 11 : at?.left ?? 70), innerWidth - box.width - 11))
      const below = point?.y ?? (at?.bottom ?? 60) + 7
      const top = placement === 'rail' && at ? Math.max(9, Math.min(at.bottom - box.height, innerHeight - box.height - 9)) : below + box.height <= innerHeight - 9 ? below : Math.max(9, (point?.y ?? at?.top ?? 60) - box.height - 7)
      element.style.left = left + 'px'; element.style.top = top + 'px'; element.style.visibility = ''
      element.style.setProperty('--popover-available-height', Math.max(0, innerHeight - top - 9) + 'px')
    }
    position()
    let frame = 0
    const resized = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; position() }) }
    window.addEventListener('resize', resized)
    if (bare) element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    else element.querySelector<HTMLInputElement>('input')?.focus()
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resized) }
  }, [open, point?.x, point?.y])
  return <div ref={ref} popover="auto" role={bare ? 'menu' : 'dialog'} aria-label={bare ? t(title) : undefined} aria-labelledby={bare ? undefined : id} className={(bare ? '' : 'workspace-popover ') + className} onToggle={event => { if (event.newState === 'closed' && open) close() }} onKeyDown={event => {
    if (!bare || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  }}>
    {!bare && <header className="workspace-popover-heading"><div><h2 id={id}>{t(title)}</h2>{description && <p>{t(description)}</p>}</div><IconButton className="workspace-popover-close" label="Fechar" onClick={close}><XMarkIcon className="icon" /></IconButton></header>}{children}
  </div>
}
