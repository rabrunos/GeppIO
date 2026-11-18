import { GIT_TYPE } from '../../../shared/git-widget.ts'

export const GIT_SHARED_VIEW = {
  id: 'git-changes',
  title: 'Alterações Git',
  widgetTypeId: GIT_TYPE,
  presentations: ['widget', 'floating-window'],
  floatingSize: { width: 460, height: 390 }
} as const

export function resolveSharedView(id: unknown, presentation: unknown) {
  return id === GIT_SHARED_VIEW.id && GIT_SHARED_VIEW.presentations.some(kind => kind === presentation) ? GIT_SHARED_VIEW : null
}

export interface FloatingPresentation {
  readonly viewId: typeof GIT_SHARED_VIEW.id
  readonly kind: 'floating-window'
}

export function openFloatingPresentation(current: FloatingPresentation | null, id: unknown, presentation: unknown): FloatingPresentation | null {
  if (current || presentation !== 'floating-window') return current
  const view = resolveSharedView(id, presentation)
  return view ? { viewId: view.id, kind: presentation } : null
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
