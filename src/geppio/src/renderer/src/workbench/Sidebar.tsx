import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FolderIcon, PlusIcon, SunIcon, MoonIcon, PencilSquareIcon, ArchiveBoxIcon, MagnifyingGlassIcon, EllipsisHorizontalIcon, Squares2X2Icon } from '@heroicons/react/24/outline'
import { useScrollState } from '@geppio/ui'
import { HOME, LIMITS } from '../../../shared/workbench/model.ts'
import type { Registry, UserBar } from '../../../shared/workbench/model.ts'
import { deleteBar, reorderBar, updateBar } from '../../../shared/workbench/commands.ts'
import type { Transaction } from '../freeform/useTransaction.ts'
import type { useRegions } from './useRegions.ts'
import { Confirm, IconButton, Popover } from './Primitives.tsx'
import { normalizeSearch, useLocale } from './Locale.tsx'
import { useBarReorder } from './bars/useBarReorder.ts'
import { EditOutline } from './EditOutline.tsx'
import { WorkbenchIcon } from './WorkbenchIcon.tsx'
import { WidgetIcon } from './WidgetIcon.tsx'
import { BarIcon } from './bars/BarIcon.tsx'
import { BarForm } from './bars/BarForm.tsx'

interface SidebarRail { label: string; heading: string; primary: ReactNode; tools: ReactNode }
export function Sidebar({ tx, registry, regions, sidebarWidth, theme, toggleTheme, saveBar, children, rail }: {
  tx: Transaction; registry: Registry; regions: ReturnType<typeof useRegions>; theme: string; toggleTheme(): void;
  saveBar(bar: UserBar): Promise<boolean>; sidebarWidth: number; children: ReactNode; rail?: SidebarRail
}) {
  const { t } = useLocale(), [form, setForm] = useState<UserBar | null>(null), [library, setLibrary] = useState(false), [context, setContext] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; run(): void } | null>(null), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [sort, setSort] = useState('original')
  const anchor = useRef<HTMLButtonElement>(null), customBars = useRef<HTMLDivElement>(null), libraryViewport = useRef<HTMLDivElement>(null), railScroll = useRef<HTMLDivElement>(null)
  useScrollState(libraryViewport); useScrollState(railScroll)
  useEffect(() => { if (libraryViewport.current) libraryViewport.current.scrollTop = 0; setLibraryContext(null) }, [search, filter, sort])
  const [contextPoint, setContextPoint] = useState({ x: 0, y: 0 })
  const [libraryContext, setLibraryContext] = useState<string | null>(null), [libraryPoint, setLibraryPoint] = useState({ x: 0, y: 0 })
  const workbenchBars = !rail
  useEffect(() => {
    if (!workbenchBars) { setLibrary(false); setContext(null); setLibraryContext(null) }
  }, [workbenchBars])
  const organization = tx.snapshot.organization, bars = organization.bars, active = bars.find(bar => bar.id === organization.activeBar)!
  const canRestore = bars.filter(bar => !bar.archived && bar.id !== HOME).length < LIMITS.activeBars
  function change(next: typeof tx.snapshot | null) { if (next) void tx.commitOrganization(next); else tx.setMessage(t('Limite de barras atingido.')) }
  function select(bar: UserBar) {
    if (bar.id === active.id) { if (!tx.editing) regions.toggle('sidebar') }
    else { change({ ...tx.live.current, organization: { ...tx.live.current.organization, activeBar: bar.id } }); if (regions.sidebarMode === 'hidden') regions.hover(true) }
  }
  function restoreBar(bar: UserBar) { const next = updateBar(tx.live.current, { ...bar, archived: false }); if (next) { next.organization.activeBar = bar.id; change(next); regions.revealSidebar(); setLibrary(false) } }
  function manageBar(bar: UserBar) { setForm(null); if (bar.archived) setConfirm({ title: t('Excluir {0}?', label(bar)), run() { change(deleteBar(tx.live.current, bar.id)) } }); else change(updateBar(tx.live.current, { ...bar, archived: true })) }
  function create() { setForm({ id: `bar:${crypto.randomUUID()}`, name: '', userNamed: true, icon: 'widgets', archived: false, members: [] }) }
  function dropBar(id: string, before: string | null) {
    if (!id || !tx.editing || id === HOME || id === before) return
    const bar = tx.live.current.organization.bars.find(bar => bar.id === id)
    if (!bar) return
    const next = updateBar(tx.live.current, { ...bar, archived: false })
    if (!next) return
    const records = next.organization.bars, from = records.findIndex(bar => bar.id === id), entry = records.splice(from, 1)[0]!
    const target = before ? records.findIndex(bar => bar.id === before) : records.length
    records.splice(Math.max(1, target), 0, entry); if (bar.archived) next.organization.activeBar = bar.id; change(next); if (bar.archived) { regions.revealSidebar(); setLibrary(false) }
  }
  const reorder = useBarReorder(customBars, tx.editing, dropBar, tx)
  function label(bar: UserBar) { return bar.userNamed ? bar.name : t(bar.name) }
  const chosen = bars.find(bar => bar.id === context)
  const libraryChosen = bars.find(bar => bar.id === libraryContext)
  const filtered = bars.filter(bar => (filter === 'all' || (filter === 'archived' ? bar.archived : !bar.archived)) && normalizeSearch(label(bar)).includes(normalizeSearch(search)))
  if (sort === 'name') filtered.sort((a, b) => label(a).localeCompare(label(b)))
  function barButton(bar: UserBar) {
    return <IconButton key={bar.id} label={label(bar)} literalLabel data-bar-id={bar.id} data-sidebar-custom={bar.id === HOME ? undefined : bar.id} className={'sidebar-rail-button ' + (bar.id === HOME ? 'sidebar-main-button' : '')} aria-current={bar.id === active.id ? 'true' : undefined}
      onClick={() => select(bar)} onContextMenu={event => { event.preventDefault(); setContextPoint({ x: event.clientX, y: event.clientY }); setContext(bar.id) }}
      onKeyDown={event => { if (event.key === 'F10' && event.shiftKey) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setContextPoint({ x: rect.right, y: rect.top }); setContext(bar.id) } else if (tx.editing && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); change(reorderBar(tx.live.current, bar.id, event.key === 'ArrowUp' ? -1 : 1)) } }}><BarIcon icon={bar.icon} /></IconButton>
  }
  return <><div className="sidebar-panel host-rail-panel"><nav className="sidebar-rail" aria-label={rail?.label ?? t('Barras do usuário')}>
    <div className="sidebar-rail-primary" onPointerEnter={() => regions.hover(true)} onPointerLeave={() => regions.hover(false)}>
      <div className="sidebar-rail-header">{rail ? rail.primary : barButton(bars[0]!)}</div>
      <div ref={railScroll} className="sidebar-rail-tools ui-scrollbar"><div ref={customBars} className="sidebar-custom-bars">{rail ? rail.tools : bars.filter(bar => !bar.archived && bar.id !== HOME).map(barButton)}</div></div>
    </div>
    <div className="sidebar-rail-footer">{!rail && <><button ref={anchor} className="ui-button ui-icon-button" aria-label={t('Barras salvas')} onClick={() => setLibrary(!library)}><FolderIcon className="icon" /></button><IconButton label="Nova barra" title={!canRestore ? t('Limite de {0} barras personalizadas ativas. Arquive uma para liberar espaço.', LIMITS.activeBars) : t('Nova barra')} onClick={create} disabled={bars.length > LIMITS.savedBars || !canRestore}><PlusIcon className="icon" /></IconButton></>}<IconButton label="Alternar tema" onClick={toggleTheme}>{theme === 'dark' ? <MoonIcon className="icon" /> : <SunIcon className="icon" />}</IconButton></div>
  </nav></div>
  {reorder.zone && <div className="layout-edit-zone layout-rail-zone" data-layout-rail-zone aria-hidden="true" style={reorder.zone}><EditOutline width={reorder.zone.width} height={reorder.zone.height} /></div>}
  <div className={'host-sidebar-content ' + (regions.floating ? 'sidebar-floating' : '')} data-mode={regions.sidebarMode} inert={regions.sidebarMode === 'hidden'} onPointerEnter={() => regions.hover(true)} onPointerLeave={() => regions.hover(false)}>
    <div className="sidebar-viewport"><header className="sidebar-header"><h2 className="sidebar-heading">{rail?.heading ?? label(active)}</h2><IconButton label={regions.sidebarMode === 'docked' ? 'Recolher barra lateral' : 'Fixar barra lateral'} className="sidebar-pin sidebar-toggle" disabled={tx.editing} aria-pressed={regions.sidebarMode === 'docked'} onClick={() => regions.toggle('sidebar')}><WorkbenchIcon name="sidebar" /></IconButton></header>{children}</div>
  </div>
  <Popover title="Barras salvas" description="Encontre suas barras e retome seu espaço." className="sidebar-bars-library" placement="rail" open={!rail && library} close={() => setLibrary(false)} anchor={anchor}>
    <div className="bar-library-toolbar"><label className="workspace-search"><MagnifyingGlassIcon className="icon" /><input className="ui-input" type="search" placeholder={t('Buscar barra...')} value={search} onChange={event => setSearch(event.target.value)} /></label><select className="ui-input" value={sort} onChange={event => setSort(event.target.value)} aria-label={t('Ordenar barras')}><option value="original">{t('Ordem original')}</option><option value="name">{t('Nome (A–Z)')}</option></select></div>
    <div className="bar-library-filters">{[['all', 'Todas'], ['active', 'Na barrinha'], ['archived', 'Arquivadas']].map(([id, title]) => <button key={id} className="ui-button" aria-pressed={filter === id} onClick={() => setFilter(id!)}>{t(title!)} <span data-bar-filter-count={id}>{bars.filter(bar => id === 'all' || (id === 'active' ? !bar.archived : bar.archived)).length}</span></button>)}</div>
    <div ref={libraryViewport} className="bar-library-viewport ui-scrollbar"><div className="bar-library-grid">{filtered.map(bar => <article key={bar.id} className="bar-library-card"><div className="bar-library-card-top"><span className="bar-library-icon"><BarIcon icon={bar.icon} /></span><span className="bar-library-status">{t(bar.id === HOME ? 'Principal' : bar.archived ? 'Arquivada' : 'Na barrinha')}</span></div><strong className="bar-library-name">{label(bar)}</strong><div className="bar-library-preview">{bar.members.slice(0, 3).map(id => <span key={id} title={registry.get(id)?.title}><WidgetIcon type={registry.get(id)} /></span>)}<span>{t('{0} widgets', bar.members.length)}</span></div><div className="bar-library-actions"><button className={'ui-button bar-library-action ' + (bar.archived ? 'bar-library-restore' : '')} disabled={bar.archived && !canRestore} title={bar.archived && !canRestore ? t('Limite de {0} barras personalizadas ativas. Arquive uma para liberar espaço.', LIMITS.activeBars) : undefined} onClick={() => bar.archived ? restoreBar(bar) : (setLibrary(false), setForm(structuredClone(bar)))}>{t(bar.archived ? 'Restaurar' : 'Editar')}</button>{bar.archived && tx.editing && <button className="ui-button ui-icon-button bar-library-grip" disabled={!canRestore} aria-label={t('Arrastar {0} para a barrinha', label(bar))} onPointerDown={event => reorder.restore(event, bar.id, label(bar))}>⠿</button>}{bar.id !== HOME && <button className="ui-button ui-icon-button bar-library-more" aria-label={t('Opções de {0}', label(bar))} aria-haspopup="menu" aria-expanded={libraryContext === bar.id} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setLibraryPoint({ x: box.right, y: box.bottom + 4 }); setLibraryContext(libraryContext === bar.id ? null : bar.id) }}><EllipsisHorizontalIcon className="icon" /></button>}</div></article>)}</div>{!filtered.length && <div className="bar-library-empty"><Squares2X2Icon className="icon" /><strong>{t('Nenhuma barra encontrada')}</strong><p>{t('Tente outro nome ou limpe os filtros.')}</p><button className="ui-button workspace-text-action" onClick={() => { setSearch(''); setFilter('all'); setSort('original') }}>{t('Limpar filtros')}</button></div>}</div><footer className="bar-library-footer"><p className="bar-library-hint">{!canRestore ? t('Limite de {0} barras personalizadas ativas. Arquive uma para liberar espaço.', LIMITS.activeBars) : t(tx.editing ? 'Restaure ou arraste uma barra arquivada para a barrinha.' : 'Arquive para guardar. Restaure quando precisar.')}</p><button className="ui-button ui-button-primary" disabled={!canRestore || bars.length > LIMITS.savedBars} onClick={() => { setLibrary(false); create() }}><PlusIcon className="icon" />{t('Nova barra')}</button></footer>
  <Popover title="Opções da barra" bare className="workspace-popover ui-context-menu" point={libraryPoint} open={!rail && !!libraryChosen && library} close={() => setLibraryContext(null)}>{libraryChosen && <>{libraryChosen.archived && <button className="ui-button workspace-command" role="menuitem" onClick={() => { setForm(structuredClone(libraryChosen)); setLibrary(false); setLibraryContext(null) }}>{t('Editar')}</button>}<button className={'ui-button workspace-command ' + (libraryChosen.archived ? 'is-destructive' : '')} role="menuitem" onClick={() => { const bar = libraryChosen; setLibraryContext(null); if (bar.archived) { setLibrary(false); setConfirm({ title: t('Excluir {0}?', bar.name), run() { change(deleteBar(tx.live.current, bar.id)) } }) } else change(updateBar(tx.live.current, { ...bar, archived: true })) }}>{t(libraryChosen.archived ? 'Excluir barra' : 'Arquivar barra')}</button></>}</Popover>
  </Popover>
  <Popover title="Opções da barra" bare className="workspace-popover ui-context-menu" point={contextPoint} open={!rail && !!chosen} close={() => setContext(null)}>{chosen && <><button className="ui-button workspace-command" role="menuitem" onClick={() => { setForm(structuredClone(chosen)); setContext(null) }}><PencilSquareIcon className="icon" />{t('Editar')}</button>{chosen.id !== HOME && <button className="ui-button workspace-command" role="menuitem" onClick={() => { change(updateBar(tx.live.current, { ...chosen, archived: true })); setContext(null) }}><ArchiveBoxIcon className="icon" />{t('Arquivar')}</button>}</>}</Popover>
  {form && <BarForm bar={form} registry={registry} sidebarWidth={sidebarWidth} message={tx.message} close={() => setForm(null)} save={saveBar} manage={manageBar} />}
  {confirm && <Confirm title={confirm.title} text={t('A barra arquivada será excluída. Seus widgets e plugins continuam disponíveis.')} confirm={confirm.run} label="Excluir barra" close={() => { setConfirm(null); requestAnimationFrame(() => setLibrary(true)) }} />}
  </>
}
