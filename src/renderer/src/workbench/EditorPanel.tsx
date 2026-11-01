import { useEffect, useRef, useState } from 'react'
import { ChevronRightIcon, MagnifyingGlassIcon, Squares2X2Icon, StarIcon, PlusIcon, FunnelIcon, EllipsisHorizontalIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { constraintInRegion } from '../../../shared/freeform/policy.ts'
import { addWidget, moveView } from '../../../shared/workbench/commands.ts'
import { useScrollState } from './ScrollArea.tsx'
import { REGIONS } from '../../../shared/freeform/types.ts'
import type { Region } from '../../../shared/freeform/types.ts'
import { evaluatePlacement, LIMITS } from '../../../shared/workbench/model.ts'
import type { Composition, SessionSlot, Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import { applyComposition, captureCurrentComposition, compositionChrome, compositionScene, compositionOrder, compositionSlots, favoriteComposition, reorderComposition, systemCompositions } from '../../../shared/workbench/compositions.ts'
import type { Transaction } from '../freeform/useTransaction.ts'
import type { Interaction } from '../freeform/useInteraction.ts'
import { Confirm, Dialog, IconButton, Popover } from './Primitives.tsx'
import { normalizeSearch } from './PluginManager.tsx'
import { useLocale } from './Locale.tsx'
import { CompositionThumbnail } from './CompositionThumbnail.tsx'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { WidgetIcon } from './WidgetIcon.tsx'
import { useCompositionReorder } from './useCompositionReorder.ts'
import { useCatalogAvailability } from './useCatalogAvailability.ts'

export function RegionIcon({ region }: { region: Region | 'all' }) {
  const area = region === 'all' ? { x: 4, y: 5, width: 16, height: 14 } : region === 'sidebar' ? { x: 4, y: 5, width: 3, height: 14 }
    : region === 'main' ? { x: 9, y: 5, width: 11, height: 14 } : { x: 4, y: 16, width: 16, height: 3 }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect {...area} rx=".5" fill="currentColor" stroke="none" opacity=".4" /><rect x="3" y="4" width="18" height="16" rx="2" /><path strokeLinecap="round" d={region === 'all' ? 'M8 4v16m0-5h13' : region === 'bottom' ? 'M3 15h18' : 'M8 4v16'} /></svg>
}
export function EditorPanel({ tx, registry, open, setOpen, slot, chooseSlot, add, remove, view, disabled, interaction, openPlugins, request, moveRequest, move }: {
  moveRequest: { id: string; serial: number } | null; move(id: string, region: Region): boolean;
  tx: Transaction; registry: Registry; open: boolean; setOpen(value: boolean): void; slot: SessionSlot | null;
  chooseSlot(slot: SessionSlot | null): void; add(type: string, region: Region, slot?: SessionSlot): boolean; remove(id: string): void;
  view: WorkbenchSnapshot; disabled: ReadonlySet<string>; interaction: Interaction; openPlugins(): void; request: number
}) {
  const { t } = useLocale(), [tab, setTab] = useState<'widgets' | 'compositions'>('widgets')
  const [search, setSearch] = useState(''), [areas, setAreas] = useState<Region[]>([]), [category, setCategory] = useState('all'), [plugin, setPlugin] = useState('all'), [target, setTarget] = useState<string | null>(null)
  const [movingTarget, setMovingTarget] = useState<string | null>(null), categoriesScroll = useRef<HTMLDivElement>(null)
  const [pluginFilter, setPluginFilter] = useState(false), filterAnchor = useRef<HTMLButtonElement>(null)
  const previous = useRef<{ search: string; areas: Region[]; category: string; plugin: string; tab: typeof tab } | null>(null)
  const context = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), destination = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  useScrollState(viewport); useScrollState(categoriesScroll)
  useEffect(() => { if (!open) setPluginFilter(false) }, [open])
  useEffect(() => { if (moveRequest) { setTarget(view.organization.views.find(item => item.id === moveRequest.id)?.typeId ?? null); setMovingTarget(moveRequest.id) } }, [moveRequest?.serial])
  const areaName = (region: Region) => t(region === 'main' ? 'Principal' : region === 'sidebar' ? 'Lateral' : 'Inferior')
  const slotLabel = slot ? t('{0}, espaço {1}', areaName(slot.region), tx.slots.filter(item => item.region === slot.region).findIndex(item => item.id === slot.id) + 1) : ''
  useEffect(() => { if (tx.editing) { setSearch(''); setAreas([]); setCategory('all'); setPlugin('all'); setTab('widgets') } }, [tx.editing])
  useEffect(() => { if (request) selectTab('widgets') }, [request])
  useEffect(() => {
    setTarget(null); setPluginFilter(false)
    if (!slot) {
      const saved = previous.current; previous.current = null
      if (saved) { setSearch(saved.search); setAreas(saved.areas); setCategory(saved.category); setPlugin(saved.plugin); setTab(saved.tab) }
      return
    }
    previous.current ??= { search, areas, category, plugin, tab }
    setTab('widgets'); setOpen(true); setSearch(''); setAreas([slot.region]); setCategory('all'); setPlugin('all'); input.current?.focus({ preventScroll: true })
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const selected = document.querySelector('[data-catalog-slot-target]'), easing = getComputedStyle(context.current!).getPropertyValue('--region-easing').trim()
    const animations = [
      context.current?.firstElementChild?.animate([{ opacity: .25, translate: '0 -6px' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing }),
      grid.current?.animate([{ opacity: .62, translate: '6px 0' }, { opacity: 1, translate: '0 0' }], { duration: 260, easing }),
      selected?.animate([{ boxShadow: '0 0 0 0px transparent' }, { boxShadow: '0 0 0 5px var(--color-accent-soft)', offset: .35 }, { boxShadow: '0 0 0 0px transparent' }], { duration: 520, easing })
    ]
    return () => animations.forEach(animation => animation?.cancel())
  }, [slot?.id])
  const types = [...registry.values()].filter(type => (!slot || type.constraint.regions.includes(slot.region)) && (!areas.length || areas.some(region => type.constraint.regions.includes(region))))
  const owners = [...new Set(types.map(type => type.owner))], selectedPlugin = owners.includes(plugin) ? plugin : 'all'
  const ownerName = (owner: string) => owner === 'all' ? t('Todos os plugins') : owner === 'host' ? 'GeppIO' : [...registry.values()].find(type => type.owner === owner)?.description ?? owner
  const matches = types.filter(type => (selectedPlugin === 'all' || type.owner === selectedPlugin)
    && normalizeSearch((type.owner === 'host' ? t(type.title) : type.title) + ' ' + type.title + ' ' + ownerName(type.owner)).includes(normalizeSearch(search)))
  const categories = [...new Set(matches.map(type => type.category))], selectedCategory = categories.includes(category) ? category : 'all'
  const eligible = matches.filter(type => selectedCategory === 'all' || type.category === selectedCategory)
  const admission = useCatalogAvailability(view, registry, disabled, interaction, tx.editing && open && tab === 'widgets')
  useEffect(() => { if (plugin !== selectedPlugin) setPlugin(selectedPlugin); if (category !== selectedCategory) setCategory(selectedCategory); if (viewport.current) viewport.current.scrollTop = 0 }, [search, areas, selectedPlugin, selectedCategory, slot?.id])
  useEffect(() => { if (target) destination.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }) }, [target])
  function selectTab(value: typeof tab) { if (previous.current) previous.current.tab = value; chooseSlot(null); setTab(value); setPluginFilter(false) }
  function cancelChoice(focus = false) { const anchor = document.querySelector<HTMLButtonElement>('[data-catalog-slot-target]'); chooseSlot(null); if (focus) anchor?.focus({ preventScroll: true }) }
  function setArea(region: Region) { const next = areas.includes(region) ? areas.filter(item => item !== region) : [...areas, region]; setAreas(next.length === 3 ? [] : next) }
  const chosen = target ? registry.get(target) : null
  function destinationReason(region: Region) {
    if (!chosen) return t('Widget incompatível ou sem espaço nesta área.')
    const policy = evaluatePlacement(view, registry, chosen.id, region, movingTarget ? 'move' : 'catalog', movingTarget ? [movingTarget] : [], disabled)
    if (!policy.allowed) return t(policy.reason === 'paused' ? 'Plugin pausado' : policy.reason === 'incompatible' ? 'Widget incompatível com esta área.' : policy.reason === 'limit' ? 'Limite de views atingido. Reutilize uma view existente.' : region === 'sidebar' ? 'Este widget já está nesta barra.' : 'Este widget já está nesta área.')
    const surface = { ...view.reference[region], region, expanded: false }
    return (movingTarget ? moveView(view, registry, movingTarget, surface) : admission?.get(chosen.id)?.includes(region)) ? '' : t('Não há espaço disponível para os mínimos deste widget.')
  }
  return <><div className="widget-catalog-region"><aside className="editor-panel" inert={!tx.editing || !open} aria-hidden={!tx.editing || !open} aria-label={t('Editor de layout')}>
    <div className="editor-panel-tabs" role="tablist">{(['widgets', 'compositions'] as const).map(value => <button key={value} className="editor-panel-tab" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); selectTab(event.key === 'Home' ? 'widgets' : event.key === 'End' ? 'compositions' : value === 'widgets' ? 'compositions' : 'widgets') } }} onClick={() => selectTab(value)}><Squares2X2Icon className="icon" />{t(value === 'widgets' ? 'Widgets' : 'Composições')}</button>)}</div>
    <section id="widgets-menu" className="widget-browser" role="tabpanel" hidden={tab !== 'widgets'} data-catalog-choosing-slot={slot ? '' : undefined} onKeyDown={event => { if (event.key === 'Escape' && slot) { event.preventDefault(); event.stopPropagation(); cancelChoice(true) } }} onClick={event => { if (!(event.target as Element).closest('.widget-browser-tile,.widget-browser-destination')) setTarget(null) }}>
      <header className="widget-catalog-toolbar"><label className="workspace-search"><MagnifyingGlassIcon className="icon" /><input ref={input} className="ui-input" type="search" aria-label={t('Buscar widgets ou plugins')} placeholder={t('Buscar widgets…')} value={search} onChange={event => setSearch(event.target.value)} /></label><button ref={filterAnchor} className="ui-button ui-icon-button widget-catalog-filter" aria-label={t('Filtrar por plugin: {0}', ownerName(selectedPlugin))} aria-haspopup="menu" aria-expanded={pluginFilter} onClick={() => setPluginFilter(!pluginFilter)} data-filter-active={selectedPlugin !== 'all'}><FunnelIcon className="icon" /></button>
      <div className="catalog-area-filters"><IconButton className="catalog-area-button" label="Todas as áreas" aria-pressed={!areas.length} onClick={() => setAreas([])}><RegionIcon region="all" /></IconButton>{REGIONS.map(region => <IconButton className="catalog-area-button" key={region} label={t(areas.includes(region) ? 'Remover filtro: {0}' : 'Filtrar por: {0}', areaName(region))} aria-pressed={areas.includes(region)} onClick={() => setArea(region)}><RegionIcon region={region} /></IconButton>)}</div></header>
      <div ref={context} className="catalog-slot-context" hidden={!slot} inert={!slot} aria-hidden={!slot}><div><strong>{t('Escolher widget')}</strong><span>{slotLabel}</span></div><IconButton label="Cancelar seleção de widget" onClick={() => cancelChoice(true)}><XMarkIcon className="icon" /></IconButton></div>
      <div className="widget-catalog-library"><nav className="widget-catalog-categories" aria-label={t('Categorias de widgets')}><div ref={categoriesScroll} className="widget-catalog-category-list ui-scrollbar">{['all', ...categories].map(value => <button key={value} className="ui-button widget-category-link" aria-current={selectedCategory === value ? 'true' : 'false'} onClick={() => setCategory(value)}><span className="widget-category-icon"><WidgetIcon category={value} /></span><span><strong>{t(value === 'all' ? 'Todos os widgets' : value)}</strong><small>{t('{0} widgets', matches.filter(type => value === 'all' || type.category === value).length)}</small></span></button>)}</div><button className="ui-button widget-catalog-explore" onClick={openPlugins}><PlusIcon className="icon" /><span><strong>{t('Explore plugins')}</strong><small>{t('Mais recursos para seu projeto')}</small></span><ChevronRightIcon className="icon" /></button></nav>
      <div ref={viewport} className="widget-browser-content ui-scrollbar">
        {types.some(type => disabled.has(type.owner)) && <div className="plugins-paused-notice"><p>{t('Ative os plugins pausados para usar seus widgets.')}</p><button className="ui-button workspace-text-action" onClick={openPlugins}>{t('Gerenciar plugins')}</button></div>}
        <div ref={grid} className="widget-browser-grid" role="group" aria-label={t('{0} · {1}', t(selectedCategory === 'all' ? 'Todos os widgets' : selectedCategory), ownerName(selectedPlugin))}>{eligible.map(type => {
          const available = admission?.get(type.id) ?? []
          const title = type.owner === 'host' ? t(type.title) : type.title
          const policy = slot ? evaluatePlacement(view, registry, type.id, slot.region, 'catalog', [], disabled) : null
          const limit = type.constraint.regions.some(region => evaluatePlacement(view, registry, type.id, region, 'catalog', [], disabled).reason === 'limit')
          const occupied = !type.constraint.regions.some(region => evaluatePlacement(view, registry, type.id, region, 'catalog', [], disabled).allowed)
          const unavailable = t(disabled.has(type.owner) ? 'Plugin pausado' : limit ? 'Limite de views atingido. Reutilize uma view existente.' : occupied ? 'Este widget já está em todas as áreas permitidas. Mova o widget existente para reorganizar.' : 'Não há área compatível com espaço disponível para este widget.')
          const slotFits = slot ? !!addWidget(view, registry, type.id, { ...view.reference[slot.region], region: slot.region, expanded: false }, slot, disabled, { width: slot.width, height: slot.height }) : true
          const reason = slot && (!policy?.allowed ? t(policy?.reason === 'paused' ? 'Plugin pausado' : policy?.reason === 'limit' ? 'Limite de views atingido. Reutilize uma view existente.' : 'Este widget já está nesta área.') : constraintInRegion(type.constraint, slot.region).min.width > slot.width || constraintInRegion(type.constraint, slot.region).min.height > slot.height ? t('O espaço é menor que o mínimo deste widget.') : !slotFits ? t('Não há espaço disponível para os mínimos deste widget.') : '')
          return <div key={type.id} className="widget-browser-item" data-saturated={!available.length && !slot}>
            <button className="ui-button widget-browser-tile" {...(slot ? {} : interaction.catalogHandlers(type.id))} disabled={!!reason} data-catalog-type={type.id} title={slot ? reason || t('Escolher {0}: {1}', title, slotLabel) : available.length ? t('Arraste para adicionar. Clique para escolher uma área.') : unavailable}
              onClick={() => { if (slot) { if (add(type.id, slot.region, slot)) chooseSlot(null) } else if (available.length) { setMovingTarget(null); setTarget(type.id) } else tx.setMessage(unavailable) }}>
              <span className="widget-browser-tile-icon"><WidgetIcon type={type} /></span><strong>{title}</strong></button>
            <div className="widget-browser-presence widget-location" role="group" aria-label={t('Presenças de {0}', title)}>{view.placements.filter(p => view.organization.views.find(v => v.id === p.id)?.typeId === type.id && (p.region !== 'sidebar' || view.organization.bars.find(bar => bar.id === view.organization.activeBar)!.members.includes(type.id))).sort((a, b) => ['sidebar', 'main', 'bottom'].indexOf(a.region) - ['sidebar', 'main', 'bottom'].indexOf(b.region)).map(p => <IconButton className="widget-location-remove" key={p.id} label={t('Remover {0} da área {1}', title, areaName(p.region))} onClick={() => { if (previous.current) previous.current.tab = 'widgets'; chooseSlot(null); remove(p.id) }}><RegionIcon region={p.region} /></IconButton>)}</div>
          </div>
        })}</div>{!eligible.length && <div className="workspace-search-empty"><p>{t('Nenhum widget com esses filtros.')}</p><button className="ui-button workspace-text-action" onClick={() => { setSearch(''); setAreas(slot ? [slot.region] : []); setPlugin('all'); setCategory('all') }}>{t('Limpar filtros')}</button></div>}</div></div>
      <Popover title="Filtrar widgets por plugin" bare className="workspace-popover catalog-plugin-filter ui-scrollbar" anchor={filterAnchor} open={pluginFilter} close={() => setPluginFilter(false)}><p className="workspace-section-label">{t('Filtrar por plugin')}</p>{['all', ...owners].map(owner => <button className="ui-button profile-menu-item" key={owner} role="menuitemradio" aria-checked={selectedPlugin === owner} onClick={() => { setPlugin(owner); setCategory('all'); setPluginFilter(false) }}><Squares2X2Icon className="icon" /><span>{ownerName(owner)}</span><span className="catalog-filter-check" aria-hidden="true">✓</span></button>)}</Popover>
      <div ref={destination} className="widget-browser-destination" hidden={!chosen}><strong>{chosen ? t('Onde colocar {0}?', chosen.owner === 'host' ? t(chosen.title) : chosen.title) : ''}</strong><p className="widget-presence-policy">{chosen && t(movingTarget || chosen.presence === 'single-view' ? 'Este widget tem uma única presença. Escolha para onde mover.' : 'Este widget compartilha os dados entre presenças em áreas diferentes.')}</p><div role="group" aria-label={t('Área de destino')}>{(['sidebar', 'main', 'bottom'] as const).map(region => <button key={region} className="ui-button" data-widget-place={region} title={destinationReason(region) || t('Colocar em {0}', areaName(region))} disabled={!!destinationReason(region)} onClick={() => { if (chosen && (movingTarget ? move(movingTarget, region) : add(chosen.id, region))) { setTarget(null); setMovingTarget(null) } }}>{areaName(region)}</button>)}</div></div>
      <footer className="widget-browser-footer"><span className="widget-catalog-result-count">{t('{0} widgets', eligible.length)} · {ownerName(selectedPlugin)} · {areas.length ? areas.map(areaName).join(' + ') : t('Todas as áreas')}</span><small>{t(slot ? 'Clique em um widget para preencher o espaço selecionado.' : 'Dica: arraste um widget até a área desejada ou clique para escolher o destino.')}</small></footer>
    </section><CompositionLibrary tx={tx} registry={registry} view={view} hidden={tab !== 'compositions'} />
  </aside></div><IconButton label={open ? 'Recolher editor' : 'Mostrar editor'} className="widget-catalog-toggle" hidden={!tx.editing} aria-expanded={open} onClick={() => setOpen(!open)}><span className="widget-catalog-toggle-icon"><ChevronRightIcon className="icon" /></span></IconButton>
  </>
}
function CompositionLibrary({ tx, registry, view, hidden }: { tx: Transaction; registry: Registry; view: WorkbenchSnapshot; hidden: boolean }) {
  const { t } = useLocale(), [tab, setTab] = useState('favorites'), [search, setSearch] = useState(''), [form, setForm] = useState(false), [name, setName] = useState('')
  const [scopes, setScopes] = useState<Region[]>(['main', 'bottom']), [sideWidth, setSideWidth] = useState(true)
  const [options, setOptions] = useState<Composition | null>(null), grid = useRef<HTMLDivElement>(null), [optionsPoint, setOptionsPoint] = useState({ x: 0, y: 0 })
  const [confirm, setConfirm] = useState<{ title: string; text: string; label?: string; destructive?: boolean; run(): void } | null>(null), [replace, setReplace] = useState<{ id: string; makeDefault: boolean; selected: string | null } | null>(null)
  const organization = tx.snapshot.organization, all = [...systemCompositions(), ...organization.compositions], scroll = useRef<HTMLDivElement>(null)
  useScrollState(scroll)
  function displayName(item: Composition) { return item.system ? t(item.name) : item.name }
  useEffect(() => { if (tx.editing) { setSearch(''); setTab('favorites') } }, [tx.editing])
  const list = (search ? all : compositionOrder(tx.snapshot, tab === 'favorites').map(id => all.find(item => item.id === id)!).filter(Boolean))
    .filter(item => normalizeSearch(item.system ? t(item.name) : item.name).includes(normalizeSearch(search)))
  function favorite(id: string, makeDefault = false, replacement?: string) {
    if (makeDefault && organization.defaultComposition === id) { tx.action({ ...tx.live.current, organization: { ...tx.live.current.organization, defaultComposition: null } }); return }
    const present = organization.favorites.includes(id), next = favoriteComposition(tx.live.current, id, makeDefault || !present, makeDefault, replacement)
    if (next) tx.action(next); else setReplace({ id, makeDefault, selected: null })
  }
  function toggleFavorite(item: Composition) {
    if (!organization.favorites.includes(item.id)) { favorite(item.id); return }
    const clearDefault = organization.defaultComposition === item.id
    if (clearDefault || tab === 'favorites') setConfirm({ title: clearDefault ? 'Desmarcar a composição padrão?' : t('Remover {0} dos favoritos?', item.system ? t(item.name) : item.name), text: clearDefault ? t('“{0}” precisa deixar de ser padrão para sair dos favoritos. Ao continuar, as duas marcações serão removidas. A composição continuará salva.', item.system ? t(item.name) : item.name) : t('A composição sairá desta aba e continuará disponível em Composições Salvas.'), label: clearDefault ? 'Desmarcar e remover favorito' : 'Remover dos favoritos', run() { favorite(item.id) } })
    else favorite(item.id)
  }
  function apply(item: Composition, requested: 'format' | 'widgets') {
    const scene = compositionScene(tx.live.current, view, item.scopes)
    const remainingSource = tx.formatSource?.placements.filter(p => !item.scopes.includes(p.region)) ?? []
    const retainedSource = remainingSource.length ? { placements: remainingSource, reference: structuredClone(tx.formatSource!.reference) } : null
    if (requested === 'format' && tx.formatMode === 'format' && tx.formatId === item.id && view.placements.some(p => item.scopes.includes(p.region))) {
      const next = { ...compositionChrome(scene, item), placements: scene.placements.filter(p => !item.scopes.includes(p.region)) }
      tx.action(next, [...tx.slots.filter(slot => !item.scopes.includes(slot.region)), ...compositionSlots(item, next)], item.id, {
        placements: [...remainingSource, ...view.placements.filter(p => item.scopes.includes(p.region))],
        reference: { ...(retainedSource?.reference ?? view.reference), ...Object.fromEntries(item.scopes.map(region => [region, structuredClone(view.reference[region])])) }
      }, { duration: 380, entering: true }, 'format'); return
    }
    const base = requested === 'format' && tx.formatSource ? { ...scene, placements: [...scene.placements, ...tx.formatSource.placements.filter(p => item.scopes.includes(p.region)
      && !view.placements.some(q => q.id === p.id || q.region === p.region))] } : scene
    const next = applyComposition(base, registry, item, requested)
    if (next) tx.action(next, [...tx.slots.filter(slot => !item.scopes.includes(slot.region)), ...compositionSlots(item, next)], item.id, retainedSource, { duration: 380, entering: true }, requested)
    else tx.setMessage(t('Composição incompatível ou sem espaço. Amplie a região e tente novamente.'))
  }
  function reorder(item: Composition, offset: number) {
    if (search) return
    const order = compositionOrder(tx.live.current, tab === 'favorites'), index = order.indexOf(item.id), to = index + offset
    if (to < 0 || to >= order.length) return
    const next = reorderComposition(tx.live.current, item.id, order[to + (offset > 0 ? 1 : 0)] ?? null, tab === 'favorites')
    if (next) tx.action(next)
  }
  useCompositionReorder(grid, tx.editing && !hidden && !search, (id, before) => { const next = reorderComposition(tx.live.current, id, before, tab === 'favorites'); if (next) tx.action(next) }, tx)
  function saveCurrent() {
    function openSave() { const chrome = tx.live.current.organization.chrome; setScopes(chrome.bottom.visible ? ['main', 'bottom'] : ['main']); setSideWidth(chrome.sidebar.visible); setForm(true) }
    if (!tx.hasPending()) { openSave(); return }
    setConfirm({ title: 'Salvar a edição primeiro?', text: t('Salve o checkpoint da edição e continue para criar uma composição. O editor e as reservas continuam abertos.'), label: 'Salvar edição e continuar', run() { void tx.saveEditing(view).then(ok => { if (ok) openSave() }) } })
  }
  return <section id="layout-menu" role="tabpanel" hidden={hidden}><div className="widget-catalog-toolbar composition-search-toolbar"><label className="workspace-search"><MagnifyingGlassIcon className="icon" /><input className="ui-input" type="search" value={search} placeholder={t('Buscar composições…')} aria-label={t('Buscar composições')} onChange={event => setSearch(event.target.value)} /></label></div><div className="layout-menu-tabs" role="tablist" hidden={!!search}>{[['favorites', 'Composições Favoritas'], ['saved', 'Composições Salvas']].map(([id, title]) => <button key={id} role="tab" className="ui-button workspace-section-label layout-menu-tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id!)}>{t(title!)}</button>)}</div>
    <div ref={scroll} className="layout-menu-content ui-scrollbar" data-composition-scroll><div id={tab === 'saved' ? 'layout-saved-panel' : 'layout-favorites-panel'} className="layout-menu-panel"><div ref={grid} className="layout-presets" data-reorder-compositions>{list.map(item => <article key={item.id} className="composition-tile" data-composition-id={item.id} data-composition-card={item.id} data-editing-composition={tx.formatId === item.id ? '' : undefined}><button className="ui-button layout-preset" data-current-preset={item.system && tx.formatId === item.id ? '' : undefined} aria-label={t('Aplicar formato de {0}', displayName(item))} data-composition-reorder disabled={tx.saving} onClick={() => apply(item, 'format')} onKeyDown={event => { if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(/\s+/).length : 1; reorder(item, event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns) } }}>
      <CompositionThumbnail composition={item} /><span className="composition-name">{displayName(item)}</span></button><div className="composition-restore-actions"><button className="ui-button composition-restore-button" aria-label={t('Aplicar formato de {0}', displayName(item))} onClick={() => apply(item, 'format')}>{t('Formato')}</button>{item.mode === 'format-widgets' && <button className="ui-button composition-restore-button" aria-label={t('Restaurar widgets de {0}', displayName(item))} onClick={() => apply(item, 'widgets')}>{t('Widgets')}</button>}</div>
      <div className="composition-markers"><IconButton label={t(organization.defaultComposition === item.id ? 'Remover {0} como padrão' : 'Tornar {0} padrão', displayName(item))} className="composition-control" data-composition-action="default" onClick={() => favorite(item.id, true)} aria-pressed={organization.defaultComposition === item.id}><WorkbenchIcon name="pin" /></IconButton><IconButton label={t(organization.favorites.includes(item.id) ? 'Remover {0} dos favoritos' : 'Adicionar {0} aos favoritos', displayName(item))} className="composition-control" data-composition-action="favorite" aria-pressed={organization.favorites.includes(item.id)} onClick={() => toggleFavorite(item)}><StarIcon className="icon" /></IconButton></div><IconButton label={t('Opções de {0}', displayName(item))} className="composition-control composition-options" aria-expanded={options?.id === item.id} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setOptionsPoint({ x: box.right - 220, y: box.bottom + 5 }); setOptions(options?.id === item.id ? null : item) }}><EllipsisHorizontalIcon className="icon" /></IconButton></article>)}</div>{!list.length && <p className="saved-layouts-empty">{t(search ? 'Nenhuma composição encontrada.' : 'Adicione composições aos favoritos pela aba Composições Salvas.')}</p>}</div></div>
      <button className="ui-button workspace-text-action composition-store" onClick={() => tx.setMessage(t('Em breve'))}>{t('Importar composições da loja')}<span className="composition-store-note">{t('Em breve')}</span></button>{tx.hasPending() && <p className="layout-save-pending" role="status">{t('Há alterações pendentes. Salvar atual vai pedir para salvar a edição primeiro.')}</p>}<footer className="layout-menu-footer"><button className="ui-button tool-button" onClick={() => { const item = all.find(item => item.id === organization.defaultComposition) ?? systemCompositions()[0]!; apply(item, 'widgets') }}><ArrowPathIcon className="icon" />{t('Restaurar layout padrão')}</button><button className="ui-button tool-button ui-button-primary" disabled={organization.compositions.length >= LIMITS.compositions} onClick={saveCurrent}><PlusIcon className="icon" />{t('Salvar atual')}</button></footer>
    <Popover title="Opções da composição" bare className="workspace-popover ui-context-menu" point={optionsPoint} open={!!options} close={() => setOptions(null)}>{options && <><button className="ui-button workspace-command" role="menuitem" onClick={() => { favorite(options.id, true); setOptions(null) }}>{t(organization.defaultComposition === options.id ? 'Remover como padrão' : 'Tornar padrão')}</button><button className="ui-button workspace-command" role="menuitem" onClick={() => { toggleFavorite(options); setOptions(null) }}>{t(organization.favorites.includes(options.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos')}</button>{!options.system && <button className="ui-button workspace-command is-destructive" role="menuitem" onClick={() => { const item = options; setOptions(null); setConfirm({ title: t('Excluir {0}?', item.name), text: t('A composição será excluída das salvas e dos favoritos. Os widgets e o espaço de trabalho atual serão preservados.'), label: 'Excluir composição', destructive: true, run() { const next = structuredClone(tx.live.current); next.organization.compositions = next.organization.compositions.filter(record => record.id !== item.id); next.organization.favorites = next.organization.favorites.filter(id => id !== item.id); next.organization.compositionOrder = next.organization.compositionOrder?.filter(id => id !== item.id); if (next.organization.defaultComposition === item.id) next.organization.defaultComposition = null; tx.action(next) } }) }}>{t('Excluir composição')}</button>}</>}</Popover>
    {form && <Dialog title="Salvar nova composição" close={() => setForm(false)}><p className="profile-dialog-description">{t('Guarde o formato e os widgets das áreas selecionadas.')}</p><form className="layout-save-form" onSubmit={event => {
      event.preventDefault()
      void tx.saveComposition(captureCurrentComposition(view, name.trim(), scopes, sideWidth, tx.slots)).then(ok => { if (ok) { setForm(false); setName('') } })
    }}><div className="layout-save-preview"><CompositionThumbnail composition={captureCurrentComposition(view, 'preview', scopes, sideWidth, tx.slots)} /></div><label className="custom-bar-field"><span>{t('Nome')}</span><input data-initial-focus className="ui-input" required maxLength={40} placeholder={t('Ex.: Meu espaço de trabalho')} autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label><fieldset className="layout-save-choices"><legend>{t('Áreas incluídas')}</legend>{(['main', 'bottom'] as const).map(region => <label key={region}><input type="checkbox" checked={scopes.includes(region)} onChange={event => setScopes(event.target.checked ? [...scopes, region] : scopes.filter(value => value !== region))} /><span>{t(region === 'main' ? 'Área principal' : 'Barra inferior')}</span></label>)}<label><input type="checkbox" checked={sideWidth} onChange={event => setSideWidth(event.target.checked)} /><span>{t('Largura da barra lateral')}</span></label></fieldset><p className="custom-bar-hint">{t('Inclua as áreas desejadas, mesmo recolhidas. A lateral salva apenas a largura, sem suas barras ou widgets. Áreas não selecionadas permanecem como estão.')}</p><p role="status">{t(tx.message)}</p><footer className="custom-bar-actions"><button type="button" className="ui-button tool-button" onClick={() => setForm(false)}>{t('Cancelar')}</button><button className="ui-button plugins-button" disabled={tx.saving || (!scopes.length && !sideWidth)}>{t('Salvar composição')}</button></footer></form></Dialog>}
    {replace && <Dialog className="composition-favorite-dialog" title="Favoritos cheios" close={() => setReplace(null)}><p className="profile-dialog-description">{t(replace.makeDefault ? 'Para tornar “{0}” padrão, ela também precisa ser favorita. Você já tem 9 favoritas. Escolha qual substituir.' : 'Você já tem 9 composições favoritas. Escolha qual substituir por “{0}”.', all.find(item => item.id === replace.id)?.name ?? '')}</p><div className="layout-presets composition-replacement-grid" role="group" aria-label={t('Escolha o favorito que será substituído')}>{organization.favorites.map(id => { const item = all.find(item => item.id === id)!; return <div className="composition-tile" key={id}><button className="ui-button layout-preset" aria-pressed={replace.selected === id} aria-label={t('Substituir {0}', item.system ? t(item.name) : item.name)} onClick={() => setReplace({ ...replace, selected: id })}><CompositionThumbnail composition={item} /><strong>{item.system ? t(item.name) : item.name}</strong></button>{organization.defaultComposition === id && <span className="composition-replacement-pin" aria-hidden="true"><WorkbenchIcon name="pin" /></span>}</div> })}</div><p className="custom-bar-hint">{t('A composição substituída continuará em Composições Salvas.')}</p><p className="composition-replacement-warning" role="status" hidden={replace.selected !== organization.defaultComposition}>{t(replace.makeDefault ? 'A composição selecionada deixará de ser favorita. A nova composição será o padrão.' : 'A composição selecionada deixará de ser padrão e favorita.')}</p><div className="workspace-dialog-actions"><button className="ui-button workspace-secondary" onClick={() => setReplace(null)}>{t('Cancelar')}</button><button className="ui-button workspace-primary" disabled={!replace.selected} onClick={() => { favorite(replace.id, replace.makeDefault, replace.selected!); setReplace(null) }}>{t(replace.makeDefault ? 'Substituir e tornar padrão' : replace.selected === organization.defaultComposition ? 'Desmarcar e substituir' : 'Substituir favorito')}</button></div></Dialog>}
    {confirm && <Confirm title={confirm.title} text={confirm.text} destructive={confirm.destructive ?? false} label={confirm.label} confirm={confirm.run} close={() => setConfirm(null)} />}
  </section>
}
