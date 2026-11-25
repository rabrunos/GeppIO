import type { WidgetType } from './workbench/model.ts'
export const TERMINAL_TYPE = 'host:terminal'
export const TERMINAL_WIDGET: WidgetType = {
  id: TERMINAL_TYPE, owner: 'host', title: 'Terminal', category: 'Terminal & Tarefas',
  description: 'PowerShell interativo oficial. A mesma sessão no Editor e nos Widgets.',
  appearance: 'card', presence: 'single-view', maximize: true,
  constraint: { min: { width: 320, height: 105 }, default: { width: 640, height: 320 }, max: { width: 24000, height: 24000 }, regions: ['main', 'bottom'], resizeX: true, resizeY: true, overflow: 'auto', responsive: 'region' }
}
