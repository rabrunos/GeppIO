import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ArrowDownTrayIcon, ClipboardDocumentIcon, InformationCircleIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import type { WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import { activePlacements } from '../../../shared/workbench/model.ts'
import { Dialog, Popover } from './Primitives.tsx'
import { useLocale } from './Locale.tsx'

const NAME_KEY = 'geppio:project-name:v1'
export function useProjectName() {
  const [name, setName] = useState<string | null>(() => { try { const value = localStorage.getItem(NAME_KEY); return value?.trim() && value.length <= 60 ? value : null } catch { return null } })
  return { name, rename(value: string) { const next = value.trim(); if (!next || next.length > 60) return false; try { localStorage.setItem(NAME_KEY, next); setName(next); return true } catch { return false } } }
}
/** Project display metadata and the existing layout document only. This menu
 * does not imply filesystem, Git, account or project execution capabilities. */
export function ProjectMenu({ open, close, anchor, name, rename, snapshot, feedback }: { open: boolean; close(): void; anchor: RefObject<HTMLElement | null>; name: string; rename(value: string): boolean; snapshot: WorkbenchSnapshot; feedback(value: string): void }) {
  const { t } = useLocale(), [dialog, setDialog] = useState<'rename' | 'info' | null>(null), [draft, setDraft] = useState(name), [error, setError] = useState(''), field = useRef<HTMLInputElement>(null)
  useEffect(() => { if (dialog === 'rename') { setDraft(name); setError(''); field.current?.focus(); field.current?.select() } }, [dialog])
  function exportLayout() {
    // The existing native host denies downloads. The design's browser fixture
    // does not authorize adding filesystem powers to this bounded integration.
    close(); feedback(t('Ação de demonstração. Nenhum arquivo foi exportado.'))
  }
  return <><Popover title="Mais opções do projeto" bare className="workspace-popover workspace-project-menu" open={open} close={close} anchor={anchor}><div className="workspace-project-heading" role="presentation"><strong>{name}</strong><span>{t('Projeto atual')}</span></div><button className="ui-button workspace-command" role="menuitem" onClick={() => { close(); setDialog('rename') }}><PencilSquareIcon className="icon" /><span>{t('Renomear projeto…')}</span></button><button className="ui-button workspace-command" role="menuitem" onClick={() => { close(); feedback(t('Ação de demonstração. Nenhum caminho de projeto está conectado.')) }}><ClipboardDocumentIcon className="icon" /><span>{t('Copiar caminho')}</span></button><button className="ui-button workspace-command" role="menuitem" onClick={() => { close(); setDialog('info') }}><InformationCircleIcon className="icon" /><span>{t('Informações do projeto')}</span></button><button className="ui-button workspace-command" role="menuitem" onClick={exportLayout}><ArrowDownTrayIcon className="icon" /><span>{t('Exportar configuração…')}</span></button></Popover>
    {dialog === 'rename' && <Dialog title="Renomear projeto" close={() => setDialog(null)}><p className="profile-dialog-description">{t('Escolha o nome exibido neste espaço de trabalho.')}</p><form onSubmit={event => { event.preventDefault(); if (rename(draft)) setDialog(null); else setError(t('Não foi possível salvar o nome. Tente novamente.')) }}><label className="project-field">{t('Nome do projeto')}<input ref={field} className="ui-input" maxLength={60} required autoComplete="off" value={draft} onChange={event => setDraft(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="workspace-dialog-actions"><button type="button" className="ui-button workspace-secondary" onClick={() => setDialog(null)}>{t('Cancelar')}</button><button className="ui-button workspace-primary">{t('Salvar nome')}</button></div></form></Dialog>}
    {dialog === 'info' && <Dialog title="Informações do projeto" close={() => setDialog(null)}><p className="profile-dialog-description">{t('Uma visão geral do seu espaço de trabalho.')}</p><dl className="project-details">{[['Nome', name], ['Caminho', '—'], ['Organização', t('Área principal, lateral e inferior')], ['Widgets visíveis', t('{0} widgets', activePlacements(snapshot).length)]].map(([key, value]) => <div key={key}><dt>{t(key!)}</dt><dd>{value}</dd></div>)}</dl></Dialog>}
  </>
}
