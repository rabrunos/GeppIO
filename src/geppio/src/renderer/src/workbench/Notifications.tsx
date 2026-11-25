import { useEffect, useReducer, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { BellIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { usePlugins } from '../Plugins.tsx'
import { reduceNotifications } from '../../../shared/workbench/notifications.ts'
import type { WorkspaceNotification } from '../../../shared/workbench/notifications.ts'
import { Popover, IconButton } from './Primitives.tsx'
import { useLocale } from './Locale.tsx'

export function useNotifications(plugins: ReturnType<typeof usePlugins>) {
  const [items, dispatch] = useReducer(reduceNotifications, [])
  const previous = useRef<Map<string, { name: string; enabled: boolean }> | null>(null), statuses = useRef(new Map<string, string>())
  useEffect(() => {
    if (plugins.busy) return
    const next = new Map(plugins.inventory.plugins.map(plugin => [plugin.manifest.id, { name: plugin.manifest.name, enabled: plugin.enabled }]))
    const emit = (title: string, message: string, name: string) => dispatch({ type: 'add', item: { id: crypto.randomUUID(), title, message, params: [name], at: Date.now(), read: false } })
    if (previous.current) {
      for (const [id, plugin] of next) {
        const old = previous.current.get(id)
        if (!old) emit('Plugin instalado', '“{0}” foi instalado. Ative quando quiser usar.', plugin.name)
        else if (old.enabled !== plugin.enabled) emit(plugin.enabled ? 'Plugin habilitado' : 'Plugin desativado', plugin.enabled ? 'A ativação de “{0}” foi solicitada.' : 'A execução de “{0}” foi encerrada.', plugin.name)
      }
      for (const [id, plugin] of previous.current) if (!next.has(id)) emit('Plugin removido', '“{0}” foi removido do inventário.', plugin.name)
    }
    previous.current = next
  }, [plugins.inventory, plugins.busy])
  useEffect(() => {
    for (const view of plugins.views) {
      if (view.status === 'error' && statuses.current.has(view.plugin.manifest.id) && statuses.current.get(view.plugin.manifest.id) !== 'error') dispatch({ type: 'add', item: {
        id: crypto.randomUUID(), title: 'Falha no plugin', message: '“{0}” precisa de atenção.', params: [view.plugin.manifest.name], detail: view.detail, at: Date.now(), read: false
      } })
    }
    statuses.current = new Map(plugins.views.map(view => [view.plugin.manifest.id, view.status]))
  }, [plugins.views])
  return { items, unread: items.filter(item => !item.read).length, dispatch }
}

export function NotificationCenter({ open, close, anchor, notifications }: { open: boolean; close(): void; anchor: RefObject<HTMLElement | null>; notifications: ReturnType<typeof useNotifications> }) {
  const { t, locale } = useLocale(), [unreadOnly, setUnreadOnly] = useState(false)
  const { items, unread, dispatch } = notifications, visible = items.filter(item => !unreadOnly || !item.read)
  const title = (item: WorkspaceNotification) => t(item.title)
  return <Popover title="Notificações" description="Acompanhe as novidades do seu espaço." className="notifications-menu ui-scrollbar" open={open} close={close} anchor={anchor}>
    <div className="notification-toolbar"><div role="group" aria-label={t('Filtrar notificações')}>
      <button className="ui-button" data-notification-filter="all" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{t('Todas')}</button>
      <button className="ui-button" data-notification-filter="unread" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{t('Não lidas')} <span data-unread-count>{unread}</span></button>
    </div><button className="ui-button workspace-text-action" aria-label={t('Marcar todas como lidas')} disabled={!unread} onClick={() => dispatch({ type: 'read' })}><CheckIcon className="icon" />{t('Ler todas')}</button></div>
    <div className="notification-list" data-notification-list>{visible.map(item => <article className="notification-entry" key={item.id} data-unread={!item.read}>
      <button className="ui-button" aria-label={t('Marcar como lida: {0}', title(item))} onClick={() => dispatch({ type: 'read', id: item.id })}><strong>{title(item)}</strong><p>{t(item.message, ...item.params)}</p>{item.detail && <p>{item.detail}</p>}<time dateTime={new Date(item.at).toISOString()}>{new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(item.at)}</time></button>
      <IconButton className="notification-dismiss" label={t('Dispensar: {0}', title(item))} onClick={() => dispatch({ type: 'dismiss', id: item.id })}><XMarkIcon className="icon" /></IconButton>
    </article>)}</div>
    {!visible.length && <div className="notification-empty"><BellIcon className="icon" /><strong>{t('Você está em dia')}</strong><p>{t('As novidades aparecem por aqui.')}</p></div>}
    <footer className="workspace-panel-footer"><span>{t('Atividade deste espaço')}</span><button className="ui-button workspace-text-action" disabled={!items.length} onClick={() => dispatch({ type: 'clear' })}>{t('Limpar')}</button></footer>
  </Popover>
}
