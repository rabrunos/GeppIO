import { GitChanges } from '../git/GitChanges.tsx'
import { GIT_SHARED_VIEW } from './definition.ts'

export const gitSharedView = { ...GIT_SHARED_VIEW, Content: GitChanges }
export const OPEN_GIT_WINDOW = 'Abrir Git em janela'
