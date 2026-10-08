import { Bars3Icon, ChevronRightIcon, Squares2X2Icon } from '@heroicons/react/24/outline'
import { GRID_IDS } from '../../../shared/grid/policy.ts'
import { WIDGETS } from '../fixtures.ts'
export function Sidebar({ selected, select }: { selected: string | null; select(id: string): void }) {
  return <aside className="sidebar-region" data-region="sidebar"><div className="region-label"><Bars3Icon className="size-4" />SIDEBAR<span>01 widget</span></div>
    <section className="navigation-fixture"><div className="sidebar-section">SEU ESPAÇO</div><div className="active-nav"><Squares2X2Icon className="size-4" />Laboratório<span>10</span></div><p>Uma coleção de formatos para testar a base antes das integrações.</p><div className="sidebar-section">NA MAIN</div>
      {WIDGETS.filter(w => GRID_IDS.includes(w.id)).map(w => <button className={'widget-nav ' + (selected === w.id ? 'selected' : '')} key={w.id} onClick={() => select(w.id)}><span className="mini-square" /><span>{w.title}<small>{w.type}</small></span><ChevronRightIcon className="size-3" /></button>)}</section>
    <div className="sidebar-footer"><span className="status-dot" />Local, sem conexão com serviços<p>GeppIO · laboratório de workspace.</p></div>
  </aside>
}
