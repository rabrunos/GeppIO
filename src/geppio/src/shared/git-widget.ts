import type { WidgetType } from './workbench/model.ts'
export const GIT_TYPE = 'host:git-changes'
export const GIT_WIDGET: WidgetType = {
  id: GIT_TYPE, owner: 'host', title: 'Alterações Git', category: 'Desenvolvimento',
  description: 'Consulta Git real da pasta do Explorador. Status e comparação somente leitura.',
  appearance: 'card', presence: 'single-view', maximize: true,
  constraint: { min: { width: 180, height: 180 }, default: { width: 320, height: 420 }, max: { width: 24000, height: 24000 }, regions: ['main', 'sidebar'], resizeX: true, resizeY: true, overflow: 'auto', responsive: 'region' }
}
