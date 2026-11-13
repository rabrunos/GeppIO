import type { WidgetType } from './workbench/model.ts'
/** Essential first-party host registration; packaging/distribution remains provisional. */
export const FILE_EDITOR_TYPE = 'host:file-editor'
export const FILE_EDITOR: WidgetType = {
  id: FILE_EDITOR_TYPE, owner: 'host', title: 'Editor de arquivo', category: 'Arquivos & Editor',
  description: 'Editor oficial essencial. Compartilha o documento aberto no modo Editor.',
  appearance: 'card', presence: 'single-view', maximize: true,
  constraint: { min: { width: 320, height: 240 }, default: { width: 640, height: 480 }, max: { width: 24000, height: 24000 }, regions: ['main'], resizeX: true, resizeY: true, overflow: 'auto', responsive: 'region' }
}
