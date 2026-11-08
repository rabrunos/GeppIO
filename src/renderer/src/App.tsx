import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { MotionConfig } from 'motion/react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { usePlugins } from './Plugins.tsx'
import { constraintsFor, EXPANSION_KEY } from '../../shared/freeform/policy.ts'
import { projectRegion } from '../../shared/freeform/projection.ts'
import { REGIONS } from '../../shared/freeform/types.ts'
import type { Region } from '../../shared/freeform/types.ts'
import { constraintsForViews, widgetRegistry, activePlacements } from '../../shared/workbench/model.ts'
import type { SessionSlot, UserBar, WorkbenchSnapshot, WidgetType } from '../../shared/workbench/model.ts'
import { projectSessionSlot } from '../../shared/workbench/compositions.ts'
import { fillReservation } from '../../shared/workbench/slots.ts'
import type { SlotIntention } from '../../shared/workbench/slots.ts'
import { addWidget, configureBar, removePresence, swapViews } from '../../shared/workbench/commands.ts'
import { useTransaction } from './freeform/useTransaction.ts'
import { useSurfaces } from './freeform/useSurfaces.ts'
import { useInteraction } from './freeform/useInteraction.ts'
import { WidgetFrame } from './freeform/WidgetFrame.tsx'
import { Header, ContextBar } from './workbench/Header.tsx'
import { Sidebar } from './workbench/Sidebar.tsx'
import { EditorPanel } from './workbench/EditorPanel.tsx'
import { PairDividers } from './workbench/PairDividers.tsx'
import { Confirm } from './workbench/Primitives.tsx'
import { LocaleProvider, useLocale } from './workbench/Locale.tsx'
import { useRegions } from './workbench/useRegions.ts'
import { useSwap } from './workbench/useSwap.ts'
import { HostModelsProvider, useHostModels } from './workbench/HostModels.tsx'
import { EditOutline } from './workbench/EditOutline.tsx'
import { DragLayer } from './workbench/DragLayer.tsx'
import { ProjectMenu, useProjectName } from './workbench/ProjectMenu.tsx'
import { StatusBar } from './workbench/StatusBar.tsx'
import { ScrollArea } from './workbench/ScrollArea.tsx'
import { usePresentationPanel } from './workbench/usePresentationPanel.ts'
import { PresentationControls } from './workbench/PresentationControls.tsx'
import { PANEL_BAR_HEIGHT, PILOT_VIEW, presentationFor, effectivePresentation } from '../../shared/workbench/presentations.ts'
import { Settings } from './settings/Settings.tsx'
import { WidgetContent } from './WidgetContent.tsx'
import './settings/settings.css'
import './fixtures.css'
import './freeform/freeform.css'
import './workbench/design/index.css'
import './workbench/host.css'

/** The runtime is mounted once. Inventory loading never remounts an existing workbench. */
export function App() {
  const plugins = usePlugins(), ready = useRef(false)
  if (!plugins.busy) ready.current = true
  return <LocaleProvider><HostModelsProvider><MotionConfig reducedMotion="user">{ready.current ? <Workbench plugins={plugins} /> : <div className="host-loading" role="status">GeppIO…</div>}</MotionConfig></HostModelsProvider></LocaleProvider>
}
function Workbench({ plugins }: { plugins: ReturnType<typeof usePlugins> }) {
  const { t } = useLocale(), registry = useMemo(() => widgetRegistry(plugins.inventory.plugins), [plugins.inventory.plugins])
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem(EXPANSION_KEY) === 'true' } catch { return false } })
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const stored = localStorage.getItem('geppio:theme:v1')
      if (stored === 'light' || stored === 'dark') return stored
      const old: unknown = JSON.parse(localStorage.getItem('geppio:layout:grid:v2') ?? localStorage.getItem('geppio:layout:v1') ?? 'null')
      return old && typeof old === 'object' && 'theme' in old && old.theme === 'light' ? 'light' : 'dark'
    } catch { return 'dark' }
  })
  const [settingsOpen, setSettingsOpen] = useState(false), [editorOpen, setEditorOpen] = useState(true), [slot, setSlot] = useState<SessionSlot | null>(null)
  const [headerMenu, setHeaderMenu] = useState<string | null>(null)
  const [widgetsRequest, setWidgetsRequest] = useState(0), [moveRequest, setMoveRequest] = useState<{ id: string; serial: number } | null>(null)
  const [snap, setSnapState] = useState(() => { try { return localStorage.getItem('geppio:snap-center:v1') !== 'false' } catch { return true } })
  function setSnap(value: boolean) { tx.changeLocal({ snap: value }) }
  const project = useProjectName(), models = useHostModels(), projectAnchor = useRef<HTMLButtonElement>(null), [projectMenu, setProjectMenu] = useState(false)
  const tx = useTransaction(registry, {
    read: () => ({ projectName: project.name, theme, snap, properties: models.properties }),
    apply(value) {
      let stored = true
      if (value.theme !== theme) { setTheme(value.theme); try { localStorage.setItem('geppio:theme:v1', value.theme) } catch { stored = false } }
      if (value.snap !== snap) { setSnapState(value.snap); try { localStorage.setItem('geppio:snap-center:v1', String(value.snap)) } catch { stored = false } }
      if (value.projectName !== project.name && !project.restore(value.projectName)) stored = false
      if (!stored) tx.setMessage('Preferência alterada somente nesta sessão.')
      if (JSON.stringify(value.properties) !== JSON.stringify(models.properties)) models.replaceProperties(value.properties)
    }
  })
  const regions = useRegions(tx.editing, tx.snapshot.organization.chrome, chrome => tx.commitOrganization({ ...tx.live.current, organization: { ...tx.live.current.organization, chrome } })), surfaces = useSurfaces()
  const constraints = useMemo(() => constraintsForViews(tx.snapshot, registry), [tx.snapshot.organization.views, registry])
  useEffect(() => { models.registerHistory(tx.editing ? properties => tx.changeLocal({ properties }) : null); return () => models.registerHistory(null) }, [tx.editing])
  const [removing, setRemoving] = useState<string | null>(null), [swapSelection, setSwapSelection] = useState<string | null>(null)
  const [selectedViews, setSelectedViews] = useState<string[]>([])
  const [pairPreview, setPairPreview] = useState<WorkbenchSnapshot | null>(null)
  const [showFeedback, setShowFeedback] = useState(false), initialMessage = useRef(tx.message)
  const panel = presentationFor(tx.snapshot)
  const fullMain = { width: surfaces.measures.main.ownerWidth ?? 0, height: surfaces.measures.main.ownerHeight ?? 0 }
  const mainScrollbar = expanded && tx.snapshot.placements.some(p => p.region === 'main' && p.x + p.width > fullMain.width) ? surfaces.scrollbarHeight.current : 0
  const capacitySource = { ...tx.snapshot, organization: { ...tx.snapshot.organization, presentations: { version: 1 as const, entries: [{ ...panel, open: true, preferred: { ...panel.preferred, height: 4096 } }] } } }
  const capacity = effectivePresentation(capacitySource, fullMain, constraints, expanded, mainScrollbar)
  const panelUI = usePresentationPanel(tx, panel, capacity.height, [fullMain.width, fullMain.height].join(','))
  const previewSource = panelUI.preview ? { ...tx.snapshot, organization: { ...tx.snapshot.organization, presentations: { version: 1 as const, entries: [{ ...panel, open: panelUI.preview.open, preferred: { ...panel.preferred, height: panelUI.preview.height } }] } } } : tx.snapshot
  const panelGeometry = effectivePresentation(previewSource, fullMain, constraints, expanded, mainScrollbar)
  const panelShown = panelGeometry.shown && (panel.presentation !== 'overlay' || panelUI.revealed)
  const panelActive = panelGeometry.active && panel.presentation !== 'normal'
  const panelNotice = panelGeometry.active && panel.open && panelGeometry.adapted
    ? panelGeometry.shown ? 'Painel com tamanho temporário. Amplie a janela para restaurar o tamanho preferido.' : 'Painel recolhido temporariamente por falta de espaço. Amplie a janela ou escolha Normal; a preferência de abrir foi preservada.' : ''
  const frames = useRef(new Map<string, WorkbenchSnapshot['placements'][number]>())
  const surfaceSizes = REGIONS.map(r => `${surfaces.measures[r].width},${surfaces.measures[r].height}`).join(';')
  const sessionSlots = tx.slots.filter(item => !item.sidebarBar || item.sidebarBar === tx.snapshot.organization.activeBar).map(item => projectSessionSlot(item, surfaces.measures[item.region]))
  const chosenSlot = sessionSlots.find(item => item.id === slot?.id) ?? null
  const source = pairPreview ?? tx.snapshot
  const visible = { ...source, placements: activePlacements(source).filter(p => constraints[p.id]) }
  const projected = useMemo(() => Object.fromEntries(REGIONS.map(r => [r, projectRegion(visible, r, surfaces.measures[r], expanded && r === 'main', constraints)])) as Record<Region, ReturnType<typeof projectRegion>>, [source, surfaceSizes, expanded, registry])
  const feasible = Object.fromEntries(REGIONS.map(r => [r, projected[r].feasible])) as Record<Region, boolean>
  const geometryWarning = REGIONS.some(region => !feasible[region] && visible.placements.some(p => p.region === region))
  const view: WorkbenchSnapshot = { ...tx.snapshot, reference: { ...tx.snapshot.reference }, placements: tx.snapshot.placements.map(p => projected[p.region].placements.find(q => q.id === p.id) ?? p) }
  for (const r of REGIONS) {
    const m = surfaces.measures[r]
    if (feasible[r] && m.width > 0 && m.height > 0) view.reference[r] = { width: m.width, height: r === 'sidebar' ? Math.max(m.height, projected.sidebar.world.height) : m.height }
  }
  // A panel reserves its Normal slot. Geometry editing in Main resumes in Normal;
  // metadata, composition application and presentation history use canonical Main.
  if (panelActive) {
    view.reference.main = tx.snapshot.reference.main
    view.placements = view.placements.map(p => p.region === 'main' ? tx.snapshot.placements.find(q => q.id === p.id)! : p)
  }
  const interaction = useInteraction(tx, view, surfaces, expanded, { ...feasible, main: feasible.main && !panelActive }, registry, {
    reservationKey: [...disabledOwners()].join(';'),
    select(id) { setEditorOpen(true); setWidgetsRequest(value => value + 1); setMoveRequest(previous => ({ id, serial: (previous?.serial ?? 0) + 1 })) },
    available(type, region) { if (panelActive && region === 'main') return false; return !!addWidget(view, registry, type, { ...surfaces.measures[region], region, expanded: expanded && region === 'main' }, undefined, disabledOwners())
      || tx.currentSlots().some(slot => slot.region === region && reserve(slot.id, { kind: 'catalog', typeId: type }, view, false)) },
    commit(type, region, at) { return add(type, region, undefined, at) },
    reservation(id, intention, baseline, commit) { return reserve(id, intention, baseline ?? view, commit) }
  }), displayed = { ...projected }
  if (interaction.preview && interaction.activeRegion) {
    const region = interaction.activeRegion, preview = interaction.preview
    view.placements = view.placements.map(p => p.region === region ? preview.placements.find(q => q.id === p.id) ?? p : p)
    const peers = view.placements.filter(p => p.region === region), m = surfaces.measures[region]
    displayed[region] = { placements: peers, feasible: true, world: { width: region === 'main' ? Math.max(m.width, ...peers.map(p => p.x + p.width)) : m.width,
      height: region === 'sidebar' ? Math.max(0, ...peers.map(p => p.y + p.height)) : preview.reference[region].height } }
  }
  const disabled = useMemo(disabledOwners, [plugins.views, plugins.inventory.plugins])
  const swapping = useSwap(tx, view, registry, selectedViews, () => { setSwapSelection(null) })
  const feedbackActive = interaction.active()
  function disabledOwners() { return new Set(plugins.inventory.plugins.filter(plugin => !plugin.enabled || !plugins.views.some(view => view.plugin.manifest.id === plugin.manifest.id && view.status === 'active')).map(plugin => `plugin:${plugin.manifest.id}`)) }
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    if (tx.message === initialMessage.current || feedbackActive) { setShowFeedback(false); return }
    setShowFeedback(true); const timer = setTimeout(() => setShowFeedback(false), 3200)
    return () => clearTimeout(timer)
  }, [tx.message, feedbackActive])
  useEffect(() => { if (tx.editing) setEditorOpen(true); else { setSlot(null); setSwapSelection(null); setSelectedViews([]); interaction.setSelected(null) } }, [tx.editing])
  useEffect(() => { if (slot && !tx.slots.some(item => item.id === slot.id)) setSlot(null) }, [tx.slots, slot?.id])
  useEffect(() => { surfaces.measure() }, [regions.sidebarMode, tx.editing, editorOpen])
  function toggleExpansion(next: boolean) { interaction.end(true); setExpanded(next); try { localStorage.setItem(EXPANSION_KEY, String(next)) } catch { tx.setMessage(t('Preferência alterada somente nesta sessão.')) } }
  function toggleTheme() { tx.changeLocal({ theme: theme === 'dark' ? 'light' : 'dark' }) }
  function begin() { interaction.end(false); setWidgetsRequest(value => value + 1); if (tx.editing) { setEditorOpen(true); return }; tx.begin(view) }
  function confirmLayout(conclude: boolean) {
    interaction.end(false)
    regions.commitKeyboard()
    if (REGIONS.some(r => !feasible[r] && visible.placements.some(p => p.region === r))) { tx.setMessage(t('Espaço insuficiente. Amplie a região antes de salvar.')); return }
    const next = { ...view, organization: tx.live.current.organization }
    if (conclude) void tx.conclude(next); else void tx.saveEditing(next)
  }
  function add(type: string, region: Region, target?: SessionSlot, at?: { x: number; y: number }) {
    if (!tx.editing) return false
    if (panelActive && region === 'main') return false
    if (target) return reserve(target.id, { kind: 'catalog', typeId: type }, view, true)
    const surface = { ...surfaces.measures[region], region, expanded: expanded && region === 'main' }
    const next = addWidget(view, registry, type, surface, at, disabled)
    if (!next) { tx.setMessage(t('Widget incompatível ou sem espaço nesta área.')); return false }
    tx.action(next); return true
  }
  function reserve(id: string, intention: SlotIntention, baseline: WorkbenchSnapshot, commit: boolean) {
    const stored = tx.currentSlots().find(item => item.id === id)
    if (!tx.editing || !stored || (panelActive && stored.region === 'main')) return false
    const region = stored.region, surface = { ...surfaces.measures[region], region, expanded: expanded && region === 'main' }
    const result = fillReservation(baseline, registry, tx.currentSlots(), id, surface, intention, disabledOwners())
    if (result && commit) { tx.action(result.snapshot, result.slots); tx.setMessage('Espaço preenchido. Salve ou cancele.') }
    return !!result
  }
  async function saveBar(bar: UserBar) {
    const surface = { ...surfaces.measures.sidebar, region: 'sidebar' as const, expanded: false }
    if (!tx.editing) return tx.saveBar(bar, surface, disabled)
    const next = configureBar(view, registry, bar, surface, disabled)
    if (!next) { tx.setMessage(t('Widget incompatível ou sem espaço nesta barra.')); return false }
    tx.action(next); return true
  }
  function port(region: Region) {
    const projection = displayed[region], empty = !visible.placements.some(p => p.region === region) && !sessionSlots.some(slot => slot.region === region)
    const height = Math.max(projection.world.height, region === 'sidebar' && interaction.heldExtent?.region === region ? interaction.heldExtent.height : 0, region === 'sidebar' && empty ? surfaces.measures.sidebar.height : 0)
    // A feasible Docked budget must not inherit scrollbars from the previous
    // smaller viewport: those scrollbars would consume its exact minimum again.
    const recovery = !projection.feasible && !(region === 'main' && panelActive && panel.presentation === 'docked' && panelGeometry.shown)
    return <div ref={surfaces.ports[region]} className={'placement-port ' + (recovery ? 'recovery-surface' : '')} data-surface={region} data-feasible={projection.feasible}
      data-usable-width={surfaces.measures[region].width} data-usable-height={surfaces.measures[region].height} role="region" aria-label={t('Área de widgets: {0}', region)} tabIndex={region === 'main' && (expanded || !projection.feasible) ? 0 : -1} onScroll={surfaces.measure}
      style={region === 'sidebar' ? { height } : undefined}><div className="placement-world" style={{ width: Math.max(projection.world.width, region === 'main' && interaction.heldExtent?.region === region ? interaction.heldExtent.width : 0), height }} />{empty && <div className="workspace-region-empty host-region-empty" data-empty-region={region}><WorkbenchEmptyIcon /><strong>{t('Nenhum widget nesta área')}</strong><button className="ui-button workspace-text-action" onClick={begin} disabled={tx.recovery && !tx.editing}>{t('Escolher widgets')}</button></div>}</div>
  }
  const picture = interaction.visual.picture
  const dropZones = interaction.catalogDrag ?? interaction.frameDrop
  return <div className={'workbench ' + (regions.resizing ? 'is-resizing' : '')} data-theme={theme} data-sidebar-mode={regions.sidebarMode} data-active-bar={tx.snapshot.organization.activeBar} data-bottom-mode={regions.collapsed.bottom ? 'hidden' : 'docked'}
    data-sidebar-presentation={regions.floating ? 'floating' : 'docked'} data-layout-editing={tx.editing ? '' : undefined} data-widget-catalog-open={tx.editing && editorOpen} data-resize-axis={regions.resizing === 'sidebar' ? 'x' : 'y'}
    style={{ '--sidebar-width': regions.contentWidth + 'px', '--bottom-height': regions.contentHeight + 'px', '--sidebar-track': (48 + regions.sidebar) + 'px', '--bottom-track': regions.bottom + 'px' } as CSSProperties}
    onClickCapture={event => {
      if (!tx.editing || !(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).closest('input,textarea,select,a,[contenteditable="true"]')) return
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-widget]')?.dataset.widget
      if (id) { event.preventDefault(); event.stopPropagation(); setSelectedViews(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]) }
    }}
    onKeyDown={event => {
      if (settingsOpen || (event.target as HTMLElement).closest('dialog[open], [popover]:popover-open')) return
      const textInput = (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
      if (!textInput && tx.editing && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); if (tx.gestureActive || interaction.active() || regions.active() || panelUI.active() || swapping.active()) return; regions.commitKeyboard(); interaction.visual.after(event.shiftKey || event.key.toLowerCase() === 'y' ? tx.redo : tx.undo); setSwapSelection(null); setSelectedViews([]) }
      if (event.key === 'Escape') { if (interaction.active()) interaction.end(true); else if (slot) setSlot(null); else if (selectedViews.length || swapSelection) { setSwapSelection(null); setSelectedViews([]) } else if (regions.sidebarMode === 'peek') regions.closePeek(); else if (tx.editing) tx.cancel() }
    }}>
    <Header projectName={project.name ?? t('Laboratório')} openProject={() => setProjectMenu(true)} menu={headerMenu} setMenu={setHeaderMenu} history={interaction.visual.after} plugins={plugins} tx={tx} theme={theme} toggleTheme={toggleTheme} openSettings={() => setSettingsOpen(true)} begin={begin} save={() => confirmLayout(false)} conclude={() => confirmLayout(true)} /><ContextBar projectName={project.name ?? t('Laboratório')} projectAnchor={projectAnchor} openProject={() => setProjectMenu(!projectMenu)} begin={() => tx.editing ? setEditorOpen(!editorOpen) : begin()} editing={tx.editing} recovery={tx.recovery} feedback={tx.setMessage} />
    <ProjectMenu open={projectMenu} close={() => setProjectMenu(false)} anchor={projectAnchor} name={project.name ?? t('Laboratório')} rename={value => { const name = value.trim(); if (!name || name.length > 60) return false; if (tx.editing) { tx.changeLocal({ projectName: name }); return true }; return project.rename(name) }} snapshot={tx.snapshot} feedback={tx.setMessage} />
      <div ref={element => { regions.area.current = element; surfaces.root.current = element }} className="work-area" onPointerDown={event => { const box = regions.area.current?.getBoundingClientRect(); const safeGap = box && event.clientX >= box.left + 48 && event.clientX <= box.left + 59; if (regions.sidebarMode === 'peek' && !safeGap && !(event.target as HTMLElement).closest('.host-sidebar-content, .sidebar-rail')) regions.closePeek() }}>
      <Sidebar tx={tx} registry={registry} regions={regions} sidebarWidth={surfaces.measures.sidebar.width} theme={theme} toggleTheme={toggleTheme} saveBar={saveBar}><ScrollArea as="aside" className="sidebar-region ui-scrollbar" data-region="sidebar" onScroll={surfaces.measure} tabIndex={0} aria-label={t('Barra lateral')}>{port('sidebar')}</ScrollArea></Sidebar>
      <main className={'main-region ' + (expanded ? 'expanded' : '')} data-region="main" data-testid="layout-canvas" data-engine="freeform" data-expanded={expanded} data-panel-adapted={panelGeometry.adapted} data-panel-reservation={panelGeometry.reservation}>
        <div className="main-placement" style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, marginBottom: panelGeometry.reservation }}>{port('main')}</div>
      </main>
      <footer className="bottom-region" data-region="bottom"><div className="bottom-surface">{port('bottom')}{!feasible.bottom && visible.placements.some(p => p.region === 'bottom') && <div className="bottom-recovery" data-testid="bottom-recovery" role="alert"><span>{t('Espaço insuficiente. Amplie a região antes de salvar.')}</span><button className="ui-button tool-button" onClick={() => regions.expand('bottom')}>{t('Ampliar Bottom')}</button></div>}</div></footer>
      <div className="region-splitter sidebar-splitter" data-active={regions.resizing === 'sidebar' ? '' : undefined} role="separator" aria-label={t('Largura da Sidebar')} aria-orientation="vertical" tabIndex={regions.sidebarMode === 'docked' ? 0 : -1} aria-valuenow={regions.sidebar} aria-valuemin={regions.bounds.sidebar.min} aria-valuemax={regions.bounds.sidebar.max} {...regions.handlers('sidebar')} />
      <div className="region-splitter bottom-splitter" data-active={regions.resizing === 'bottom' ? '' : undefined} role="separator" aria-label={t('Altura da Bottom')} aria-orientation="horizontal" tabIndex={0} aria-valuenow={regions.bottom} aria-valuemin={regions.collapsed.bottom || regions.bottomRevealing ? 0 : regions.bounds.bottom.min} aria-valuemax={regions.bounds.bottom.max} {...regions.handlers('bottom')} />
      {panelActive && panel.presentation === 'docked' && <div className="presentation-trigger-area docked-trigger" style={{ left: surfaces.measures.main.left, top: surfaces.measures.main.top + fullMain.height - (panelShown ? panelGeometry.height : PANEL_BAR_HEIGHT) - 9, width: fullMain.width }}>
        <div className="region-splitter presentation-splitter" role="separator" tabIndex={0} aria-label={t('Altura de Propriedades')} aria-orientation="horizontal" aria-controls="properties-presentation" aria-expanded={panelShown} aria-valuemin={220} aria-valuemax={Math.max(220, capacity.height)} aria-valuenow={panelShown ? panelGeometry.height : PANEL_BAR_HEIGHT} data-active={panelUI.preview ? '' : undefined} {...panelUI.handlers} />
      </div>}
      <div className="freeform-layer">{tx.snapshot.organization.views.map(record => {
        const definition = registry.get(record.typeId), current = view.placements.find(p => p.id === record.id)
        if (current) frames.current.set(record.id, current)
        const placement = current ?? frames.current.get(record.id)
        if (!definition || !placement) return null
        const shown = visible.placements.some(p => p.id === record.id)
        const pilot = record.id === PILOT_VIEW && placement.region === 'main'
        const panelFrame = pilot && panelActive
        const measurement = panelFrame ? { ...surfaces.measures.main, ...fullMain, clipWidth: fullMain.width, clipHeight: fullMain.height, scrollLeft: 0, scrollTop: 0 } : surfaces.measures[placement.region]
        const panelHeight = panelShown ? panelGeometry.height : PANEL_BAR_HEIGHT
        const rendered = panelFrame ? { ...placement, x: Math.max(0, fullMain.width - panelGeometry.width), y: Math.max(0, fullMain.height - panelHeight), width: panelGeometry.width, height: panelHeight } : displayed[placement.region].placements.find(p => p.id === placement.id) ?? placement
        return <WidgetFrame presentation={pilot ? { mode: panel.presentation, open: panelShown } : undefined} key={record.id} placement={rendered} definition={definition} measurement={measurement} constraint={constraintsFor({ ...surfaces.measures[placement.region], region: placement.region, expanded }, constraints)[record.id]!}
          hover={pilot ? panelUI.hover : undefined} blur={pilot ? panelUI.blur : undefined} editControls={tx.editing && (pilot || feasible[placement.region])} controls={pilot ? <PresentationControls state={panel} tx={tx} definition={definition} region={placement.region} hold={panelUI.hold} /> : undefined}
          editing={tx.editing && feasible[placement.region] && !(panelActive && placement.region === 'main')} inactive={(placement.region === 'sidebar' && regions.sidebarMode === 'hidden') || (placement.region === 'bottom' && regions.collapsed.bottom)} ghosted={!!picture && record.id === picture.viewId && (!picture.catalog || picture.released) && (!picture.sourceBar || picture.released || picture.sourceBar === tx.snapshot.organization.activeBar)} withheld={(tx.recovery && !tx.editing) || !current || (!shown && interaction.movingId !== record.id)} unavailable={placement.region === 'bottom' && !feasible.bottom}
          interaction={interaction} swapping={swapping} motionRevision={tx.motionRevision} motion={tx.motion} remove={() => setRemoving(record.id)} swapSelected={selectedViews.includes(record.id)} swapAvailable={selectedViews.length >= 2} swap={() => { if (swapSelection && swapSelection !== record.id) { const next = swapViews(view, registry, swapSelection, record.id); if (next) tx.action(next); else tx.setMessage(t('Troca incompatível ou sem espaço.')); setSwapSelection(null) } else setSwapSelection(record.id) }}
          wheel={(dx, dy) => { const element = surfaces.scroller(placement.region); if (!element) return; if (placement.region === 'main' && expanded) element.scrollLeft += dx; if (placement.region === 'sidebar') element.scrollTop += dy }}>
          {definition.widgetId ? <PluginBody definition={definition} plugins={plugins} /> : undefined}
        </WidgetFrame>
      })}{sessionSlots.map(item => { const m = surfaces.measures[item.region], left = m.left + item.x - m.scrollLeft, top = m.top + item.y - m.scrollTop; return <button key={item.id} className="ui-button host-format-slot layout-empty-slot" data-session-slot={item.id} data-slot-bar={item.sidebarBar} data-owner-region={item.region} data-catalog-slot-target={chosenSlot?.id === item.id ? '' : undefined} aria-pressed={chosenSlot?.id === item.id} style={{ left, top, width: item.width, height: item.height,
        clipPath: `inset(${Math.max(0, m.top - top)}px ${Math.max(0, left + item.width - m.left - (m.clipWidth ?? m.width))}px ${Math.max(0, top + item.height - m.top - (m.clipHeight ?? m.height))}px ${Math.max(0, m.left - left)}px round var(--card-radius))` }} onClick={() => { if (!editorOpen) { setEditorOpen(true); if (chosenSlot?.id !== item.id) setSlot(item) } else setSlot(chosenSlot?.id === item.id ? null : item) }} aria-label={t('Escolher widget')}><PlusIcon className="icon" /><strong>{t('Adicionar widget')}</strong><small>{t('Espaço {0}', sessionSlots.filter(slot => slot.region === item.region).findIndex(slot => slot.id === item.id) + 1)}</small></button> })}</div>
      <PairDividers suspendMain={panelActive} tx={tx} registry={registry} view={view} surfaces={surfaces} preview={setPairPreview} snap={snap} />
      {swapping.preview && <div className="widget-swap-preview" style={{ left: swapping.preview.x, top: swapping.preview.y, zIndex: 152 }} aria-hidden="true"><WorkbenchMoveIcon />{registry.get(tx.snapshot.organization.views.find(v => v.id === swapping.preview!.id)!.typeId)?.title}</div>}
      {picture && !picture.catalog && !picture.released && (!picture.sourceBar || picture.sourceBar === tx.snapshot.organization.activeBar) && <div className="layout-drag-origin host-drag-origin" data-owner-region={picture.source?.dataset.ownerRegion} aria-hidden="true" inert style={{ left: picture.origin.left, top: picture.origin.top, width: picture.origin.width, height: picture.origin.height, clipPath: picture.originClip }} />}
      <EditorPanel moveRequest={moveRequest} move={interaction.transferTo} request={widgetsRequest} tx={tx} registry={registry} view={view} open={editorOpen} setOpen={setEditorOpen} slot={chosenSlot} chooseSlot={setSlot} add={add} remove={setRemoving} disabled={disabled} interaction={interaction} openPlugins={() => setHeaderMenu('plugins')} />
      {picture && <DragLayer picture={picture} pointer={interaction.visual.pointer} controller={interaction.visual.controller} measure={interaction.visual.measure} complete={interaction.visual.complete} label={t(picture.catalog ? 'Adicionando widget' : picture.sourceBar ? 'Movendo da barra lateral' : (interaction.gestureLabel?.region ?? picture.source?.dataset.ownerRegion) === 'bottom' ? 'Movendo da barra inferior' : 'Movendo da área principal')}><section className="widget drag-picture-content"><header className="widget-heading"><strong>{registry.get(picture.typeId)?.owner === 'host' ? t(registry.get(picture.typeId)!.title) : registry.get(picture.typeId)?.title}</strong></header><div className="widget-content">{registry.get(picture.typeId)?.fixture ? <WidgetContent id={registry.get(picture.typeId)!.fixture!} /> : <PluginBody definition={registry.get(picture.typeId)!} plugins={plugins} preview />}</div></section></DragLayer>}
      {dropZones?.targets.map(region => { const m = surfaces.measures[region], width = m.width + 6, height = m.height + 6; return <div key={region} className="layout-edit-zone" data-over={dropZones.over === region ? '' : undefined} style={{ left: m.left - 3, top: m.top - 3, width, height }}><EditOutline width={width} height={height} /></div> })}
    </div><StatusBar />
    <div className={'workspace-feedback ' + (showFeedback || tx.recovery || geometryWarning || panelNotice ? 'workspace-toast' : 'sr-only')} role="status" aria-live="polite">{[panelNotice ? t(panelNotice) : '', geometryWarning ? t('Espaço insuficiente para os mínimos. Composição preservada; amplie ou reabra a região.') : '', t(tx.message)].filter(Boolean).join(' ')}</div>
    {removing && <Confirm title="Remover widget?" text={t('Remover esta presença? Os dados e plugins continuam disponíveis.')} confirm={() => {
      const typeId = view.organization.views.find(record => record.id === removing)?.typeId
      tx.action(removePresence(view, removing)); setRemoving(null)
      requestAnimationFrame(() => { const button = editorOpen && typeId ? document.querySelector<HTMLElement>(`[data-catalog-type="${CSS.escape(typeId)}"]`) : null
        if (button?.getClientRects().length) button.focus(); else document.querySelector<HTMLElement>('.widget-catalog-toggle')?.focus() })
    }} close={() => setRemoving(null)} />}
    {settingsOpen && <Settings plugins={plugins} close={() => setSettingsOpen(false)} tx={tx} expanded={expanded} setExpanded={toggleExpansion} theme={theme} toggleTheme={toggleTheme} snap={snap} setSnap={setSnap} />}
  </div>
}
function WorkbenchMoveIcon() { return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg> }
function WorkbenchEmptyIcon() { return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3.75" y="3.75" width="6" height="6" rx="1.5" /><rect x="14.25" y="3.75" width="6" height="6" rx="1.5" /><rect x="3.75" y="14.25" width="6" height="6" rx="1.5" /><rect x="14.25" y="14.25" width="6" height="6" rx="1.5" /></svg> }
function PluginBody({ definition, plugins, preview = false }: { definition: WidgetType; plugins: ReturnType<typeof usePlugins>; preview?: boolean }) {
  const { t } = useLocale(), content = plugins.views.find(view => view.plugin.manifest.id === definition.pluginId)?.widgets[definition.widgetId!]
  return <div className="host-plugin-content" data-plugin-widget={!preview && content ? `${definition.pluginId}:${definition.widgetId}` : undefined}><p>{content?.text ?? t('Plugin desativado ou aguardando publicação.')}</p>{content?.action && <button className="ui-button tool-button" onClick={preview ? undefined : () => plugins.action(definition.pluginId!, definition.widgetId!, content.action!.id)}>{content.action.label}</button>}</div>
}
