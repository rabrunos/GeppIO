import { allowsResize, pixelRect } from '../../../shared/grid/geometry.ts'
import type { GridMetrics } from '../../../shared/grid/geometry.ts'
import { DIRECTIONS } from '../../../shared/grid/types.ts'
import type { Direction, GridConstraint, GridPlacement } from '../../../shared/grid/types.ts'
import { WIDGETS } from '../fixtures.ts'
import { WidgetContent } from '../WidgetContent.tsx'
import type { GridInteraction } from './useGridInteraction.ts'

const LABELS: Record<Direction, string> = { n: 'borda superior', e: 'borda direita', s: 'borda inferior', w: 'borda esquerda', ne: 'canto superior direito', nw: 'canto superior esquerdo', se: 'canto inferior direito', sw: 'canto inferior esquerdo' }
export function WidgetFrame({ placement: p, metrics, constraint, editing, interaction, offset }: {
  placement: GridPlacement; metrics: GridMetrics; constraint: GridConstraint; editing: boolean; interaction: GridInteraction; offset: { left: number; top: number }
}) {
  const title = WIDGETS.find(w => w.id === p.id)!, rect = pixelRect(p, metrics)
  return <section className={'widget-frame ' + (interaction.selected === p.id ? 'selected ' : '') + (interaction.blocked === p.id ? 'invalid' : '')}
    data-widget={p.id} data-x={p.x} data-y={p.y} data-w={p.w} data-h={p.h}
    style={{ ...rect, left: rect.left + offset.left, top: rect.top + offset.top }}>
    <header className="widget-heading"><button className="widget-grip" aria-label={'Mover ' + title.title} tabIndex={editing ? 0 : -1} {...interaction.handlers(p, 'move')}>
      <span className="grip-dots">⠿</span><strong>{title.title}</strong></button><span className="widget-kind">{title.type}</span></header>
    <div className="widget-content"><WidgetContent id={p.id} /></div>
    {editing && DIRECTIONS.filter(d => allowsResize(d, constraint)).map(d => <button key={d} className={'resize-zone resize-' + d} data-resize={d}
      aria-label={'Redimensionar ' + title.title + ': ' + LABELS[d]} title={'Redimensionar pela ' + LABELS[d] + ' · use as setas'} {...interaction.handlers(p, d)} />)}
  </section>
}
