import { memo } from 'react'
import { allowsResize } from '../../../shared/freeform/geometry.ts'
import { DIRECTIONS } from '../../../shared/freeform/types.ts'
import type { Constraint, Direction, Placement } from '../../../shared/freeform/types.ts'
import { WIDGETS } from '../fixtures.ts'
import { WidgetContent } from '../WidgetContent.tsx'
import type { Interaction } from './useInteraction.ts'
import type { Measurement } from './useSurfaces.ts'

const LABELS: Record<Direction, string> = { n: 'borda superior', e: 'borda direita', s: 'borda inferior', w: 'borda esquerda', ne: 'canto superior direito', nw: 'canto superior esquerdo', se: 'canto inferior direito', sw: 'canto inferior esquerdo' }
export const WidgetFrame = memo(function WidgetFrame({ placement: p, measurement: m, constraint, editing, interaction, withheld, unavailable, wheel }: {
  placement: Placement; measurement: Measurement; constraint: Constraint; editing: boolean; interaction: Interaction; withheld: boolean; unavailable: boolean;
  wheel(dx: number, dy: number): void
}) {
  const title = WIDGETS.find(w => w.id === p.id)!
  const left = m.left + p.x - m.scrollLeft, top = m.top + p.y - m.scrollTop
  const outside = p.x + p.width <= m.scrollLeft || p.x >= m.scrollLeft + m.width || p.y + p.height <= m.scrollTop || p.y >= m.scrollTop + m.height
  return <section className={'widget-frame ' + (editing ? 'editing ' : '') + (interaction.selected === p.id ? 'selected ' : '') + (editing && interaction.blocked === p.id ? 'invalid' : '')}
    hidden={withheld || unavailable || m.width <= 0 || m.height <= 0} inert={withheld || unavailable || outside} data-widget={withheld ? undefined : p.id} data-owner-region={p.region}
    data-x={p.x} data-y={p.y} data-w={p.width} data-h={p.height} data-preferred-w={p.preferred.width} data-preferred-h={p.preferred.height}
    style={{ left, top, width: p.width, height: p.height,
      clipPath: `inset(${Math.max(0, m.top - top)}px ${Math.max(0, left + p.width - m.left - m.width)}px ${Math.max(0, top + p.height - m.top - m.height)}px ${Math.max(0, m.left - left)}px)` }}
    onWheel={e => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) wheel(e.deltaX || e.deltaY, 0)
      else if (p.region === 'sidebar') {
        const content = (e.target as Element).closest<HTMLElement>('.widget-content')
        if (!content || (e.deltaY > 0 ? content.scrollTop + content.clientHeight >= content.scrollHeight : content.scrollTop <= 0)) wheel(0, e.deltaY)
      }
    }}>
    <header className="widget-heading"><button className="widget-grip" aria-label={'Mover ' + title.title} tabIndex={editing ? 0 : -1} {...interaction.handlers(p, 'move')}>
      <span className="grip-dots">⠿</span><strong>{title.title}</strong></button><span className="widget-kind">{title.type}</span></header>
    <div className="widget-content"><WidgetContent id={p.id} /></div>
    {editing && DIRECTIONS.filter(d => allowsResize(d, constraint)).map(d => <button key={d} className={'resize-zone resize-' + d} data-resize={d}
      aria-label={'Redimensionar ' + title.title + ': ' + LABELS[d]} title={'Redimensionar pela ' + LABELS[d] + ' · use as setas'} {...interaction.handlers(p, d)} />)}
  </section>
})
