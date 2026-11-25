import { useState } from 'react'
import type { WorkbenchChrome } from '../../../shared/workbench/chrome.ts'
import { useCodePresentation } from './GeppIOCode.tsx'
import { DEFAULT_EXPERIENCE, EXPERIENCES, experienceTransition, officialApp } from './registry.ts'
import type { Experience } from './registry.ts'
import './apps.css'

export function useAppHost(workbenchChrome: WorkbenchChrome) {
  const [experience, setExperience] = useState<Experience>(DEFAULT_EXPERIENCE)
  // Keep presentation preferences alive independently of the selected adapter.
  const code = useCodePresentation(workbenchChrome)
  const app = officialApp(experience)
  const presentation = app?.presentation === 'code' ? code : undefined

  function select(requested: unknown, blocked: () => boolean) {
    const result = experienceTransition(experience, requested, blocked)
    if (result.status === 'changed') setExperience(result.next)
    return result.status
  }

  return { experience, app, presentation, select, openExplorer: code.openExplorer }
}

export function ExperienceSwitch({ experience, disabled, changing, select }: {
  experience: Experience; disabled: boolean; changing(): boolean; select(id: Experience): void
}) {
  return <div className="experience-switch" role="group" aria-label="Experiência de trabalho">
    {EXPERIENCES.map(({ id, name }) => <button key={id} type="button" className="ui-button tool-button"
      aria-pressed={experience === id} disabled={disabled}
      title={disabled ? 'Conclua ou cancele a edição do layout antes de trocar de experiência.' : undefined}
      onMouseDown={event => { if (changing()) event.preventDefault() }}
      onClick={() => select(id)}>{name}</button>)}
  </div>
}
