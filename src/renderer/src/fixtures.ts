export { DEFAULT_LAYOUT, MINIMUMS, MAIN_CONSTRAINTS } from '../../shared/layout-defaults.ts'
export const WIDGETS = [
  { id: 'summary', title: 'Panorama', type: 'Indicador', region: 'main' },
  { id: 'queue', title: 'Fila de trabalho', type: 'Tabela', region: 'main' },
  { id: 'library', title: 'Biblioteca', type: 'Cards', region: 'main' },
  { id: 'notes', title: 'Ideias em aberto', type: 'Texto', region: 'main' },
  { id: 'activity', title: 'Atividade', type: 'Lista com rolagem', region: 'main' },
  { id: 'properties', title: 'Propriedades', type: 'Formulário', region: 'main' },
  { id: 'chart', title: 'Ritmo', type: 'Gráfico fictício', region: 'main' },
  { id: 'navigation', title: 'Navegação', type: 'Lista', region: 'sidebar' },
  { id: 'status', title: 'Barra de estado', type: 'Toolbar', region: 'bottom' },
  { id: 'panel', title: 'Painel de teste', type: 'Docked / overlay', region: 'main' }
] as const
