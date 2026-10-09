import { useState } from 'react'
import { MotionConfig } from 'motion/react'
import { CommandLineIcon } from '@heroicons/react/24/outline'
import { usePlugins } from './Plugins.tsx'
import { MainGrid } from './grid/MainGrid.tsx'
import { useLayoutTransaction } from './grid/useLayoutTransaction.ts'
import { useGridInteraction } from './grid/useGridInteraction.ts'
import { useMainMetrics } from './grid/useMainMetrics.ts'
import { useProjectedTransaction } from './grid/useProjectedTransaction.ts'
import { Header } from './workbench/Header.tsx'
import { Sidebar } from './workbench/Sidebar.tsx'
import { useRegions } from './workbench/useRegions.ts'
import type { PanelState } from './workbench/TestPanel.tsx'
import { Settings } from './settings/Settings.tsx'
import './workbench/workbench.css'
import './settings/settings.css'
import './fixtures.css'

/** Composition only: native/plugin authority stays in the existing boundaries. */
export function App() {
  const plugins = usePlugins(), tx = useLayoutTransaction(), regions = useRegions()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panel, setPanel] = useState<PanelState>({ open: false, presentation: 'overlay', anchor: 'bottom' })
  const measured = useMainMetrics(tx.snapshot, panel, tx.editViewport)
  const view = useProjectedTransaction(tx, measured.snapshot, { ...measured.available, pitch: measured.metrics.pitch })
  const interaction = useGridInteraction(view, measured.metrics, measured.measurementKey)
  return <MotionConfig reducedMotion="user"><div className="workbench" data-theme={tx.snapshot.theme} onKeyDown={event => {
    if (settingsOpen || event.key !== 'Escape') return
    if (interaction.active()) interaction.end(true); else if (tx.editing) { interaction.end(true); tx.cancel() } else if (panel.open) setPanel({ ...panel, open: false })
  }}>
    <Header editing={tx.editing} theme={tx.snapshot.theme} recovery={tx.recovery} openSettings={() => { interaction.end(true); setSettingsOpen(true) }}
      toggleTheme={tx.toggleTheme} begin={() => { interaction.end(false); view.begin() }} cancel={() => { interaction.end(true); tx.cancel() }} save={() => { interaction.end(false); view.save() }} />
    <div ref={regions.area} className="work-area" style={{ gridTemplateColumns: `${regions.sidebar}px ${regions.splitter}px minmax(0,1fr)`, gridTemplateRows: `minmax(0,1fr) ${regions.splitter}px ${regions.bottom}px` }}>
      <Sidebar selected={interaction.selected} select={interaction.setSelected} />
      <div className="region-splitter sidebar-splitter" role="separator" aria-label="Largura da Sidebar" aria-orientation="vertical" tabIndex={0}
        aria-valuenow={regions.sidebar} aria-valuemin={regions.bounds.sidebar.min} aria-valuemax={regions.bounds.sidebar.max} {...regions.handlers('sidebar')} />
      <MainGrid tx={view} measured={measured} interaction={interaction} panel={panel} plugins={plugins} closePanel={() => setPanel({ ...panel, open: false })} />
      <div className="region-splitter bottom-splitter" role="separator" aria-label="Altura da Bottom" aria-orientation="horizontal" tabIndex={0}
        aria-valuenow={regions.bottom} aria-valuemin={regions.bounds.bottom.min} aria-valuemax={regions.bounds.bottom.max} {...regions.handlers('bottom')} />
      <footer className="bottom-region" data-region="bottom"><div className="bottom-tools"><span className="region-label">BOTTOM</span><button className={'bottom-action ' + (panel.open ? 'active' : '')} onClick={() => setPanel({ ...panel, open: !panel.open })} disabled={tx.editing} aria-label="Abrir ou recolher painel de teste"><CommandLineIcon className="size-4" />Painel de teste</button><span className="bottom-spacer" /><span>{plugins.inventory.plugins.length} plugins locais</span><span className="status-dot" /></div>
        <div className="workspace-feedback" role="status">{[measured.warning, tx.message].filter(Boolean).join(' ')}</div>
      </footer>
    </div>
    {settingsOpen && <Settings plugins={plugins} close={() => setSettingsOpen(false)} tx={tx} panel={panel} setPanel={setPanel} />}
  </div></MotionConfig>
}
