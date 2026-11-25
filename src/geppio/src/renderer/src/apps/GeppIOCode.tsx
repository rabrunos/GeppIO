import { useState } from 'react'
import { DocumentChartBarIcon, FolderIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import type { WorkbenchChrome } from '../../../shared/workbench/chrome.ts'
import type { CoreSessions } from '../core/useCoreSessions.ts'
import { regionViewport } from '../freeform/frame-layout.ts'
import type { Surfaces } from '../freeform/useSurfaces.ts'
import { FileEditor } from '../files-editor/FileEditor.tsx'
import type { MonacoHost } from '../files-editor/monaco.ts'
import { Explorer } from '../files-editor/Explorer.tsx'
import { OPEN_SEARCH_WINDOW, searchSharedView } from '../shared-views/SearchView.ts'
import { gitSharedView, OPEN_GIT_WINDOW } from '../shared-views/GitView.ts'
import type { SharedViewId } from '../shared-views/definition.ts'
import { OPEN_TOOLS_WINDOW, TOOLS_SHARED_VIEW } from '../shared-views/definition.ts'
import type { CompareGit } from '../git/GitChanges.tsx'
import { TerminalView } from '../terminal/TerminalView.tsx'
import { QuickOpenControl } from '../quick-open/QuickOpenControl.tsx'
import { BarIcon } from '../workbench/Sidebar.tsx'
import { IconButton } from '../workbench/Primitives.tsx'
import type { useRegions } from '../workbench/useRegions.ts'

interface CodePanels {
  sessions: CoreSessions
  measures: Surfaces['measures']
  regions: ReturnType<typeof useRegions>
  theme: 'light' | 'dark'
  compareGit: CompareGit
  openWindow(id: SharedViewId, trigger: HTMLButtonElement): void
  quickOpenBlocked(): boolean
  interactiveBusy: boolean
}

/** Official presentation borrowing Core sessions and the shell's measured regions. */
export function useCodePresentation(workbenchChrome: WorkbenchChrome) {
  const [sidebar, setSidebar] = useState(() => ({ ...workbenchChrome.sidebar, visible: true }))
  const [activity, setActivity] = useState<'explorer' | 'git' | 'search'>('explorer')

  return {
    chrome: { ...workbenchChrome, sidebar },
    chromeForWorkbench(chrome: WorkbenchChrome, saved: WorkbenchChrome) {
      setSidebar(chrome.sidebar)
      if (chrome.bottom.size === saved.bottom.size && chrome.bottom.visible === saved.bottom.visible) return null
      return { ...saved, bottom: chrome.bottom }
    },
    openExplorer() {
      setSidebar(previous => ({ ...previous, visible: true })); setActivity('explorer')
      requestAnimationFrame(() => document.querySelector<MonacoHost>('.direct-file-editor .monaco-host[data-active-group="true"]')?.monacoEditor?.focus())
    },
    panels({ sessions, measures, regions, theme, compareGit, openWindow, quickOpenBlocked, interactiveBusy }: CodePanels) {
      const sidebar = regionViewport('sidebar', measures.sidebar)
      const main = regionViewport('main', measures.main)
      const bottom = regionViewport('bottom', measures.bottom)
      function selectActivity(next: typeof activity) {
        if (next === activity) regions.toggle('sidebar')
        else { setActivity(next); regions.revealSidebar() }
      }
      function windowAction(id: SharedViewId, label: string) {
        return <button type="button" className="ui-button tool-button" aria-haspopup="dialog"
          onClick={event => openWindow(id, event.currentTarget)}>{label}</button>
      }
      return {
        rail: {
          label: 'Atividades do Editor',
          heading: { git: 'Alterações Git', explorer: 'Explorador', search: 'Busca no projeto' }[activity],
          primary: <IconButton label="Explorador" literalLabel className="sidebar-rail-button sidebar-main-button"
            aria-pressed={activity === 'explorer' && regions.sidebarMode !== 'hidden'} onClick={() => selectActivity('explorer')}><FolderIcon className="icon" /></IconButton>,
          tools: <><QuickOpenControl session={sessions.quickOpen} blocked={quickOpenBlocked} interactiveBusy={interactiveBusy} /><IconButton label="Busca no projeto" literalLabel className="sidebar-rail-button"
            data-search-window-trigger-fallback aria-pressed={activity === 'search' && regions.sidebarMode !== 'hidden'} onClick={() => selectActivity('search')}><MagnifyingGlassIcon className="icon" /></IconButton>
          <IconButton label="Alterações Git" literalLabel className="sidebar-rail-button"
            data-git-window-trigger-fallback aria-pressed={activity === 'git' && regions.sidebarMode !== 'hidden'} onClick={() => selectActivity('git')}><BarIcon icon="git" /></IconButton>
          <IconButton label={OPEN_TOOLS_WINDOW} literalLabel className="sidebar-rail-button" aria-haspopup="dialog" data-tools-window-trigger-fallback
            onClick={event => openWindow(TOOLS_SHARED_VIEW.id, event.currentTarget)}><DocumentChartBarIcon className="icon" /></IconButton></>
        },
        sidebar: <div className="editor-explorer-panel editor-region-panel" style={sidebar} data-sidebar-interactive
          hidden={sidebar.width <= 0 || sidebar.height <= 0} inert={regions.sidebarMode === 'hidden'}
          onPointerEnter={() => regions.hover(true)} onPointerLeave={() => regions.hover(false)}>
          {activity === 'search' ? <searchSharedView.Content session={sessions.search} headerAction={windowAction(searchSharedView.id, OPEN_SEARCH_WINDOW)} />
            : activity === 'git' ? <gitSharedView.Content session={sessions.git} compare={compareGit} headerAction={windowAction(gitSharedView.id, OPEN_GIT_WINDOW)} />
            : <Explorer session={sessions.explorer} git={sessions.git} />}
        </div>,
        main: <div className="direct-file-editor" style={main}><FileEditor session={sessions.editor} /></div>,
        bottom: <div className="direct-terminal editor-region-panel" style={bottom}
          hidden={bottom.width <= 0 || bottom.height <= 0} inert={regions.collapsed.bottom}>
          <TerminalView session={sessions.terminal} theme={theme} />
        </div>
      }
    }
  }
}
