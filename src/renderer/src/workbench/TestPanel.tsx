import { CommandLineIcon, XMarkIcon } from '@heroicons/react/24/outline'
export type Anchor = 'bottom' | 'top' | 'left' | 'right' | 'floating'
export type Presentation = 'overlay' | 'docked'
export interface PanelState { open: boolean; anchor: Anchor; presentation: Presentation }
export function TestPanel({ state, close }: { state: PanelState; close(): void }) {
  if (!state.open) return null
  return <section className={'test-panel ' + state.presentation + ' edge-' + state.anchor} data-testid="test-panel" aria-label="Painel de teste">
    <header><span><CommandLineIcon className="size-4" />Painel de teste <small>conteúdo simulado</small></span><button className="icon-button" onClick={close} aria-label="Recolher painel"><XMarkIcon className="size-4" /></button></header>
    <div className="panel-lines"><p>Nenhum terminal ou processo está sendo executado.</p><p>Experimente Docked, Overlay e as quatro bordas.</p><p>O botão na barra inferior reabre este painel.</p></div>
  </section>
}
