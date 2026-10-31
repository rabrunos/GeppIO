import { memo, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { allowsResize } from '../../../shared/freeform/geometry.ts'
import { DIRECTIONS } from '../../../shared/freeform/types.ts'
import type { Constraint, Direction, Placement } from '../../../shared/freeform/types.ts'
import type { WidgetType } from '../../../shared/workbench/model.ts'
import { WidgetContent } from '../WidgetContent.tsx'
import { useLocale } from '../workbench/Locale.tsx'
import type { Interaction } from './useInteraction.ts'
import type { Measurement } from './useSurfaces.ts'
import { WorkbenchIcon } from '../workbench/WorkbenchIcon.tsx'
import type { useSwap } from '../workbench/useSwap.ts'

const LABELS: Record<Direction, string> = { n: 'borda superior', e: 'borda direita', s: 'borda inferior', w: 'borda esquerda', ne: 'canto superior direito', nw: 'canto superior esquerdo', se: 'canto inferior direito', sw: 'canto inferior esquerdo' }
export const WidgetFrame = memo(function WidgetFrame({ placement: p, measurement: m, constraint, editing, interaction, withheld, unavailable, wheel, definition, children, remove, swap, swapSelected, swapAvailable, motionRevision, motion, ghosted, swapping, inactive }: {
  placement: Placement; measurement: Measurement; constraint: Constraint; editing: boolean; interaction: Interaction; withheld: boolean; unavailable: boolean; inactive: boolean;
  wheel(dx: number, dy: number): void; definition: WidgetType; children?: ReactNode; remove(): void; swap(): void; swapSelected: boolean; swapAvailable: boolean; motionRevision: number; motion: { duration: number; entering: boolean }; ghosted: boolean; swapping: ReturnType<typeof useSwap>
}) {
  const { t } = useLocale(), title = definition.owner === 'host' ? t(definition.title) : definition.title
  const frame = useRef<HTMLElement>(null), previous = useRef<{ left: number; top: number; revision: number; visible: boolean } | null>(null), flight = useRef<Animation | null>(null)
  const left = m.left + p.x - m.scrollLeft, top = m.top + p.y - m.scrollTop
  const clipWidth = m.clipWidth ?? m.width, clipHeight = m.clipHeight ?? m.height
  const outside = p.x + p.width <= m.scrollLeft || p.x >= m.scrollLeft + clipWidth || p.y + p.height <= m.scrollTop || p.y >= m.scrollTop + clipHeight
  const visible = !withheld && !unavailable && m.width > 0 && m.height > 0
  useLayoutEffect(() => {
    const before = previous.current; previous.current = { left, top, revision: motionRevision, visible }
    const changed = before && Math.abs(before.left - left) + Math.abs(before.top - top) >= .2
    if (!visible || (interaction.active() && (interaction.activeId === p.id || changed))) flight.current?.cancel()
    if (!visible || before?.revision === motionRevision || interaction.active() || matchMedia('(prefers-reduced-motion: reduce)').matches || !frame.current) return
    if ((!before || !before.visible) && motion.entering) {
      flight.current?.cancel()
      flight.current = frame.current.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0px)' }], { duration: motion.duration, easing: 'cubic-bezier(.2,.8,.2,1)' }); return
    }
    if (!before || !changed) return
    const matrix = new DOMMatrixReadOnly(getComputedStyle(frame.current).transform)
    flight.current?.cancel()
    flight.current = frame.current.animate([{ transform: `translate(${before.left + matrix.e - left}px, ${before.top + matrix.f - top}px)` }, { transform: 'translate(0,0)' }], { duration: motion.duration, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }, [left, top, motionRevision, visible])
  useLayoutEffect(() => () => flight.current?.cancel(), [])
  return <section className={'widget widget-frame ' + (editing ? 'editing ' : '') + (editing && interaction.selected === p.id ? 'selected ' : '') + (editing && interaction.blocked === p.id ? 'invalid' : '')}
    ref={frame} data-widget-appearance={definition.appearance} data-model-id={`model:${definition.id}`} data-swap-selected={swapSelected ? '' : undefined}
    hidden={withheld || unavailable || m.width <= 0 || m.height <= 0} inert={withheld || unavailable || inactive || (outside && interaction.activeId !== p.id)} data-widget={withheld ? undefined : p.id} data-owner-region={p.region} data-layout-keyboard={import.meta.env.DEV}
    data-widget-id={p.id} data-swap-over={swapping.preview?.target === p.id ? '' : undefined}
    data-x={p.x} data-y={p.y} data-w={p.width} data-h={p.height} data-preferred-w={p.preferred.width} data-preferred-h={p.preferred.height}
    style={{ left, top, width: p.width, height: p.height, opacity: ghosted ? 0 : undefined,
      clipPath: `inset(${Math.max(0, m.top - top)}px ${Math.max(0, left + p.width - m.left - clipWidth)}px ${Math.max(0, top + p.height - m.top - clipHeight)}px ${Math.max(0, m.left - left)}px round var(--card-radius))` }}
    onWheel={e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) wheel(e.deltaX || e.deltaY, 0)
      else if (p.region === 'sidebar') {
        const content = (e.target as Element).closest<HTMLElement>('.widget-content')
        if (!content || (e.deltaY > 0 ? content.scrollTop + content.clientHeight >= content.scrollHeight : content.scrollTop <= 0)) wheel(0, e.deltaY)
      }
    }}>
    <header className="widget-heading" {...(editing ? { ...interaction.handlers(p, 'move'), onClick: undefined, onPointerDown(event) { if (!(event.target as HTMLElement).closest('button,input,textarea,select,a,summary,[contenteditable="true"]')) interaction.handlers(p, 'move').onPointerDown(event) } } : {})}><strong>{title}</strong></header>
    {editing && <><button className="ui-button ui-icon-button widget-grip layout-widget-grip" aria-label={t('Mover {0}', title)} tabIndex={import.meta.env.DEV ? 0 : -1} {...interaction.handlers(p, 'move')}><WorkbenchIcon name="move" /></button><button className="ui-button ui-icon-button layout-widget-remove" aria-label={t('Remover {0}', title)} onClick={remove}><XMarkIcon className="icon" /></button><button className="ui-button ui-icon-button widget-swap-control" hidden={!swapAvailable || !swapSelected} aria-label={t('Trocar widget de {0}', title)} title={t('Arraste sobre outro widget selecionado para trocar os espaços')} aria-pressed={swapSelected} onClick={swap} {...swapping.handlers(p.id)}><WorkbenchIcon name="move" /></button></>}
    <div className="widget-content">{children ?? <WidgetContent id={definition.fixture ?? ''} />}</div>
    {editing && DIRECTIONS.filter(d => allowsResize(d, constraint)).map(d => <button key={d} className={'resize-zone resize-' + d} data-resize={d}
      tabIndex={import.meta.env.DEV ? 0 : -1} aria-label={t('Redimensionar {0}: {1}', title, t(LABELS[d]))}
      title={t('Redimensionar pela {0}', t(LABELS[d])) + (import.meta.env.DEV ? t(' · use as setas') : '')} {...interaction.handlers(p, d)} />)}
  </section>
})
