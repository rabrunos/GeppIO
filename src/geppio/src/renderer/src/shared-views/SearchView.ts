import { SearchPanel } from '../search/SearchPanel.tsx'
import { SEARCH_SHARED_VIEW } from './definition.ts'

export const searchSharedView = { ...SEARCH_SHARED_VIEW, Content: SearchPanel }
export const OPEN_SEARCH_WINDOW = 'Abrir busca em janela'
