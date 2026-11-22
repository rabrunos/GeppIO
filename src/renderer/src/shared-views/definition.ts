import { GIT_TYPE } from '../../../shared/git-widget.ts'

export const GIT_SHARED_VIEW = {
  id: 'git-changes',
  title: 'Alterações Git',
  widgetTypeId: GIT_TYPE,
  presentations: ['widget', 'floating-window'],
  floatingSize: { width: 460, height: 390 }
} as const

export const SEARCH_SHARED_VIEW = {
  id: 'project-search',
  title: 'Busca no projeto',
  presentations: ['code-activity', 'floating-window'],
  floatingSize: { width: 410, height: 350 }
} as const

export const SHARED_VIEWS = [GIT_SHARED_VIEW, SEARCH_SHARED_VIEW] as const
export type SharedViewId = typeof SHARED_VIEWS[number]['id']

export function resolveSharedView(id: unknown, presentation: unknown) {
  return SHARED_VIEWS.find(view => view.id === id && view.presentations.some(kind => kind === presentation)) ?? null
}

export interface FloatingPresentation {
  readonly viewId: SharedViewId
  readonly kind: 'floating-window'
}

export function raiseFloatingPresentation(current: readonly FloatingPresentation[], id: SharedViewId) {
  const existing = current.find(instance => instance.viewId === id)
  if (!existing || existing === current.at(-1)) return current
  return [...current.filter(instance => instance !== existing), existing]
}

export function closeFloatingPresentation(current: readonly FloatingPresentation[], id: SharedViewId) {
  return current.filter(instance => instance.viewId !== id)
}

export function openFloatingPresentation(current: readonly FloatingPresentation[], id: unknown, presentation: unknown): readonly FloatingPresentation[] {
  if (presentation !== 'floating-window') return current
  const view = resolveSharedView(id, presentation)
  if (!view) return current
  if (current.some(instance => instance.viewId === view.id)) return raiseFloatingPresentation(current, view.id)
  return [...current, { viewId: view.id, kind: presentation }]
}

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export function floatingBounds(area: Size, preferred: Size, position: Point | null) {
  function axis(available: number, desired: number, offset: number | undefined, alignEnd: boolean) {
    const edge = Math.min(12, available / 2)
    const size = Math.min(desired, available - 2 * edge)
    const end = available - size - edge
    const start = offset ?? (alignEnd ? end - 20 : edge + 12)
    return { size, start: Math.max(edge, Math.min(start, end)) }
  }
  const horizontal = axis(area.width, preferred.width, position?.x, true)
  const vertical = axis(area.height, preferred.height, position?.y, false)
  return { x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size }
}
