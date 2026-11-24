/** Each group owns one Windows desktop. Never run its entries concurrently. */
export interface SmokeStep { file: string; args?: string[] }
const smoke = (name: string, ...args: string[]): SmokeStep => ({ file: `tools/${name}-smoke.ts`, args })
const variants = (name: string) => [smoke(name), smoke(name, '--scale125'), smoke(name, '--dev')]

// All alpha.48 required Electron entrypoints, including their distinct runtime/DPR variants.
// Pure tests run once in core's pnpm check; public focused commands remain unchanged.
export const ciGroups = {
  core: [
    smoke('terminal'), smoke('terminal', '--scale125'),
    smoke('plugin-package'), smoke('plugin-dev'), smoke('sidebar-stack'),
    smoke('workspace-essentials'), smoke('time-tracker'), smoke('edit-lock'), ...variants('search-replace')
  ],
  ide: [
    ...variants('monaco'), ...variants('git'),
    smoke('document'), ...variants('multi-document'),
    smoke('explorer'), smoke('explorer', '--scale125'), ...variants('workspace'),
    smoke('demo-retirement'), smoke('identity'), smoke('desktop'),
    smoke('maximize'), smoke('maximize', '--scale125'),
    smoke('app-host'), smoke('app-host', '--scale125'),
    smoke('git-window'), smoke('git-window', '--scale125'), ...variants('search'),
    smoke('quick-open'), smoke('quick-open', '--scale125'),
    smoke('explorer-write'), smoke('explorer-write', '--scale125'),
    smoke('document-reload'), smoke('document-reload', '--scale125'), ...variants('rename-open'), ...variants('document-create'), ...variants('editor-split'), ...variants('editor-tabs')
  ],
  workbench: [
    smoke('alignment'), smoke('groups'),
    smoke('workbench'), smoke('workbench-organization'), smoke('workbench-plugins'), smoke('workbench-corrections'),
    smoke('presentation'), smoke('presentation', '--scale125'),
    smoke('real-presentation'), smoke('real-presentation', '--scale125'),
    smoke('shared-windows'), smoke('shared-windows', '--scale125'),
    smoke('portable-layout'), smoke('portable-layout', '--scale125'),
    smoke('plugin-templates'), smoke('plugin-templates', '--scale125'),
    smoke('workspace-tools'), smoke('workspace-tools', '--scale125')
  ]
} satisfies Record<string, SmokeStep[]>

export type CiGroup = keyof typeof ciGroups
