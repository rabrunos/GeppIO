import { useLocale } from './workbench/Locale.tsx';
import { ArchiveBoxIcon, CubeIcon, DocumentTextIcon, PhotoIcon } from '@heroicons/react/24/outline';
import { memo } from 'react';
import { useHostModels } from './workbench/HostModels.tsx';
/** All content is synthetic. These components are fixtures, not installed plugins. */
export const WidgetContent = memo(function WidgetContent({ id }: {
    id: string;
}) {
    const { t } = useLocale();
    const { properties, updateProperties } = useHostModels();
    switch (id) {
        case 'summary': return <div className="summary-fixture"><span className="eyebrow">{t("ESPA\u00C7O EM CONSTRU\u00C7\u00C3O")}</span><strong>{t("Seu pr\u00F3ximo")}<br />{t("ambiente de trabalho.")}</strong><p>{t("7 widgets de demonstra\u00E7\u00E3o.")}</p></div>;
        case 'queue': return <div className="table-fixture"><div className="fixture-toolbar"><span>{t("Conte\u00FAdo simulado")}</span><span className="badge">{t("04 itens")}</span></div><table><thead><tr><th>{t("Experimento")}</th><th>{t("Tipo")}</th><th>{t("Estado")}</th></tr></thead><tbody>{[
                ['Organizar uma composição', 'Layout', 'Explorar'], ['Experimentar o painel', 'Surface', 'Disponível'],
                ['Trocar a aparência', 'Tema', 'Disponível'], ['SDK para terceiros', 'Futuro', 'Fora desta base']
            ].map(([name, type, status]) => <tr key={name}><td>{t(name!)}</td><td>{t(type!)}</td><td><span className="table-tag">{t(status!)}</span></td></tr>)}</tbody></table><p className="fixture-caption">{t("Tabela de refer\u00EAncia \u00B7 n\u00E3o \u00E9 uma fila real de tarefas.")}</p></div>;
        case 'library': return <div className="library-fixture">{[
                { title: 'Coleções', Icon: ArchiveBoxIcon }, { title: 'Componentes', Icon: CubeIcon },
                { title: 'Referências', Icon: PhotoIcon }, { title: 'Documentos', Icon: DocumentTextIcon }
            ].map(({ title, Icon }) => <div className="library-tile" key={title}><Icon className="size-5"/><span>{t(title)}</span></div>)}</div>;
        case 'notes': return <div className="prose-fixture"><span className="eyebrow">{t("NOTAS DE LABORAT\u00D3RIO")}</span><h3>{t("Uma base, antes das ferramentas.")}</h3><p>{t("O objetivo aqui \u00E9 experimentar a organiza\u00E7\u00E3o, a densidade e o comportamento dos widgets.")}</p><blockquote>{t("O layout s\u00F3 muda quando voc\u00EA entra no modo de edi\u00E7\u00E3o.")}</blockquote><p>{t("O cabe\u00E7alho \u00E9 fixo. Sidebar, Main e Bottom s\u00E3o regi\u00F5es irm\u00E3s.")}</p><span className="fixture-caption">{t("Texto fict\u00EDcio para testar leitura e rolagem.")}</span></div>;
        case 'activity': return <div className="activity-fixture">{Array.from({ length: 18 }, (_, index) => <div className="activity-row" key={index}><span className="activity-dot"/><div><strong>{t(['Composição carregada', 'Referência disponível', 'Nova possibilidade'][index % 3]!)}</strong><p>{t("Registro de exemplo")} {String(index + 1).padStart(2, '0')} {t("\u00B7 atividade simulada.")}</p></div></div>)}</div>;
        case 'properties': return <div className="properties-fixture"><p>{t("Controles de demonstra\u00E7\u00E3o. N\u00E3o executam opera\u00E7\u00F5es externas.")}</p><label>{t("Nome de exemplo")}<input value={properties.name} onChange={event => updateProperties({ name: event.target.value })} aria-label={t("Nome de exemplo")}/></label><label>{t("Visualiza\u00E7\u00E3o")}<select value={properties.density} onChange={event => updateProperties({ density: event.target.value as 'compact' | 'comfortable' })}><option value="compact">{t("Compacta")}</option><option value="comfortable">{t("Confort\u00E1vel")}</option></select></label><label className="check-fixture"><input type="checkbox" checked={properties.details} onChange={event => updateProperties({ details: event.target.checked })}/>{t("Mostrar detalhes de exemplo")}</label><small>{t("Interagir com um campo n\u00E3o desloca o widget.")}</small></div>;
        case 'chart': return <div className="chart-fixture"><div className="chart-title"><span>{t("Ritmo fict\u00EDcio")}</span><strong>{t("+24%")}</strong></div><div className="bars" aria-label={t("Gr\u00E1fico com dados fict\u00EDcios")}>{[30, 45, 37, 63, 52, 81, 74, 92, 64, 85, 97, 78].map((height, index) => <span key={index} style={{ height: height + '%' }}/>)}</div><span className="fixture-caption">{t("N\u00E3o representa mem\u00F3ria, CPU nem m\u00E9tricas reais.")}</span></div>;
        default: return <p>{t("Widget de teste")}</p>;
    }
});
