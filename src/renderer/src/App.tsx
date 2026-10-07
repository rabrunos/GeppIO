import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { motion, MotionConfig } from 'motion/react'
import { AdjustmentsHorizontalIcon, ArrowsPointingOutIcon, Bars3Icon, CheckIcon,
  ChevronRightIcon, CommandLineIcon, CubeTransparentIcon, MoonIcon, PencilSquareIcon,
  Squares2X2Icon, SunIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { canPlace, decodeLayout, moveRect, resizeRect, snapMove } from '../../shared/layout.ts'
import type { Guide, LayoutSnapshot, Placement, Theme } from '../../shared/layout.ts'
import { readLayout, writeLayout } from '../../shared/storage.ts'
import { IDENTITY } from '../../shared/identity.ts'
import { DEFAULT_LAYOUT, MINIMUMS, WIDGETS } from './fixtures.ts'
import { WidgetContent } from './WidgetContent.tsx'
import { usePlugins, PluginSettings, PluginWidgets } from './Plugins.tsx'

type Anchor = 'bottom' | 'top' | 'left' | 'right' | 'floating'
type Presentation = 'overlay' | 'docked'
interface Drag { id: string; pointerId: number; kind: 'move' | 'resize'; x: number; y: number; width: number; height: number; original: Placement }
function restore() {
  try { return readLayout(window.localStorage, IDENTITY.layoutStorageKey, DEFAULT_LAYOUT, MINIMUMS) }
  catch { return { snapshot: structuredClone(DEFAULT_LAYOUT), error: 'Armazenamento local indisponível. As alterações ficarão somente nesta sessão.' } }
}
export function App() {
  const plugins = usePlugins()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [initial] = useState(restore)
  const committed = useRef<LayoutSnapshot>(initial.snapshot)
  const [placements, setPlacements] = useState(initial.snapshot.placements)
  const livePlacements = useRef(placements)
  const [theme, setTheme] = useState<Theme>(initial.snapshot.theme)
  const [editing, setEditing] = useState(false)
  const [snap, setSnap] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [message, setMessage] = useState(initial.error ?? 'Modo de uso · o layout está protegido contra alterações acidentais.')
  const [panelOpen, setPanelOpen] = useState(false)
  const [presentation, setPresentation] = useState<Presentation>('overlay')
  const [anchor, setAnchor] = useState<Anchor>('bottom')
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  function putPlacements(next: Placement[]) { livePlacements.current = next; setPlacements(next) }
  function replace(rect: Placement) { putPlacements(livePlacements.current.map(p => p.id === rect.id ? rect : p)) }
  function persist(snapshot: LayoutSnapshot) {
    try { return writeLayout(window.localStorage, IDENTITY.layoutStorageKey, snapshot) }
    catch { return 'Não foi possível salvar o layout. As alterações permanecem apenas nesta sessão.' }
  }
  function beginEdit() { setEditing(true); setMessage('Arraste pelo título. Redimensione pelo canto. Alt suspende o snap durante o movimento.') }
  function cancelEdit() {
    drag.current = null; setDragging(null); setGuides([])
    putPlacements(structuredClone(committed.current.placements)); setEditing(false)
    setMessage('Edição cancelada. A composição anterior foi mantida.')
  }
  function saveEdit() {
    if (!livePlacements.current.every(p => canPlace(p, livePlacements.current))) { setMessage('Resolva a sobreposição antes de salvar.'); return }
    const snapshot: LayoutSnapshot = { schemaVersion: 1, theme, placements: structuredClone(livePlacements.current) }
    committed.current = snapshot; setEditing(false); setGuides([]); setSelected(null)
    setMessage(persist(snapshot) ?? 'Layout salvo neste computador. Você voltou ao modo de uso.')
  }
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next); committed.current = { ...committed.current, theme: next }
    const failure = persist(committed.current); if (failure) setMessage(failure)
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, placement: Placement, kind: Drag['kind']) {
    if (!editing || event.button !== 0 || !canvas.current) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const bounds = canvas.current.getBoundingClientRect()
    drag.current = { id: placement.id, pointerId: event.pointerId, kind, x: event.clientX, y: event.clientY,
      width: bounds.width, height: bounds.height, original: { ...placement } }
    setSelected(placement.id); setDragging(placement.id)
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = (event.clientX - active.x) / active.width, dy = (event.clientY - active.y) / active.height
    const raw = active.kind === 'move' ? moveRect(active.original, dx, dy)
      : resizeRect(active.original, dx, dy, MINIMUMS[active.id] ?? { width: .17, height: .18 })
    const snapped = active.kind === 'move' && snap && !event.altKey
      ? snapMove(raw, livePlacements.current.filter(p => p.id !== active.id), { width: 7 / active.width, height: 7 / active.height })
      : { rect: raw, guides: [] }
    setGuides(snapped.guides); replace({ ...snapped.rect, id: active.id })
  }
  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const candidate = livePlacements.current.find(p => p.id === active.id)
    if (cancel || !candidate || !canPlace(candidate, livePlacements.current)) {
      replace(active.original); setMessage(cancel ? 'Movimento cancelado.' : 'Esse espaço está ocupado. O widget voltou à posição anterior.')
    }
    drag.current = null; setDragging(null); setGuides([])
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function keyMove(event: KeyboardEvent<HTMLButtonElement>, placement: Placement) {
    if (!editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); const step = event.shiftKey ? .02 : .005
    const candidate = { ...moveRect(placement, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), id: placement.id }
    if (canPlace(candidate, livePlacements.current)) replace(candidate)
  }
  function restoreDefault() {
    if (!editing) return
    putPlacements(structuredClone(DEFAULT_LAYOUT.placements)); setGuides([])
    setMessage('Composição inicial em prévia. Salve para aplicar ou cancele para manter a anterior.')
  }
  function importLayout(file: File | undefined) {
    if (!file) return
    if (file.size > 64 * 1024) { setMessage('O layout deve ter até 64 KiB.'); return }
    void file.text().then(text => {
      const next = decodeLayout(text, DEFAULT_LAYOUT.placements.map(p => p.id), MINIMUMS)
      putPlacements(next.placements); setEditing(true)
      setMessage('Layout importado como prévia, sem alterar o tema. Salve ou cancele para decidir.')
    }).catch(() => setMessage('Arquivo de layout inválido ou incompatível. Sua composição foi preservada.'))
  }
  const selection = placements.find(p => p.id === selected)
  const actualAnchor = presentation === 'docked' && anchor === 'floating' ? 'bottom' : anchor
  const docked = panelOpen && presentation === 'docked'
  const panel = <motion.section className={'test-panel ' + (docked ? 'docked' : 'overlay') + ' edge-' + actualAnchor}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .15 }} data-testid="test-panel" aria-label="Painel de teste">
    <header><span><CommandLineIcon className="size-4" /> Painel de teste <small>conteúdo simulado</small></span><button className="icon-button" onClick={() => setPanelOpen(false)} aria-label="Recolher painel"><XMarkIcon className="size-4" /></button></header>
    <div className="panel-lines"><p><span>01</span> Nenhum terminal ou processo está sendo executado.</p><p><span>02</span> Experimente Docked, Overlay e as quatro bordas.</p><p><span>03</span> O botão na barra inferior reabre este painel.</p></div>
  </motion.section>

  return <MotionConfig reducedMotion="user"><div className="workbench" data-theme={theme} onKeyDown={event => {
    if (settingsOpen) return
    if (event.key === 'Escape') { if (editing) cancelEdit(); else if (panelOpen) setPanelOpen(false) }
  }}>
    <header className="workbench-header">
      <div className="brand"><span className="brand-icon"><CubeTransparentIcon className="size-6" /></span><div><strong>{IDENTITY.name}</strong><small>LABORATÓRIO DE WORKSPACE</small></div></div>
      <div className="project-context"><span>Projeto local</span><ChevronRightIcon className="size-3" /><strong>Laboratório</strong><span className="badge">plugins locais</span></div>
      <div className="header-actions"><span className="version">{window.semnome?.version ?? __APP_VERSION__}</span><button className="icon-button" onClick={toggleTheme} aria-label="Alternar tema">{theme === 'dark' ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}</button>
        <button className="button" onClick={() => setSettingsOpen(true)} aria-label="Abrir configurações"><AdjustmentsHorizontalIcon className="size-4" />Configurações</button>
        {!editing ? <button className="button primary" onClick={beginEdit} data-testid="edit-layout"><PencilSquareIcon className="size-4" />Editar layout</button> : <><button className="button" onClick={cancelEdit} data-testid="cancel-layout">Cancelar</button><button className="button primary" onClick={saveEdit} data-testid="save-layout"><CheckIcon className="size-4" />Salvar layout</button></>}
      </div>
    </header>
    <div className="work-area">
      <aside className="sidebar-region" data-region="sidebar"><div className="region-label"><Bars3Icon className="size-4" />SIDEBAR <span>01 widget</span></div>
        <section className="navigation-fixture"><div className="sidebar-section">SEU ESPAÇO</div><div className="active-nav"><Squares2X2Icon className="size-4" />Laboratório <span>10</span></div><p>Uma coleção de formatos para testar a base antes das integrações.</p><div className="sidebar-section">NA MAIN</div>{WIDGETS.filter(w => DEFAULT_LAYOUT.placements.some(p => p.id === w.id)).map(w => <button className={'widget-nav ' + (selected === w.id ? 'selected' : '')} key={w.id} onClick={() => setSelected(w.id)}><span className="mini-square" /><span>{w.title}<small>{w.type}</small></span><ChevronRightIcon className="size-3" /></button>)}</section>
        <div className="sidebar-footer"><span className="status-dot" />Local, sem conexão com serviços<p>Identidade e cabeçalho provisórios.</p></div>
      </aside>
      <main className="main-region" data-region="main"><div className="workspace-toolbar"><div><span className="eyebrow">MAIN WORKSPACE</span><h1>{editing ? 'Organize do seu jeito.' : 'Tudo no seu lugar.'}</h1></div><div className="toolbar-actions">{editing ? <><label className="toggle-label"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Guias e snap</label><button className="button subtle" onClick={restoreDefault}>Composição inicial</button></> : <span className="mode-badge"><span className="status-dot" />Modo de uso</span>}</div></div>
        <div className="presentation-options"><AdjustmentsHorizontalIcon className="size-4" /><span>Painel de teste</span><select aria-label="Apresentação do painel" value={presentation} disabled={editing} onChange={e => setPresentation(e.target.value as Presentation)}><option value="overlay">Overlay</option><option value="docked">Docked</option></select><select aria-label="Borda do painel" value={actualAnchor} disabled={editing} onChange={e => setAnchor(e.target.value as Anchor)}><option value="bottom">Inferior</option><option value="top">Superior</option><option value="left">Esquerda</option><option value="right">Direita</option>{presentation === 'overlay' && <option value="floating">Flutuante</option>}</select><button className="button subtle" disabled={editing} onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? 'Recolher' : 'Abrir painel'}</button><label className="import-layout">Importar layout<input type="file" accept=".json,application/json" disabled={editing} onChange={e => { importLayout(e.target.files?.[0]); e.target.value = '' }} /></label></div>
        <div className={'work-surface ' + (docked ? 'with-dock edge-' + actualAnchor : '')}>
          {docked && ['top', 'left'].includes(actualAnchor) && panel}
          <div className="canvas-viewport"><PluginWidgets plugins={plugins} /><div className={'layout-canvas ' + (editing ? 'editing' : '')} ref={canvas} data-testid="layout-canvas">
            {placements.map(placement => {
              const definition = WIDGETS.find(w => w.id === placement.id)
              const invalid = !canPlace(placement, placements)
              return <motion.section key={placement.id} layout={!dragging} transition={{ layout: { duration: .16 } }}
                className={'widget-frame ' + (selected === placement.id ? 'selected ' : '') + (invalid ? 'invalid' : '')}
                data-widget={placement.id} style={{ left: placement.x * 100 + '%', top: placement.y * 100 + '%', width: placement.width * 100 + '%', height: placement.height * 100 + '%' }}>
                <header className="widget-heading"><button className="widget-grip" aria-label={'Mover ' + (definition?.title ?? placement.id)} tabIndex={editing ? 0 : -1} onPointerDown={e => startDrag(e, placement, 'move')} onPointerMove={moveDrag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, true)} onKeyDown={e => keyMove(e, placement)}><span className="grip-dots">⠿</span><strong>{definition?.title}</strong></button><span className="widget-kind">{definition?.type}</span></header>
                <div className="widget-content"><WidgetContent id={placement.id} /></div>
                {editing && <button className="resize-handle" aria-label={'Redimensionar ' + (definition?.title ?? placement.id)} onPointerDown={e => startDrag(e, placement, 'resize')} onPointerMove={moveDrag} onPointerUp={e => finishDrag(e)} onPointerCancel={e => finishDrag(e, true)}><ArrowsPointingOutIcon className="size-3" /></button>}
              </motion.section>
            })}
            {editing && guides.map((guide, index) => <div key={index} className={'smart-guide ' + guide.axis} style={guide.axis === 'x' ? { left: guide.value * 100 + '%' } : { top: guide.value * 100 + '%' }} />)}
          </div></div>
          {docked && ['bottom', 'right'].includes(actualAnchor) && panel}
          {panelOpen && !docked && panel}
        </div>
        <div className="workspace-feedback" role="status">{message}{editing && selection && <span>{selection.id} · x {(selection.x * 100).toFixed(2)}% · y {(selection.y * 100).toFixed(2)}% · {(selection.width * 100).toFixed(2)} × {(selection.height * 100).toFixed(2)}%</span>}</div>
      </main>
      <footer className="bottom-region" data-region="bottom"><span className="region-label">BOTTOM</span><button className={'bottom-action ' + (panelOpen ? 'active' : '')} onClick={() => setPanelOpen(!panelOpen)} disabled={editing} aria-label="Abrir ou recolher painel de teste"><CommandLineIcon className="size-4" />Painel de teste</button><div className="bottom-spacer" /><span>10 widgets de demonstração</span><span className="bottom-separator" /><span>{plugins.inventory.plugins.length} plugins locais</span><span className="status-dot" /></footer>
    </div>
    {settingsOpen && <PluginSettings plugins={plugins} close={() => setSettingsOpen(false)} />}
  </div></MotionConfig>
}
