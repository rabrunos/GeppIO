import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import type { Transaction } from '../freeform/useTransaction.ts'
import { availablePresentations } from '../../../shared/workbench/presentations.ts'
import type { WidgetPresentation } from '../../../shared/workbench/presentations.ts'
import type { WidgetType } from '../../../shared/workbench/model.ts'
import type { Region } from '../../../shared/freeform/types.ts'
import { Popover } from './Primitives.tsx'
import { useLocale } from './Locale.tsx'

const LABELS = { normal: 'Normal', docked: 'Encaixado', overlay: 'Flutuante' }
/** The host declaration and transaction both gate the available modes. */
export function PresentationControls({ state, tx, definition, region, hold }: {
  state: WidgetPresentation; tx: Transaction; definition: WidgetType; region: Region; hold(open: boolean): void
}) {
  const { t } = useLocale(), [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null)
  const modes = availablePresentations(definition, region)
  useEffect(() => { hold(open); return () => hold(false) }, [open])
  if (!tx.editing || modes.length <= 1) return null
  return <><button type="button" ref={anchor} className="ui-button widget-presentation-control" aria-label={t('Apresentação de Propriedades')} aria-description={t(LABELS[state.presentation])} aria-haspopup="menu" aria-expanded={open} disabled={tx.saving || tx.recovery} onClick={() => setOpen(!open)}><span>{t(LABELS[state.presentation])}</span><ChevronDownIcon className="icon" /></button>
    <Popover title="Apresentação de Propriedades" bare className="workspace-popover workspace-project-menu presentation-menu" open={open} close={() => setOpen(false)} anchor={anchor}>
      {modes.map(mode => <button key={mode} className="ui-button workspace-command" role="menuitemradio" aria-checked={state.presentation === mode} onClick={() => { void tx.present({ presentation: mode }); setOpen(false) }}><CheckIcon className="icon" style={{ visibility: state.presentation === mode ? 'visible' : 'hidden' }} /><span>{t(LABELS[mode])}</span></button>)}
    </Popover></>
}
