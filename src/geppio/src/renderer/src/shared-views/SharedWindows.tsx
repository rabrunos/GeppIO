import { useRef } from 'react'
import { FloatingView } from './FloatingView.tsx'
import { gitSharedView } from './GitView.ts'
import { searchSharedView } from './SearchView.ts'
import { WorkspaceTools } from '../workspace-tools/WorkspaceTools.tsx'
import { SHARED_VIEWS } from './definition.ts'
import type { SharedViewId } from './definition.ts'
import { useFloatingWindows } from './useFloatingWindows.ts'
import type { RefObject } from 'react'
import type { GitSession } from '../git/session.ts'
import { focusAvailable } from '@geppio/ui'
import type { CoreSessions } from '../core/useCoreSessions.ts'

export function useSharedWindows(workbenchVisible: boolean, projectAnchor: RefObject<HTMLButtonElement | null>, git: GitSession) {
  function windowFallback(id: SharedViewId) {
    return workbenchVisible ? projectAnchor.current : document.querySelector<HTMLButtonElement>(
      id === gitSharedView.id ? '[data-git-window-trigger-fallback]' : id === searchSharedView.id ? '[data-search-window-trigger-fallback]' : '[data-tools-window-trigger-fallback]')
  }
  const windows = useFloatingWindows(windowFallback)
  const comparisonTrigger = useRef<{ button: HTMLButtonElement; fromWindow: boolean } | null>(null)
  function compareGit(id: string, trigger: HTMLButtonElement) {
    comparisonTrigger.current = { button: trigger, fromWindow: !!trigger.closest('[data-floating-view]') }
    void git.compare(id)
  }
  function closeGitComparison() {
    const trigger = comparisonTrigger.current
    comparisonTrigger.current = null
    git.close()
    // The result is asynchronous and disables its opener while pending. Restore
    // that opener after the native modal has left the top layer.
    requestAnimationFrame(() => {
      if (document.querySelector('dialog:modal') || focusAvailable(trigger?.button ?? null)) return
      if (trigger?.fromWindow && focusAvailable(windows.closeButtons[gitSharedView.id].current)) return
      focusAvailable(windowFallback(gitSharedView.id))
    })
  }
  return { windows, compareGit, closeGitComparison }
}

export function SharedWindows({ sessions, windows, compareGit, changingExperienceBlocked }: {
  sessions: CoreSessions
  windows: ReturnType<typeof useFloatingWindows>
  compareGit(id: string, trigger: HTMLButtonElement): void
  changingExperienceBlocked(): boolean
}) {
  const { git } = sessions
  return <>{SHARED_VIEWS.map(view => {
    const instance = windows.stack.find(item => item.viewId === view.id)
    return instance && <FloatingView key={view.id} instance={instance} title={view.title} size={view.floatingSize}
      active={windows.active === view.id} stackIndex={windows.stack.indexOf(instance)} raise={() => windows.raise(view.id)} close={() => windows.close(view.id)}
      closeButton={windows.closeButtons[view.id]} canDismissWithEscape={() => !changingExperienceBlocked()}>
      {view.id === gitSharedView.id ? <gitSharedView.Content session={git} compare={compareGit} /> :
        view.id === searchSharedView.id ? <searchSharedView.Content session={sessions.search} /> : <WorkspaceTools session={sessions.tools} />}
    </FloatingView>
  })}</>
}
