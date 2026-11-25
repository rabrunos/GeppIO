import type { CSSProperties } from 'react'
import { constraintsFor } from '../../../shared/grid/policy.ts'
import { PluginWidgets } from '../Plugins.tsx'
import type { usePlugins } from '../Plugins.tsx'
import { TestPanel } from '../workbench/TestPanel.tsx'
import type { PanelState } from '../workbench/TestPanel.tsx'
import type { useMainMetrics } from './useMainMetrics.ts'
import type { LayoutTransaction } from './useLayoutTransaction.ts'
import type { GridInteraction } from './useGridInteraction.ts'
import { WidgetFrame } from './WidgetFrame.tsx'
import './grid.css'
import { horizontalConstraints } from '../../../shared/grid/horizontal.ts'
import type { HorizontalScroll } from './useHorizontalScroll.ts'

export function MainGrid({ tx, interaction, measured, panel, closePanel, plugins, horizontal }: {
  tx: LayoutTransaction; interaction: GridInteraction; measured: ReturnType<typeof useMainMetrics>; panel: PanelState;
  closePanel(): void; plugins: ReturnType<typeof usePlugins>; horizontal?: HorizontalScroll
}) {
  const cs = horizontal ? horizontalConstraints() : constraintsFor(tx.snapshot), m = measured.metrics
  return <main ref={measured.main} className={'main-region ' + (horizontal ? 'horizontal-main ' : '') + (tx.editing ? 'editing' : '')} data-region="main" data-testid="layout-canvas" data-engine={horizontal ? 'horizontal' : 'responsive'}
    data-columns={tx.snapshot.columns} data-rows={tx.snapshot.rows} data-projection-probes={measured.probes}
    data-usable-width={measured.available.width} data-usable-height={measured.available.height}
    data-requested-pitch={measured.requestedPitch} data-edit-width={measured.editViewport?.width} data-edit-height={measured.editViewport?.height} data-edit-pitch={measured.editViewport?.pitch}
    data-cell={m.cell} data-gutter={m.gutter} data-pitch={m.pitch} data-grid-left={measured.offset.left} data-grid-top={measured.offset.top}
    data-grid-width={m.width} data-grid-height={m.height} style={{ '--dock-width': measured.dockWidth + 'px', '--dock-height': measured.dockHeight + 'px' } as CSSProperties}>
    <div ref={measured.tray} className="plugin-tray"><PluginWidgets plugins={plugins} /></div>
    <div ref={horizontal?.port} className="main-scrollport" role={horizontal ? 'region' : undefined} tabIndex={horizontal ? 0 : undefined} aria-label={horizontal ? 'Área horizontal de widgets' : undefined}
      onScroll={horizontal?.sync} onKeyDown={event => {
        if (!horizontal || event.target !== event.currentTarget) return
        const delta = event.key === 'ArrowRight' ? m.pitch : event.key === 'ArrowLeft' ? -m.pitch : event.key === 'PageDown' ? m.width : event.key === 'PageUp' ? -m.width : 0
        if (delta || event.key === 'Home' || event.key === 'End') { event.preventDefault(); horizontal.to(event.key === 'Home' ? 0 : event.key === 'End' ? horizontal.maximum : horizontal.position + delta) }
      }}>
    <div className="main-world" style={horizontal ? { width: horizontal.width, height: m.height, transform: `translateX(${horizontal.correction}px)` } : undefined}>
    {tx.snapshot.placements.map(p => <WidgetFrame key={p.id} placement={p} constraint={cs[p.id]!} metrics={m}
      offset={measured.offset} editing={tx.editing} withheld={tx.recovery && !tx.editing} interaction={interaction} />)}
    </div></div>
    {horizontal && horizontal.maximum > 0 && <input className="horizontal-scrollbar" type="range" min={0} max={horizontal.maximum} step="any" value={horizontal.position}
      aria-label="Rolagem horizontal da Main" aria-valuetext={`${Math.round(horizontal.position)} de ${horizontal.maximum} pixels`}
      style={{ '--thumb-width': Math.max(24, m.width * m.width / horizontal.width) + 'px' } as CSSProperties}
      onChange={event => horizontal.to(Number(event.target.value))} />}
    <TestPanel state={horizontal ? { ...panel, presentation: 'overlay' } : panel} close={closePanel} />
  </main>
}
