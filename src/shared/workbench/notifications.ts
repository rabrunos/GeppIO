/** Session-local host events. No remote source, persisted sample news or Worker. */
export interface WorkspaceNotification {
  id: string; title: string; message: string; params: string[]; detail?: string; at: number; read: boolean
}
export type NotificationAction = { type: 'add'; item: WorkspaceNotification } | { type: 'read'; id?: string } | { type: 'dismiss'; id: string } | { type: 'clear' }
export function reduceNotifications(items: readonly WorkspaceNotification[], action: NotificationAction): WorkspaceNotification[] {
  if (action.type === 'add') return [action.item, ...items.filter(item => item.id !== action.item.id)].slice(0, 20)
  if (action.type === 'clear') return []
  if (action.type === 'dismiss') return items.filter(item => item.id !== action.id)
  return items.map(item => !action.id || item.id === action.id ? { ...item, read: true } : item)
}
