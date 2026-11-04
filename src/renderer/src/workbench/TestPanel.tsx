import { CommandLineIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { useLocale } from './Locale.tsx'
export type Anchor = 'bottom' | 'top' | 'left' | 'right' | 'floating'
export type Presentation = 'overlay' | 'docked'
export interface PanelState { open: boolean; anchor: Anchor; presentation: Presentation }
/** Historical grid demonstrator; the active host uses PresentationControls. */
export function TestPanel({ state, close }: { state: PanelState; close(): void }) {
  const { t } = useLocale()
  if (!state.open) return null
  return <section className={'test-panel ' + state.presentation + ' edge-' + state.anchor} data-testid="test-panel" aria-label={t('Painel de teste')}>
    <header><span><CommandLineIcon className="size-4" />{t('Painel de teste')} <small>{t('conteúdo simulado')}</small></span><button className="ui-button ui-icon-button" onClick={close} aria-label={t('Recolher painel')}><XMarkIcon className="size-4" /></button></header>
    <div className="panel-lines"><p>{t('Nenhum terminal ou processo está sendo executado.')}</p><p>{t('Experimente Docked, Overlay e as quatro bordas.')}</p></div>
  </section>
}
