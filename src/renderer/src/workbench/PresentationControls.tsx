import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import type { Transaction } from '../freeform/useTransaction.ts'
import { availablePresentations, EDGES } from '../../../shared/workbench/presentations.ts'
import type { Edge, Presentation, WidgetPresentation } from '../../../shared/workbench/presentations.ts'
import type { WidgetType } from '../../../shared/workbench/model.ts'
import type { Region, Size } from '../../../shared/freeform/types.ts'
import { Popover } from './Primitives.tsx'
import { useLocale } from './Locale.tsx'

const LABELS = { normal: 'Normal', docked: 'Encaixado', overlay: 'Flutuante' }
const ANCHORS = { top: 'Topo', bottom: 'Embaixo', left: 'Esquerda', right: 'Direita' }
/** Mode plus anchor is one intention; the transaction rechecks capability and occupancy. */
export function PresentationControls({ state, tx, definition, region, hold, bounds }: {
  state: WidgetPresentation; tx: Transaction; definition: WidgetType; region: Region; hold(open: boolean): void;
  bounds: { size: Size; expanded: boolean; scrollbar: number }
}) {
  const { t } = useLocale(), [open, setOpen] = useState(false), [choice, setChoice] = useState<Presentation | null>(null), anchor = useRef<HTMLButtonElement>(null)
  const modes = availablePresentations(definition, region), label = t('Apresentação de {0}', t(definition.title))
  useEffect(() => { hold(open); return () => hold(false) }, [open])
  if (!tx.editing || modes.length <= 1) return null
  const occupied = (edge: Edge) => tx.snapshot.organization.presentations?.entries.some(entry => entry.viewId !== state.viewId && entry.presentation !== 'normal' && entry.anchor === edge
    && tx.snapshot.placements.some(p => p.id === entry.viewId && p.region === 'main'))
  async function apply(mode: Presentation, edge?: Edge | null) {
    const ok = await tx.present({ presentation: mode, ...(mode !== 'normal' ? { anchor: edge! } : {}) }, state.viewId, bounds)
    if (ok) { setOpen(false); setChoice(null) }
  }
  return <><button type="button" ref={anchor} className="ui-button widget-presentation-control" aria-label={label} title={label + ': ' + t(LABELS[state.presentation]) + (state.anchor ? ' · ' + t(ANCHORS[state.anchor]) : '')} aria-description={t(LABELS[state.presentation])} aria-haspopup="menu" aria-expanded={open} disabled={tx.saving || tx.recovery} onClick={() => { setChoice(null); setOpen(!open) }}><span>{t(LABELS[state.presentation])}</span><ChevronDownIcon className="icon" /></button>
    <Popover title={label} bare className="workspace-popover workspace-project-menu presentation-menu" open={open} close={() => { setOpen(false); setChoice(null) }} anchor={anchor}>
      {!choice ? modes.map(mode => <button key={mode} className="ui-button workspace-command" role="menuitemradio" aria-checked={state.presentation === mode} onClick={() => { if (mode === 'normal') void apply(mode); else setChoice(mode) }}><CheckIcon className="icon" style={{ visibility: state.presentation === mode ? 'visible' : 'hidden' }} /><span>{t(LABELS[mode])}</span></button>) : <>
        <button className="ui-button workspace-command" role="menuitem" onClick={() => setChoice(null)}>‹ {t(LABELS[choice])}</button>
        {[...EDGES, ...(choice === 'overlay' ? [null] : [])].map(edge => {
          const busy = edge && occupied(edge), selected = state.presentation === choice && state.anchor === edge
          return <button key={edge ?? 'free'} className="ui-button workspace-command" role="menuitemradio" aria-checked={selected} disabled={!!busy} onClick={() => void apply(choice, edge)}><CheckIcon className="icon" style={{ visibility: selected ? 'visible' : 'hidden' }} /><span>{t(edge ? ANCHORS[edge] : 'Sem âncora')}{busy ? ' · ' + t('Ocupado') : ''}</span></button>
        })}</>}
    </Popover></>
}
