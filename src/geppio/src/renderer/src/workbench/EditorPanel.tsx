import { reducedMotion } from '@geppio/ui'
import { useEffect, useRef, useState } from 'react'
import { ChevronRightIcon, MagnifyingGlassIcon, Squares2X2Icon, PlusIcon, FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { constraintInRegion } from '../../../shared/freeform/policy.ts'
import { addWidget, moveView } from '../../../shared/workbench/commands.ts'
import { useScrollState } from '@geppio/ui'
import { REGIONS } from '@geppio/runtime/layout/types'
import type { Region } from '@geppio/runtime/layout/types'
import { evaluatePlacement, surfacePlacements } from '../../../shared/workbench/model.ts'
import type { SessionSlot, Registry, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import type { Transaction } from '../freeform/useTransaction.ts'
import type { Interaction } from '../freeform/useInteraction.ts'
import { IconButton, Popover } from './Primitives.tsx'
import { normalizeSearch, useLocale } from './Locale.tsx'
import { WidgetIcon } from './WidgetIcon.tsx'
import { useCatalogAvailability } from './useCatalogAvailability.ts'
import type { PortableEnvironment } from './compositions/usePortableCompositions.tsx'
import { CompositionLibrary } from './compositions/CompositionLibrary.tsx'

export function RegionIcon({ region }: { region: Region | 'all' }) {
  const area = region === 'all' ? { x: 4, y: 5, width: 16, height: 14 } : region === 'sidebar' ? { x: 4, y: 5, width: 3, height: 14 }
    : region === 'main' ? { x: 9, y: 5, width: 11, height: 14 } : { x: 4, y: 16, width: 16, height: 3 }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect {...area} rx=".5" fill="currentColor" stroke="none" opacity=".4" /><rect x="3" y="4" width="18" height="16" rx="2" /><path strokeLinecap="round" d={region === 'all' ? 'M8 4v16m0-5h13' : region === 'bottom' ? 'M3 15h18' : 'M8 4v16'} /></svg>
}
export function EditorPanel({ tx, registry, open, setOpen, slot, chooseSlot, add, remove, view, disabled, interaction, openPlugins, request, moveRequest, move, portableEnvironment }: {
  portableEnvironment: Omit<PortableEnvironment, 'disabled'>
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
    if (reducedMotion().matches) return
    const selected = document.querySelector('[data-catalog-slot-target]'), easing = getComputedStyle(context.current!).getPropertyValue('--region-easing').trim()
    const animations = [
      context.current?.firstElementChild?.animate([{ opacity: .25, translate: '0 -6px' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing }),
      grid.current?.animate([{ opacity: .62, translate: '6px 0' }, { opacity: 1, translate: '0 0' }], { duration: 260, easing }),
      selected?.animate([{ boxShadow: '0 0 0 0px transparent' }, { boxShadow: '0 0 0 5px var(--color-accent-soft)', offset: .35 }, { boxShadow: '0 0 0 0px transparent' }], { duration: 520, easing })
    ]
    return () => animations.forEach(animation => animation?.cancel())
  }, [slot?.id])
  const types = [...registry.values()].filter(type => !type.retired && !type.missing && (!slot || type.constraint.regions.includes(slot.region)) && (!areas.length || areas.some(region => type.constraint.regions.includes(region))))
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
            <div className="widget-browser-presence widget-location" role="group" aria-label={t('Presenças de {0}', title)}>{surfacePlacements(view).filter(p => view.organization.views.find(v => v.id === p.id)?.typeId === type.id && (p.region !== 'sidebar' || view.organization.bars.find(bar => bar.id === view.organization.activeBar)!.members.includes(type.id))).sort((a, b) => ['sidebar', 'main', 'bottom'].indexOf(a.region) - ['sidebar', 'main', 'bottom'].indexOf(b.region)).map(p => <IconButton className="widget-location-remove" key={p.id} label={t('Remover {0} da área {1}', title, areaName(p.region))} onClick={() => { if (previous.current) previous.current.tab = 'widgets'; chooseSlot(null); remove(p.id) }}><RegionIcon region={p.region} /></IconButton>)}</div>
          </div>
        })}</div>{!eligible.length && <div className="workspace-search-empty"><p>{t('Nenhum widget com esses filtros.')}</p><button className="ui-button workspace-text-action" onClick={() => { setSearch(''); setAreas(slot ? [slot.region] : []); setPlugin('all'); setCategory('all') }}>{t('Limpar filtros')}</button></div>}</div></div>
      <Popover title="Filtrar widgets por plugin" bare className="workspace-popover catalog-plugin-filter ui-scrollbar" anchor={filterAnchor} open={pluginFilter} close={() => setPluginFilter(false)}><p className="workspace-section-label">{t('Filtrar por plugin')}</p>{['all', ...owners].map(owner => <button className="ui-button profile-menu-item" key={owner} role="menuitemradio" aria-checked={selectedPlugin === owner} onClick={() => { setPlugin(owner); setCategory('all'); setPluginFilter(false) }}><Squares2X2Icon className="icon" /><span>{ownerName(owner)}</span><span className="catalog-filter-check" aria-hidden="true">✓</span></button>)}</Popover>
      <div ref={destination} className="widget-browser-destination" hidden={!chosen}><strong>{chosen ? t('Onde colocar {0}?', chosen.owner === 'host' ? t(chosen.title) : chosen.title) : ''}</strong><p className="widget-presence-policy">{chosen && t(movingTarget || chosen.presence === 'single-view' ? 'Este widget tem uma única presença. Escolha para onde mover.' : 'Este widget compartilha os dados entre presenças em áreas diferentes.')}</p><div role="group" aria-label={t('Área de destino')}>{(['sidebar', 'main', 'bottom'] as const).map(region => <button key={region} className="ui-button" data-widget-place={region} title={destinationReason(region) || t('Colocar em {0}', areaName(region))} disabled={!!destinationReason(region)} onClick={() => { if (chosen && (movingTarget ? move(movingTarget, region) : add(chosen.id, region))) { setTarget(null); setMovingTarget(null) } }}>{areaName(region)}</button>)}</div></div>
      <footer className="widget-browser-footer"><span className="widget-catalog-result-count">{t('{0} widgets', eligible.length)} · {ownerName(selectedPlugin)} · {areas.length ? areas.map(areaName).join(' + ') : t('Todas as áreas')}</span><small>{t(slot ? 'Clique em um widget para preencher o espaço selecionado.' : 'Dica: arraste um widget até a área desejada ou clique para escolher o destino.')}</small></footer>
    </section><CompositionLibrary tx={tx} registry={registry} view={view} hidden={!open || !tx.editing || tab !== 'compositions'} environment={{ ...portableEnvironment, disabled }} />
  </aside></div><IconButton label={open ? 'Recolher editor' : 'Mostrar editor'} className="widget-catalog-toggle" hidden={!tx.editing} aria-expanded={open} onClick={() => setOpen(!open)}><span className="widget-catalog-toggle-icon"><ChevronRightIcon className="icon" /></span></IconButton>
  </>
}
