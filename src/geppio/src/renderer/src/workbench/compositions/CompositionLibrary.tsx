import { useEffect, useRef, useState } from 'react'
import { MagnifyingGlassIcon, StarIcon, PlusIcon, EllipsisHorizontalIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { useScrollState } from '@geppio/ui'
import type { Region } from '@geppio/runtime/layout/types'
import { LIMITS } from '../../../../shared/workbench/model.ts'
import type { Composition, Registry, WorkbenchSnapshot } from '../../../../shared/workbench/model.ts'
import { applyComposition, captureCurrentComposition, compositionChrome, compositionScene, compositionOrder, compositionSlots, favoriteComposition, reorderComposition, systemCompositions } from '../../../../shared/workbench/compositions.ts'
import type { Transaction } from '../../freeform/useTransaction.ts'
import { Confirm, Dialog, IconButton, Popover } from '../Primitives.tsx'
import { normalizeSearch, useLocale } from '../Locale.tsx'
import { CompositionThumbnail } from './CompositionThumbnail.tsx'
import { WorkbenchIcon } from '../WorkbenchIcon.tsx'
import { useCompositionReorder } from './useCompositionReorder.ts'
import { availableComposition } from '../../../../shared/workbench/retirement.ts'
import { usePortableCompositions } from './usePortableCompositions.tsx'
import type { PortableEnvironment } from './usePortableCompositions.tsx'

export function CompositionLibrary({ tx, registry, view, hidden, environment }: { tx: Transaction; registry: Registry; view: WorkbenchSnapshot; hidden: boolean; environment: PortableEnvironment }) {
  const { t } = useLocale(), [tab, setTab] = useState('favorites'), [search, setSearch] = useState(''), [form, setForm] = useState(false), [name, setName] = useState('')
  const [scopes, setScopes] = useState<Region[]>(['main', 'bottom']), [sideWidth, setSideWidth] = useState(true)
  const [options, setOptions] = useState<Composition | null>(null), grid = useRef<HTMLDivElement>(null), [optionsPoint, setOptionsPoint] = useState({ x: 0, y: 0 })
  const [confirm, setConfirm] = useState<{ title: string; text: string; label?: string; destructive?: boolean; run(): void } | null>(null), [replace, setReplace] = useState<{ id: string; makeDefault: boolean; selected: string | null } | null>(null)
  const organization = tx.snapshot.organization, all = [...systemCompositions(window.geppio?.demoFixtures), ...organization.compositions.map(item => availableComposition(item, registry))], scroll = useRef<HTMLDivElement>(null)
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
  const portable = usePortableCompositions({ tx, registry, view, hidden, ...environment,
    applied(item) { applyLocal(item, 'widgets') }, imported() { setTab('saved'); setSearch('') }
  })
  function apply(item: Composition, requested: 'format' | 'widgets') {
    if (item.portable) {
      if (!tx.canImportComposition() || environment.gesture() || environment.managing()) return
      if (requested === 'widgets') { portable.widgets(item); return }
    }
    applyLocal(item, requested)
  }
  function applyLocal(item: Composition, requested: 'format' | 'widgets') {
    const scene = compositionScene(tx.live.current, view, item.scopes)
    const remainingSource = tx.formatSource?.placements.filter(p => !item.scopes.includes(p.region)) ?? []
    const retainedSource = remainingSource.length ? { placements: remainingSource, reference: structuredClone(tx.formatSource!.reference) } : null
    if (requested === 'format' && tx.formatMode === 'format' && tx.formatId === item.id && view.placements.some(p => item.scopes.includes(p.region))) {
      if (view.organization.groups?.entries.some(group => view.placements.some(p => p.id === group.frameId && item.scopes.includes(p.region)))) { tx.setMessage(t('Separe as abas antes de converter grupos em espaços reservados.')); return }
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
    <div ref={scroll} className="layout-menu-content ui-scrollbar" data-composition-scroll><div id={tab === 'saved' ? 'layout-saved-panel' : 'layout-favorites-panel'} className="layout-menu-panel"><div ref={grid} className="layout-presets" data-reorder-compositions>{list.map(item => { const reason = portable.reason(item); return <article key={item.id} className="composition-tile" data-composition-id={item.id} data-composition-card={item.id} data-editing-composition={tx.formatId === item.id ? '' : undefined}><button className="ui-button layout-preset" data-current-preset={item.system && tx.formatId === item.id ? '' : undefined} aria-label={t('Aplicar formato de {0}', displayName(item))} data-composition-reorder disabled={tx.saving} onClick={() => apply(item, 'format')} onKeyDown={event => { if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(/\s+/).length : 1; reorder(item, event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns) } }}>
      <CompositionThumbnail composition={item} /><span className="composition-name">{displayName(item)}</span></button><div className="composition-restore-actions"><button className="ui-button composition-restore-button" aria-label={t('Aplicar formato de {0}', displayName(item))} onClick={() => apply(item, 'format')}>{t('Formato')}</button>{item.mode === 'format-widgets' && <button className="ui-button composition-restore-button" aria-label={t('Restaurar widgets de {0}', displayName(item))} disabled={!!reason} title={reason} onClick={() => apply(item, 'widgets')}>{t('Widgets')}</button>}</div>
      {reason && <small className="portable-widget-reason">{reason}</small>}
      <div className="composition-markers"><IconButton label={t(organization.defaultComposition === item.id ? 'Remover {0} como padrão' : 'Tornar {0} padrão', displayName(item))} className="composition-control" data-composition-action="default" onClick={() => favorite(item.id, true)} aria-pressed={organization.defaultComposition === item.id}><WorkbenchIcon name="pin" /></IconButton><IconButton label={t(organization.favorites.includes(item.id) ? 'Remover {0} dos favoritos' : 'Adicionar {0} aos favoritos', displayName(item))} className="composition-control" data-composition-action="favorite" aria-pressed={organization.favorites.includes(item.id)} onClick={() => toggleFavorite(item)}><StarIcon className="icon" /></IconButton></div><IconButton label={t('Opções de {0}', displayName(item))} className="composition-control composition-options" aria-expanded={options?.id === item.id} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); setOptionsPoint({ x: box.right - 220, y: box.bottom + 5 }); setOptions(options?.id === item.id ? null : item) }}><EllipsisHorizontalIcon className="icon" /></IconButton></article> })}</div>{!list.length && <p className="saved-layouts-empty">{t(search ? 'Nenhuma composição encontrada.' : 'Adicione composições aos favoritos pela aba Composições Salvas.')}</p>}</div></div>
      {portable.hasTemplates && <button type="button" className="ui-button workspace-text-action composition-store" disabled={!tx.canImportComposition() || portable.working || environment.managing()} onClick={portable.showTemplates}>Modelos de plugins</button>}
      <button type="button" className="ui-button workspace-text-action composition-store" disabled={!tx.canImportComposition() || portable.working || organization.compositions.length >= LIMITS.compositions} onClick={() => { void portable.selectImport() }}>Importar composição…</button>{tx.hasPending() && <p className="layout-save-pending" role="status">{t('Há alterações pendentes. Salvar atual vai pedir para salvar a edição primeiro.')}</p>}<footer className="layout-menu-footer"><button className="ui-button tool-button" onClick={() => { const item = all.find(item => item.id === organization.defaultComposition) ?? systemCompositions(window.geppio?.demoFixtures)[0]!; apply(item, 'widgets') }}><ArrowPathIcon className="icon" />{t('Restaurar layout padrão')}</button><button className="ui-button tool-button ui-button-primary" disabled={organization.compositions.length >= LIMITS.compositions} onClick={saveCurrent}><PlusIcon className="icon" />{t('Salvar atual')}</button></footer>
    <Popover title="Opções da composição" bare className="workspace-popover ui-context-menu" point={optionsPoint} open={!!options} close={() => setOptions(null)}>{options && <>{!options.system && <button type="button" className="ui-button workspace-command" role="menuitem" disabled={!tx.canImportComposition() || portable.working} onClick={() => { void portable.exportItem(options.id); setOptions(null) }}>Exportar composição…</button>}<button className="ui-button workspace-command" role="menuitem" onClick={() => { favorite(options.id, true); setOptions(null) }}>{t(organization.defaultComposition === options.id ? 'Remover como padrão' : 'Tornar padrão')}</button><button className="ui-button workspace-command" role="menuitem" onClick={() => { toggleFavorite(options); setOptions(null) }}>{t(organization.favorites.includes(options.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos')}</button>{!options.system && <button className="ui-button workspace-command is-destructive" role="menuitem" onClick={() => { const item = options; setOptions(null); setConfirm({ title: t('Excluir {0}?', item.name), text: t('A composição será excluída das salvas e dos favoritos. Os widgets e o espaço de trabalho atual serão preservados.'), label: 'Excluir composição', destructive: true, run() { const next = structuredClone(tx.live.current); next.organization.compositions = next.organization.compositions.filter(record => record.id !== item.id); next.organization.favorites = next.organization.favorites.filter(id => id !== item.id); next.organization.compositionOrder = next.organization.compositionOrder?.filter(id => id !== item.id); if (next.organization.defaultComposition === item.id) next.organization.defaultComposition = null; tx.action(next) } }) }}>{t('Excluir composição')}</button>}</>}</Popover>
    {form && <Dialog title="Salvar nova composição" close={() => setForm(false)}><p className="profile-dialog-description">{t('Guarde o formato e os widgets das áreas selecionadas.')}</p><form className="layout-save-form" onSubmit={event => {
      event.preventDefault()
      void tx.saveComposition(captureCurrentComposition(view, name.trim(), scopes, sideWidth, tx.slots)).then(ok => { if (ok) { setForm(false); setName('') } })
    }}><div className="layout-save-preview"><CompositionThumbnail composition={captureCurrentComposition(view, 'preview', scopes, sideWidth, tx.slots)} /></div><label className="custom-bar-field"><span>{t('Nome')}</span><input data-initial-focus className="ui-input" required maxLength={40} placeholder={t('Ex.: Meu espaço de trabalho')} autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label><fieldset className="layout-save-choices"><legend>{t('Áreas incluídas')}</legend>{(['main', 'bottom'] as const).map(region => <label key={region}><input type="checkbox" checked={scopes.includes(region)} onChange={event => setScopes(event.target.checked ? [...scopes, region] : scopes.filter(value => value !== region))} /><span>{t(region === 'main' ? 'Área principal' : 'Barra inferior')}</span></label>)}<label><input type="checkbox" checked={sideWidth} onChange={event => setSideWidth(event.target.checked)} /><span>{t('Largura da barra lateral')}</span></label></fieldset><p className="custom-bar-hint">{t('Inclua as áreas desejadas, mesmo recolhidas. A lateral salva apenas a largura, sem suas barras ou widgets. Áreas não selecionadas permanecem como estão.')}</p><p role="status">{t(tx.message)}</p><footer className="custom-bar-actions"><button type="button" className="ui-button tool-button" onClick={() => setForm(false)}>{t('Cancelar')}</button><button className="ui-button plugins-button" disabled={tx.saving || (!scopes.length && !sideWidth)}>{t('Salvar composição')}</button></footer></form></Dialog>}
    {replace && <Dialog className="composition-favorite-dialog" title="Favoritos cheios" close={() => setReplace(null)}><p className="profile-dialog-description">{t(replace.makeDefault ? 'Para tornar “{0}” padrão, ela também precisa ser favorita. Você já tem 9 favoritas. Escolha qual substituir.' : 'Você já tem 9 composições favoritas. Escolha qual substituir por “{0}”.', all.find(item => item.id === replace.id)?.name ?? '')}</p><div className="layout-presets composition-replacement-grid" role="group" aria-label={t('Escolha o favorito que será substituído')}>{organization.favorites.map(id => { const item = all.find(item => item.id === id)!; return <div className="composition-tile" key={id}><button className="ui-button layout-preset" aria-pressed={replace.selected === id} aria-label={t('Substituir {0}', item.system ? t(item.name) : item.name)} onClick={() => setReplace({ ...replace, selected: id })}><CompositionThumbnail composition={item} /><strong>{item.system ? t(item.name) : item.name}</strong></button>{organization.defaultComposition === id && <span className="composition-replacement-pin" aria-hidden="true"><WorkbenchIcon name="pin" /></span>}</div> })}</div><p className="custom-bar-hint">{t('A composição substituída continuará em Composições Salvas.')}</p><p className="composition-replacement-warning" role="status" hidden={replace.selected !== organization.defaultComposition}>{t(replace.makeDefault ? 'A composição selecionada deixará de ser favorita. A nova composição será o padrão.' : 'A composição selecionada deixará de ser padrão e favorita.')}</p><div className="workspace-dialog-actions"><button className="ui-button workspace-secondary" onClick={() => setReplace(null)}>{t('Cancelar')}</button><button className="ui-button workspace-primary" disabled={!replace.selected} onClick={() => { favorite(replace.id, replace.makeDefault, replace.selected!); setReplace(null) }}>{t(replace.makeDefault ? 'Substituir e tornar padrão' : replace.selected === organization.defaultComposition ? 'Desmarcar e substituir' : 'Substituir favorito')}</button></div></Dialog>}
    {portable.dialogs}
    {confirm && <Confirm title={confirm.title} text={confirm.text} destructive={confirm.destructive ?? false} label={confirm.label} confirm={confirm.run} close={() => setConfirm(null)} />}
  </section>
}
