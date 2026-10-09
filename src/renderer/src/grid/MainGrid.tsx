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

export function MainGrid({ tx, interaction, measured, panel, closePanel, plugins }: {
  tx: LayoutTransaction; interaction: GridInteraction; measured: ReturnType<typeof useMainMetrics>; panel: PanelState;
  closePanel(): void; plugins: ReturnType<typeof usePlugins>
}) {
  const cs = constraintsFor(tx.snapshot), m = measured.metrics
  return <main ref={measured.main} className={'main-region ' + (tx.editing ? 'editing' : '')} data-region="main" data-testid="layout-canvas"
    data-columns={tx.snapshot.columns} data-rows={tx.snapshot.rows} data-projection-probes={measured.probes}
    data-usable-width={measured.available.width} data-usable-height={measured.available.height}
    data-requested-pitch={measured.requestedPitch} data-edit-width={measured.editViewport?.width} data-edit-height={measured.editViewport?.height} data-edit-pitch={measured.editViewport?.pitch}
    data-cell={m.cell} data-gutter={m.gutter} data-pitch={m.pitch} data-grid-left={measured.offset.left} data-grid-top={measured.offset.top}
    data-grid-width={m.width} data-grid-height={m.height} style={{ '--dock-width': measured.dockWidth + 'px', '--dock-height': measured.dockHeight + 'px' } as CSSProperties}>
    <div ref={measured.tray} className="plugin-tray"><PluginWidgets plugins={plugins} /></div>
    {(!tx.recovery || tx.editing) && tx.snapshot.placements.map(p => <WidgetFrame key={p.id} placement={p} constraint={cs[p.id]!} metrics={m}
      offset={measured.offset} editing={tx.editing} interaction={interaction} />)}
    <TestPanel state={panel} close={closePanel} />
  </main>
}
