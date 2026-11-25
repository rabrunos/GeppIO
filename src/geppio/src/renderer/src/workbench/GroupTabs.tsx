import { detachWidget, reorderGroup } from '../../../shared/workbench/groups.ts'
import type { Registry, WidgetGroup, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import type { Transaction } from '../freeform/useTransaction.ts'
import { useLocale } from './Locale.tsx'
export const tabId = (group: string, member: string) => `${group}:tab:${member}`
export const panelId = (group: string, member: string) => `${group}:panel:${member}`
export function GroupTabs({ group, tx, registry, expanded, view }: { group: WidgetGroup; tx: Transaction; registry: Registry; expanded: boolean; view: WorkbenchSnapshot }) {
  const { t } = useLocale(), index = group.members.indexOf(group.active)
  const title = (id: string) => registry.get(tx.snapshot.organization.views.find(view => view.id === id)!.typeId)!.title
  async function select(id: string, focus = false) {
    const source = tx.live.current, next = { ...source, organization: { ...source.organization, groups: { version: 1 as const, entries: source.organization.groups!.entries.map(item => item.id === group.id ? { ...item, active: id } : item) } } }
    if (await tx.commitOrganization(next) && focus) document.getElementById(tabId(group.id, id))?.focus()
  }
  function reorder(delta: -1 | 1) { const next = reorderGroup(tx.live.current, group.id, group.active, delta); if (next) tx.action(next) }
  function detach() {
    const member = group.active, next = detachWidget(view, registry, member, expanded)
    if (!next) { tx.setMessage(t('Sem espaço para separar. Composição preservada.')); return }
    tx.action(next)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(member)}"] .group-source-handle`)?.focus())
  }
  return <div className="widget-group-tabs"><div role="tablist" aria-label={t('Abas do grupo')} className="widget-group-tablist">{group.members.map((id, i) => <button className="ui-button" id={tabId(group.id, id)} key={id} role="tab" aria-selected={group.active === id} aria-controls={panelId(group.id, id)} tabIndex={group.active === id ? 0 : -1} title={title(id)} onClick={() => { void select(id) }} onKeyDown={event => {
    if (tx.editing && event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); reorder(event.key === 'ArrowLeft' ? -1 : 1); return }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); void select(group.members[event.key === 'Home' ? 0 : event.key === 'End' ? group.members.length - 1 : (i + (event.key === 'ArrowLeft' ? -1 : 1) + group.members.length) % group.members.length]!, true) }
  }}>{title(id)}</button>)}</div>{tx.editing && <div className="widget-group-tools"><button className="ui-button" aria-label={t('Mover aba para a esquerda')} disabled={index === 0} onClick={() => reorder(-1)}>‹</button><button className="ui-button" aria-label={t('Mover aba para a direita')} disabled={index === group.members.length - 1} onClick={() => reorder(1)}>›</button><button className="ui-button" aria-label={t('Separar aba {0}', title(group.active))} title={t('Separar aba {0}', title(group.active))} onClick={detach}>↗</button></div>}</div>
}
