const OFFICIAL_APPS = [
  { id: 'geppio-code', name: 'GeppIO Code', presentation: 'code', capabilities: ['documents', 'explorer', 'git', 'terminal'] }
] as const

export type OfficialApp = typeof OFFICIAL_APPS[number]
export type Experience = 'workbench' | OfficialApp['id']
export const DEFAULT_EXPERIENCE: Experience = 'workbench'
export const EXPERIENCES = [{ id: DEFAULT_EXPERIENCE, name: 'Bancada de Trabalho' }, ...OFFICIAL_APPS] as const

export function officialApp(id: unknown): OfficialApp | undefined {
  return OFFICIAL_APPS.find(app => app.id === id)
}

export function experienceTransition(current: Experience, requested: unknown, blocked: () => boolean) {
  const next = requested === DEFAULT_EXPERIENCE ? DEFAULT_EXPERIENCE : officialApp(requested)?.id
  if (!next) return { status: 'unsupported' } as const
  if (blocked()) return { status: 'blocked' } as const
  if (next === current) return { status: 'unchanged' } as const
  return { status: 'changed', next } as const
}
