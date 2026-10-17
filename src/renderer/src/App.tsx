import { useState } from 'react'
import type { CSSProperties } from 'react'
import { MotionConfig } from 'motion/react'
import { CommandLineIcon } from '@heroicons/react/24/outline'
import { PluginWidgets, usePlugins } from './Plugins.tsx'
import { CONSTRAINTS, constraintsFor, EXPANSION_KEY } from '../../shared/freeform/policy.ts'
import { projectRegion } from '../../shared/freeform/projection.ts'
import { REGIONS } from '../../shared/freeform/types.ts'
import type { Region, Snapshot } from '../../shared/freeform/types.ts'
import { REGION_LABELS } from '../../shared/freeform/transfer.ts'
import { useTransaction } from './freeform/useTransaction.ts'
import { useSurfaces } from './freeform/useSurfaces.ts'
import { useInteraction } from './freeform/useInteraction.ts'
import { WidgetFrame } from './freeform/WidgetFrame.tsx'
import { Header } from './workbench/Header.tsx'
import { Sidebar } from './workbench/Sidebar.tsx'
import { useRegions } from './workbench/useRegions.ts'
import { TestPanel } from './workbench/TestPanel.tsx'
import type { PanelState } from './workbench/TestPanel.tsx'
import { Settings } from './settings/Settings.tsx'
import './workbench/workbench.css'
import './settings/settings.css'
import './fixtures.css'
import './freeform/freeform.css'

/** App owns plugin lifetimes. Visibility and region changes never activate/dispose Workers. */
export function App() {
  const plugins = usePlugins(), tx = useTransaction(), regions = useRegions(), surfaces = useSurfaces()
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem(EXPANSION_KEY) === 'true' } catch { return false } })
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const stored = localStorage.getItem('geppio:theme:v1')
      if (stored === 'dark' || stored === 'light') return stored
      const old: unknown = JSON.parse(localStorage.getItem('geppio:layout:grid:v2') ?? localStorage.getItem('geppio:layout:v1') ?? 'null')
      return old && typeof old === 'object' && 'theme' in old && old.theme === 'light' ? 'light' : 'dark'
    } catch { return 'dark' }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panel, setPanel] = useState<PanelState>({ open: false, presentation: 'overlay', anchor: 'bottom' })
  const projected = Object.fromEntries(REGIONS.map(r => [r, projectRegion(tx.snapshot, r, surfaces.measures[r], expanded && r !== 'sidebar')])) as Record<Region, ReturnType<typeof projectRegion>>
  const feasible = Object.fromEntries(REGIONS.map(r => [r, projected[r].feasible])) as Record<Region, boolean>
  const view: Snapshot = { ...tx.snapshot, reference: { ...tx.snapshot.reference }, placements: tx.snapshot.placements.map(p => projected[p.region].placements.find(q => q.id === p.id)!) }
  for (const r of REGIONS) {
    const m = surfaces.measures[r]
    if (feasible[r] && m.width > 0 && m.height > 0) view.reference[r] = { width: m.width, height: m.height }
  }
  const interaction = useInteraction(tx, view, surfaces, expanded, feasible)
  const selected = view.placements.find(p => p.id === interaction.selected)
  function toggleExpansion(next: boolean) {
    interaction.end(true); setExpanded(next)
    try { localStorage.setItem(EXPANSION_KEY, String(next)) } catch { tx.setMessage('Expansão alterada nesta sessão; não foi possível salvar a preferência.') }
  }
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next)
    try { localStorage.setItem('geppio:theme:v1', next) } catch { tx.setMessage('Tema alterado nesta sessão; não foi possível salvar a preferência.') }
  }
  function port(region: Region) {
    const projection = projected[region]
    return <div ref={surfaces.ports[region]} className={'placement-port ' + (!projection.feasible ? 'recovery-surface' : '')}
      data-surface={region} data-feasible={projection.feasible} data-usable-width={surfaces.measures[region].width} data-usable-height={surfaces.measures[region].height}
      role="region" tabIndex={expanded || !projection.feasible ? 0 : -1} aria-label={'Área de widgets da ' + REGION_LABELS[region]} onScroll={surfaces.measure}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        const element = e.currentTarget, delta = e.key === 'ArrowRight' ? 30 : e.key === 'ArrowLeft' ? -30 : e.key === 'PageDown' ? element.clientWidth : e.key === 'PageUp' ? -element.clientWidth : 0
        if (delta || e.key === 'Home' || e.key === 'End') { e.preventDefault(); element.scrollLeft = e.key === 'Home' ? 0 : e.key === 'End' ? element.scrollWidth : element.scrollLeft + delta }
      }}><div className="placement-world" style={{ width: Math.max(projection.world.width, interaction.heldExtent?.region === region ? interaction.heldExtent.width : 0), height: projection.world.height }} /></div>
  }
  const docked = panel.open && panel.presentation === 'docked'
  const mainElement = surfaces.ports.main.current?.closest<HTMLElement>('[data-region="main"]')
  const dockWidth = docked && ['left', 'right'].includes(panel.anchor) ? Math.min(270, Math.max(0, (mainElement?.clientWidth ?? 0) - (expanded ? 15 : 30)) / 3) : 0
  const dockHeight = docked && ['top', 'bottom'].includes(panel.anchor) ? Math.min(180, Math.max(0, (mainElement?.clientHeight ?? 0) - 30) / 3) : 0
  return <MotionConfig reducedMotion="user"><div className="workbench" data-theme={theme} style={{ '--main-start': regions.sidebar + (regions.collapsed.sidebar ? 0 : regions.splitter) + 15 + 'px' } as CSSProperties} onKeyDown={event => {
    if (settingsOpen || event.key !== 'Escape') return
    if (interaction.active()) interaction.end(true); else if (tx.editing) tx.cancel(); else if (panel.open) setPanel({ ...panel, open: false })
  }}>
    <Header editing={tx.editing} theme={theme} recovery={tx.recovery} openSettings={() => { interaction.end(true); setSettingsOpen(true) }}
      toggleTheme={toggleTheme} begin={() => { interaction.end(false); tx.begin(view) }} cancel={() => { interaction.end(true); tx.cancel() }} save={() => {
        interaction.end(false)
        if (REGIONS.some(r => !feasible[r] && view.placements.some(p => p.region === r))) { tx.setMessage('Espaço insuficiente. Amplie ou reabra a região antes de salvar; a composição original foi preservada.'); return }
        void tx.save(view)
      }}><div className="layout-controls">
        {regions.collapsed.sidebar && <button className="button subtle" onClick={() => regions.reopen('sidebar')}>Reabrir Sidebar</button>}
        {regions.collapsed.bottom && <button className="button subtle" onClick={() => regions.reopen('bottom')}>Reabrir Bottom</button>}
        {tx.editing && selected && <label className="region-transfer">Mover widget<select aria-label="Região do widget selecionado" value={selected.region} onChange={e => interaction.transferTo(selected.id, e.target.value as Region)}>{REGIONS.map(r => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}</select></label>}
      </div></Header>
    <div ref={element => { regions.area.current = element; surfaces.root.current = element }} className="work-area" style={{ gridTemplateColumns: `${regions.sidebar}px ${regions.collapsed.sidebar ? 0 : regions.splitter}px minmax(0,1fr)`, gridTemplateRows: `minmax(0,1fr) ${regions.collapsed.bottom ? 0 : regions.splitter}px ${regions.bottom}px` }}>
      <aside className={'sidebar-region surface-region ' + (view.placements.some(p => p.region === 'sidebar') ? 'has-widgets' : '')} data-region="sidebar" hidden={regions.collapsed.sidebar}>
        <Sidebar selected={interaction.selected} select={interaction.setSelected} />{port('sidebar')}
      </aside>
      <div className="region-splitter sidebar-splitter" role="separator" aria-label="Largura da Sidebar" aria-orientation="vertical" tabIndex={regions.collapsed.sidebar ? -1 : 0}
        aria-valuenow={regions.sidebar} aria-valuemin={0} aria-valuemax={regions.bounds.sidebar.max} {...regions.handlers('sidebar')} />
      <main className={'main-region surface-region ' + (expanded ? 'expanded' : '')} data-region="main" data-testid="layout-canvas" data-engine="freeform" data-expanded={expanded}
        style={{ '--dock-width': dockWidth + 'px', '--dock-height': dockHeight + 'px' } as CSSProperties}>
        <div className="plugin-tray"><PluginWidgets plugins={plugins} /></div>
        <div className="main-placement" style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0,
          marginLeft: docked && panel.anchor === 'left' ? dockWidth + 10 : 0, marginRight: docked && panel.anchor === 'right' ? dockWidth + 10 : 0,
          marginTop: docked && panel.anchor === 'top' ? dockHeight + 10 : 0, marginBottom: docked && panel.anchor === 'bottom' ? dockHeight + 10 : 0 }}>{port('main')}</div>
        <TestPanel state={panel} close={() => setPanel({ ...panel, open: false })} />
      </main>
      <div className="region-splitter bottom-splitter" role="separator" aria-label="Altura da Bottom" aria-orientation="horizontal" tabIndex={regions.collapsed.bottom ? -1 : 0}
        aria-valuenow={regions.bottom} aria-valuemin={0} aria-valuemax={regions.bounds.bottom.max} {...regions.handlers('bottom')} />
      <footer className={'bottom-region surface-region ' + (expanded ? 'expanded' : '')} data-region="bottom" hidden={regions.collapsed.bottom}>
        <div className="bottom-tools"><span className="region-label">BOTTOM</span><button className={'bottom-action ' + (panel.open ? 'active' : '')} onClick={() => setPanel({ ...panel, open: !panel.open })} disabled={tx.editing} aria-label="Abrir ou recolher painel de teste"><CommandLineIcon className="size-4" />Painel de teste</button><span className="bottom-spacer" /><span>{plugins.inventory.plugins.length} plugins locais</span><span className="status-dot" /></div>{port('bottom')}
      </footer>
      <div className="freeform-layer">{view.placements.map(p => <WidgetFrame key={p.id} placement={p} measurement={surfaces.measures[p.region]}
        constraint={feasible[p.region] ? constraintsFor({ ...surfaces.measures[p.region], region: p.region, expanded })[p.id]! : CONSTRAINTS[p.id]!}
        editing={tx.editing && feasible[p.region]} withheld={tx.recovery && !tx.editing} interaction={interaction}
        wheel={delta => { const element = surfaces.ports[p.region].current; if (element && expanded && p.region !== 'sidebar') element.scrollLeft += delta }} />)}</div>
    </div>
    <div className="workspace-feedback" role="status">{[REGIONS.some(r => !feasible[r] && view.placements.some(p => p.region === r)) ? 'Espaço insuficiente para os mínimos. Composição preservada em área recuperável com rolagem; amplie ou reabra a região.' : '', tx.message].filter(Boolean).join(' ')}</div>
    <div className="fixed-status-bar" aria-label="Barra de estado" />
    {settingsOpen && <Settings plugins={plugins} close={() => setSettingsOpen(false)} tx={tx} panel={panel} setPanel={setPanel} expanded={expanded} setExpanded={toggleExpansion} />}
  </div></MotionConfig>
}
