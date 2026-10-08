import { useEffect, useRef } from 'react'
import { PluginSettings } from '../Plugins.tsx'
import type { usePlugins } from '../Plugins.tsx'
import type { LayoutTransaction } from '../grid/useLayoutTransaction.ts'
import type { PanelState, Anchor, Presentation } from '../workbench/TestPanel.tsx'
export function Settings({ plugins, close, tx, centered, setCentered, panel, setPanel }: {
  plugins: ReturnType<typeof usePlugins>; close(): void; tx: LayoutTransaction; centered: boolean; setCentered(value: boolean): void;
  panel: PanelState; setPanel(value: PanelState): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} className="plugin-settings" data-testid="plugin-settings" onCancel={close} aria-labelledby="settings-title">
    <header><h2 id="settings-title">Configurações</h2><button className="button" onClick={close} aria-label="Fechar configurações">Fechar</button></header>
    <section className="development-settings" aria-label="Desenvolvimento"><h3>Desenvolvimento</h3>
      <label className="toggle-label"><input type="checkbox" checked={centered} onChange={e => setCentered(e.target.checked)} />Centralizar grade (depuração)</label>
      <p>Alinhamento somente nesta sessão. Não altera posições, tamanhos ou o layout salvo.</p>
      <button className="button" onClick={() => { tx.resetPreview(); close() }}>Prévia da composição inicial</button>
      <label className="import-layout">Importar layout<input type="file" accept=".json,application/json" disabled={tx.editing} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void tx.importFile(file); close() }} /></label>
      <div className="presentation-options"><span>Painel de teste</span><select aria-label="Apresentação do painel" value={panel.presentation} disabled={tx.editing} onChange={e => {
        const presentation = e.target.value as Presentation; setPanel({ ...panel, presentation, anchor: presentation === 'docked' && panel.anchor === 'floating' ? 'bottom' : panel.anchor })
      }}><option value="overlay">Overlay</option><option value="docked">Docked</option></select>
        <select aria-label="Borda do painel" value={panel.anchor} disabled={tx.editing} onChange={e => setPanel({ ...panel, anchor: e.target.value as Anchor })}><option value="bottom">Inferior</option><option value="top">Superior</option><option value="left">Esquerda</option><option value="right">Direita</option>{panel.presentation === 'overlay' && <option value="floating">Flutuante</option>}</select>
        <button className="button subtle" disabled={tx.editing} onClick={() => { setPanel({ ...panel, open: !panel.open }); close() }}>{panel.open ? 'Recolher' : 'Abrir painel'}</button>
      </div>
    </section><PluginSettings plugins={plugins} />
  </dialog>
}
