import { memo, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { allowsResize } from '../../../shared/freeform/geometry.ts'
import { DIRECTIONS } from '../../../shared/freeform/types.ts'
import type { Constraint, Direction, Placement } from '../../../shared/freeform/types.ts'
import type { Edge } from '../../../shared/workbench/presentations.ts'
import type { HTMLAttributes } from 'react'
import type { WidgetType } from '../../../shared/workbench/model.ts'
import { WidgetContent } from '../WidgetContent.tsx'
import { useLocale } from '../workbench/Locale.tsx'
import type { Interaction } from './useInteraction.ts'
import type { Measurement } from './useSurfaces.ts'
import { projectFrame } from './frame-layout.ts'
import type { FrameSpace } from './frame-layout.ts'
import { WorkbenchIcon } from '../workbench/WorkbenchIcon.tsx'
import type { useSwap } from '../workbench/useSwap.ts'

const LABELS: Record<Direction, string> = { n: 'borda superior', e: 'borda direita', s: 'borda inferior', w: 'borda esquerda', ne: 'canto superior direito', nw: 'canto superior esquerdo', se: 'canto inferior direito', sw: 'canto inferior esquerdo' }
export const WidgetFrame = memo(function WidgetFrame({ placement: p, measurement: m, space = 'content', constraint, editing, interaction, withheld, unavailable, wheel, definition, children, remove, swap, swapSelected, swapAvailable, motionRevision, motion, ghosted, swapping, inactive, presentation, controls, surfaceActions, organizationActions, tabs, groupMember, groupHost, surfaceId, contentHidden, contentId, labelledBy, headingTitle, removeTitle, editControls = editing, hover, blur }: {
  organizationActions?: ReactNode; tabs?: ReactNode; groupMember?: boolean; groupHost?: boolean; surfaceId?: string; contentHidden?: boolean; contentId?: string; labelledBy?: string; headingTitle?: string; removeTitle?: string;
  surfaceActions?: ReactNode;
  controls?: ReactNode; editControls?: boolean; hover?(inside: boolean): void; blur?(): void;
  presentation?: { mode: 'normal' | 'docked' | 'overlay'; open: boolean; anchor: Edge | null; gesture?: boolean; freeHandlers?: HTMLAttributes<HTMLElement>; compactHandlers?: HTMLAttributes<HTMLElement> }; space?: FrameSpace;
  placement: Placement; measurement: Measurement; constraint: Constraint; editing: boolean; interaction: Interaction; withheld: boolean; unavailable: boolean; inactive: boolean;
  wheel(dx: number, dy: number): void; definition: WidgetType; children?: ReactNode; remove(): void; swap(): void; swapSelected: boolean; swapAvailable: boolean; motionRevision: number; motion: { duration: number; entering: boolean }; ghosted: boolean; swapping: ReturnType<typeof useSwap>
}) {
  const { t } = useLocale(), title = headingTitle ?? (definition.owner === 'host' ? t(definition.title) : definition.title)
  const frame = useRef<HTMLElement>(null), previous = useRef<{ left: number; top: number; width: number; height: number; open?: boolean; revision: number; visible: boolean; mode?: string } | null>(null), flight = useRef<Animation | null>(null)
  const { left, top, outside, clipPath, available } = projectFrame(p, m, space)
  const visible = !withheld && !unavailable && available
  const focusInside = frame.current?.querySelector('.widget-content')?.contains(document.activeElement)
  useLayoutEffect(() => {
    const before = previous.current; previous.current = { left, top, width: p.width, height: p.height, open: presentation?.open, revision: motionRevision, visible, mode: presentation?.mode }
    if (before?.mode !== presentation?.mode || presentation?.gesture) { flight.current?.cancel(); return }
    const changed = before && Math.abs(before.left - left) + Math.abs(before.top - top) >= .2
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const reveal = before && presentation?.mode === 'overlay' && before.open !== presentation.open
    const geometryChanged = changed || (before && (before.width !== p.width || before.height !== p.height))
    // Viewport tracks are already animated by the host. Every widget follows the
    // measured frame directly; a second left/width animation would lag behind it.
    if (before?.revision === motionRevision && geometryChanged && !reveal) flight.current?.cancel()
    // The top-layer picture owns this view through pickup, landing and return.
    // Keep its underlying rectangle final, so measuring/revealing cannot see a FLIP.
    if (ghosted || !visible || (interaction.active() && (interaction.activeId === p.id || changed))) flight.current?.cancel()
    if (ghosted || !visible || (before?.revision === motionRevision && !reveal) || interaction.active() || reduced || !frame.current) return
    if ((!before || !before.visible) && motion.entering) {
      flight.current?.cancel()
      flight.current = frame.current.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0px)' }], { duration: motion.duration, easing: 'cubic-bezier(.2,.8,.2,1)' }); return
    }
    if (!before || (!geometryChanged && !reveal)) return
    const style = getComputedStyle(frame.current), matrix = new DOMMatrixReadOnly(style.transform)
    const token = style.getPropertyValue(presentation?.open ? '--region-motion' : '--sidebar-hide-motion').trim()
    const duration = reveal ? parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) : motion.duration
    const running = flight.current?.playState === 'running'
    const width = running ? parseFloat(style.width) : before.width, height = running ? parseFloat(style.height) : before.height
    flight.current?.cancel()
    flight.current = frame.current.animate([{ transform: `translate(${before.left + matrix.e - left}px, ${before.top + matrix.f - top}px)`, width: width + 'px', height: height + 'px' },
      { transform: 'translate(0,0)', width: p.width + 'px', height: p.height + 'px' }], { duration, easing: reveal ? style.getPropertyValue('--region-easing').trim() : 'cubic-bezier(.2,.8,.2,1)' })
  }, [left, top, p.width, p.height, motionRevision, visible, ghosted, presentation?.mode, presentation?.open, presentation?.gesture])
  useLayoutEffect(() => () => flight.current?.cancel(), [])
  useLayoutEffect(() => {
    if (presentation?.open === false && focusInside) (document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(p.id)}-presentation"]`) ?? frame.current)?.focus({ preventScroll: true })
  }, [presentation?.open])
  return <section id={presentation ? p.id + '-presentation' : undefined} data-group-host={groupHost || undefined} data-group-member={groupMember || undefined} data-presentation={presentation?.mode} data-panel-open={presentation?.open} data-panel-anchor={presentation?.anchor ?? 'free'} className={'widget widget-frame ' + (editing ? 'editing ' : '') + (editing && interaction.selected === p.id ? 'selected ' : '') + (editing && interaction.blocked === p.id ? 'invalid' : '')}
    ref={frame} onPointerEnter={() => hover?.(true)} onPointerLeave={() => hover?.(false)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) blur?.() }} data-widget-appearance={definition.appearance} data-model-id={`model:${definition.id}`} data-swap-selected={swapSelected ? '' : undefined}
    tabIndex={presentation ? -1 : undefined} hidden={!visible} inert={withheld || unavailable || inactive || (outside && interaction.activeId !== p.id)} data-widget={withheld ? undefined : surfaceId ?? p.id} data-owner-region={p.region} data-layout-keyboard={import.meta.env.DEV}
    data-widget-id={p.id} data-panel-gesture={presentation?.gesture || undefined} data-swap-over={swapping.preview?.target === p.id ? '' : undefined}
    data-x={p.x} data-y={p.y} data-w={p.width} data-h={p.height} data-preferred-w={p.preferred.width} data-preferred-h={p.preferred.height}
    style={{ left, top, width: p.width, height: p.height, opacity: ghosted ? 0 : undefined, clipPath }}
    onWheel={e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) wheel(e.deltaX || e.deltaY, 0)
      else if (p.region === 'sidebar') {
        const content = (e.target as Element).closest<HTMLElement>('.widget-content')
        if (!content || (e.deltaY > 0 ? content.scrollTop + content.clientHeight >= content.scrollHeight : content.scrollTop <= 0)) wheel(0, e.deltaY)
      }
    }}>
    <header className="widget-heading" role={presentation?.freeHandlers || presentation?.compactHandlers ? 'button' : undefined} tabIndex={presentation?.freeHandlers || presentation?.compactHandlers ? 0 : undefined} aria-label={presentation?.freeHandlers || presentation?.compactHandlers ? t('Painel de {0}', title) : undefined} aria-expanded={presentation?.freeHandlers || presentation?.compactHandlers ? presentation.open : undefined} {...(editing ? { ...interaction.handlers(p, 'move'), onClick: undefined, onPointerDown(event) { if (!(event.target as HTMLElement).closest('button,input,textarea,select,a,summary,[contenteditable="true"]')) interaction.handlers(p, 'move').onPointerDown(event) } } : presentation?.compactHandlers ?? presentation?.freeHandlers ?? {})}><strong>{title}</strong></header>
    {editing && <button className="ui-button ui-icon-button widget-grip layout-widget-grip" aria-label={t('Mover {0}', title)} tabIndex={import.meta.env.DEV ? 0 : -1} {...interaction.handlers(p, 'move')}><WorkbenchIcon name="move" /></button>}
    {tabs}
    {organizationActions}
    {surfaceActions && <div className="widget-surface-actions">{surfaceActions}</div>}
    {editControls && <div className="widget-local-controls">{controls}<button className="ui-button ui-icon-button layout-widget-remove" aria-label={t('Remover {0}', removeTitle ?? title)} onClick={remove}><XMarkIcon className="icon" /></button></div>}
    {editing && <button className="ui-button ui-icon-button widget-swap-control" hidden={!swapAvailable || !swapSelected} aria-label={t('Trocar widget de {0}', title)} title={t('Arraste sobre outro widget selecionado para trocar os espaços')} aria-pressed={swapSelected} onClick={swap} {...swapping.handlers(p.id)}><WorkbenchIcon name="move" /></button>}
    <div className="widget-content" id={contentId} role={contentId ? 'tabpanel' : undefined} aria-labelledby={labelledBy} hidden={contentHidden} inert={presentation?.open === false || contentHidden}>{children ?? <WidgetContent id={definition.fixture ?? ''} />}</div>
    {editing && DIRECTIONS.filter(d => allowsResize(d, constraint)).map(d => <button key={d} className={'resize-zone resize-' + d} data-resize={d}
      tabIndex={import.meta.env.DEV ? 0 : -1} aria-label={t('Redimensionar {0}: {1}', title, t(LABELS[d]))}
      title={t('Redimensionar pela {0}', t(LABELS[d])) + (import.meta.env.DEV ? t(' · use as setas') : '')} {...interaction.handlers(p, d)} />)}
  </section>
})
