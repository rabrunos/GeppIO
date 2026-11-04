import type { Transaction } from '../freeform/useTransaction.ts'
import type { Presentation, WidgetPresentation } from '../../../shared/workbench/presentations.ts'
import { useLocale } from './Locale.tsx'

/** Mouse controls operate the real host view, never a second content tree. */
export function PresentationControls({ state, tx, active, adapted, shown }: { state: WidgetPresentation; tx: Transaction; active: boolean; adapted: boolean; shown: boolean }) {
  const { t } = useLocale()
  return <div className="widget-presentations" data-testid="presentation-controls">
    <span>{t('Propriedades')}</span>
    <select aria-label={t('Apresentação de Propriedades')} value={state.presentation} disabled={!active || tx.saving || tx.recovery} onChange={event => { void tx.present({ presentation: event.target.value as Presentation }) }}>
      <option value="normal">Normal</option><option value="docked">Docked</option><option value="overlay">Overlay</option>
    </select>
    <button className="ui-button tool-button" disabled={!active || tx.saving || tx.recovery} aria-expanded={shown} aria-controls="properties-presentation" aria-description={active && state.open && !shown ? t('Temporariamente recolhido; a preferência de abrir foi preservada.') : undefined} onClick={() => { void tx.present({ open: !state.open }) }}>{t(state.open ? 'Recolher painel' : 'Abrir painel')}</button>
    {state.presentation !== 'normal' && <label className="presentation-size">{t('Altura')}<select aria-label={t('Altura preferida do painel')} value={state.preferred.height} disabled={!active || tx.saving || tx.recovery} onChange={event => { void tx.present({ preferred: { ...state.preferred, height: Number(event.target.value) } }) }}>
      {[...new Set([220, 260, 340, 420, state.preferred.height])].sort((a, b) => a - b).map(height => <option key={height} value={height}>{height}px</option>)}
    </select></label>}
    {adapted && state.open && <span className="presentation-notice" role="status">{t('Espaço limitado: tamanho temporário ou painel recolhido. Amplie a janela para restaurar.')}</span>}
    {!active && <span className="presentation-notice">{t('Disponível quando Propriedades estiver em Main.')}</span>}
  </div>
}
