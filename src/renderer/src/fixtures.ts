import type { LayoutSnapshot, MinSize } from '../../shared/layout.ts'
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
export const DEFAULT_LAYOUT: LayoutSnapshot = { schemaVersion: 1, theme: 'dark', placements: [
  { id: 'summary', x: 0, y: 0, width: .28, height: .22 },
  { id: 'queue', x: .30, y: 0, width: .42, height: .55 },
  { id: 'library', x: .74, y: 0, width: .26, height: .38 },
  { id: 'notes', x: 0, y: .24, width: .28, height: .47 },
  { id: 'activity', x: .74, y: .40, width: .26, height: .60 },
  { id: 'properties', x: .30, y: .57, width: .42, height: .43 },
  { id: 'chart', x: 0, y: .74, width: .28, height: .26 }
] }
// Initial minimums relative to the 960 × 620 logical canvas; policy remains provisional.
export const MINIMUMS: Record<string, MinSize> = Object.fromEntries(DEFAULT_LAYOUT.placements.map(p => [p.id, { width: .17, height: .18 }]))
