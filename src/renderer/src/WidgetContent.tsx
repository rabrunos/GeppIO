import { ArchiveBoxIcon, CubeIcon, DocumentTextIcon, PhotoIcon } from '@heroicons/react/24/outline'
import { memo } from 'react'

/** All content is synthetic. These components are fixtures, not installed plugins. */
export const WidgetContent = memo(function WidgetContent({ id }: { id: string }) {
  switch (id) {
    case 'summary': return <div className="summary-fixture"><span className="eyebrow">ESPAÇO EM CONSTRUÇÃO</span><strong>Seu próximo<br />ambiente de trabalho.</strong><p>7 widgets de demonstração na Main.</p></div>
    case 'queue': return <div className="table-fixture"><div className="fixture-toolbar"><span>Conteúdo simulado</span><span className="badge">04 itens</span></div><table><thead><tr><th>Experimento</th><th>Tipo</th><th>Estado</th></tr></thead><tbody>{[
      ['Organizar uma composição', 'Layout', 'Explorar'], ['Experimentar o painel', 'Surface', 'Disponível'],
      ['Trocar a aparência', 'Tema', 'Disponível'], ['SDK para terceiros', 'Futuro', 'Fora desta base']
    ].map(([name, type, status]) => <tr key={name}><td>{name}</td><td>{type}</td><td><span className="table-tag">{status}</span></td></tr>)}</tbody></table><p className="fixture-caption">Tabela de referência · não é uma fila real de tarefas.</p></div>
    case 'library': return <div className="library-fixture">{[
      { title: 'Coleções', Icon: ArchiveBoxIcon }, { title: 'Componentes', Icon: CubeIcon },
      { title: 'Referências', Icon: PhotoIcon }, { title: 'Documentos', Icon: DocumentTextIcon }
    ].map(({ title, Icon }) => <div className="library-tile" key={title}><Icon className="size-5" /><span>{title}</span></div>)}</div>
    case 'notes': return <div className="prose-fixture"><span className="eyebrow">NOTAS DE LABORATÓRIO</span><h3>Uma base, antes das ferramentas.</h3><p>O objetivo aqui é experimentar a organização, a densidade e o comportamento dos widgets.</p><blockquote>O layout só muda quando você entra no modo de edição.</blockquote><p>O cabeçalho é fixo. Sidebar, Main e Bottom são regiões irmãs.</p><span className="fixture-caption">Texto fictício para testar leitura e rolagem.</span></div>
    case 'activity': return <div className="activity-fixture">{Array.from({ length: 18 }, (_, index) => <div className="activity-row" key={index}><span className="activity-dot" /><div><strong>{['Composição carregada', 'Referência disponível', 'Nova possibilidade'][index % 3]}</strong><p>Registro de exemplo {String(index + 1).padStart(2, '0')} · atividade simulada.</p></div></div>)}</div>
    case 'properties': return <div className="properties-fixture"><p>Controles de demonstração. Não executam operações externas.</p><label>Nome de exemplo<input defaultValue="Meu espaço de trabalho" aria-label="Nome de exemplo" /></label><label>Visualização<select defaultValue="compact"><option value="compact">Compacta</option><option value="comfortable">Confortável</option></select></label><label className="check-fixture"><input type="checkbox" defaultChecked /> Mostrar detalhes de exemplo</label><small>Interagir com um campo não desloca o widget.</small></div>
    case 'chart': return <div className="chart-fixture"><div className="chart-title"><span>Ritmo fictício</span><strong>+24%</strong></div><div className="bars" aria-label="Gráfico com dados fictícios">{[30, 45, 37, 63, 52, 81, 74, 92, 64, 85, 97, 78].map((height, index) => <span key={index} style={{ height: height + '%' }} />)}</div><span className="fixture-caption">Não representa memória, CPU nem métricas reais.</span></div>
    default: return <p>Widget de teste</p>
  }
})
