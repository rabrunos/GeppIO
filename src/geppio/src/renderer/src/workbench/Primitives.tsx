import type { ComponentProps } from 'react'
import { Dialog as BaseDialog, IconButton as BaseButton, Popover as BasePopover } from '@geppio/ui'
import { useLocale } from './Locale.tsx'
export { useModalDialog } from '@geppio/ui'

export function IconButton({ label, literalLabel, ...props }: ComponentProps<typeof BaseButton> & { literalLabel?: boolean }) {
  const { t } = useLocale()
  return <BaseButton label={literalLabel ? label : t(label)} {...props} />
}

export function Dialog({ title, ...props }: Omit<ComponentProps<typeof BaseDialog>, 'closeLabel'>) {
  const { t } = useLocale()
  return <BaseDialog title={t(title)} closeLabel={t('Fechar')} {...props} />
}

export function Popover({ title, description, ...props }: Omit<ComponentProps<typeof BasePopover>, 'closeLabel'>) {
  const { t } = useLocale()
  return <BasePopover title={t(title)} description={description && t(description)} closeLabel={t('Fechar')} {...props} />
}

export function Confirm({ title, text, confirm, close, destructive = true, label = 'Confirmar' }: { title: string; text: string; confirm(): void; close(): void; destructive?: boolean; label?: string }) {
  const { t } = useLocale()
  return <Dialog title={title} close={close} className="confirmation-dialog"><p className="profile-dialog-description">{text}</p><div className="workspace-dialog-actions"><button className="ui-button workspace-secondary" onClick={close}>{t('Cancelar')}</button><button className={'ui-button workspace-primary ' + (destructive ? 'is-destructive' : '')} onClick={() => { confirm(); close() }}>{t(label)}</button></div></Dialog>
}
