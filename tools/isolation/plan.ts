import { ciGroups } from '../ci-plan.ts'
import type { SmokeStep } from '../ci-plan.ts'

export interface IsolationSelection { suite: string; step: SmokeStep }
const entries = [...new Set(Object.values(ciGroups).flat().map(step => step.file))]
export const suites = Object.fromEntries(entries.map(file => [file === 'tools/desktop-smoke.ts' ? 'desktop-core' : file.slice(6, -9), file]))
suites.conpty = 'tools/isolation/conpty-smoke.ts'
export const incompatible: Readonly<Record<string, string>> = {
  'workspace-essentials': 'Shared Windows clipboard assertions require the original CI or a separate interactive session.',
  terminal: 'The complete Terminal suite reads/writes the shared clipboard. Use conpty for a distinct isolated integration probe.',
  'edit-lock': 'The paste-key assertion can access the shared Windows clipboard; retain the original CI gate.'
}
const development = new Set(['desktop-core', 'identity', 'git', 'monaco', 'multi-document', 'workspace', 'search', 'rename-open'])
const scale125 = new Set(['desktop-core', 'alignment', 'groups', 'explorer', 'git', 'maximize', 'monaco', 'multi-document', 'presentation', 'real-presentation', 'workspace', 'terminal', 'conpty', 'app-host', 'git-window', 'search', 'shared-windows', 'portable-layout', 'quick-open', 'explorer-write', 'document-reload', 'plugin-templates', 'workspace-tools', 'rename-open'])

/** Only existing known entrypoints and supported literal flags. Never a shell command or path. */
export function selectSuite(suite: string, variant?: string): IsolationSelection {
  if (!Object.hasOwn(suites, suite)) throw new Error('UNKNOWN_SUITE: use --help for the explicit suite catalog')
  if (Object.hasOwn(incompatible, suite)) throw new Error('ISOLATION_INCOMPATIBLE: ' + incompatible[suite])
  if (variant && !((variant === '--dev' && development.has(suite)) || (variant === '--scale125' && scale125.has(suite)))) throw new Error('UNSUPPORTED_VARIANT')
  return { suite, step: { file: suites[suite]!, args: variant ? [variant] : [] } }
}

export function parseSelection(args: readonly string[]): IsolationSelection {
  if (args.length < 1 || args.length > 2) throw new Error('Usage: test:isolated <suite> [--dev|--scale125]')
  return selectSuite(args[0]!, args[1])
}

export function launchMode(env: NodeJS.ProcessEnv, platform = process.platform): 'isolated' | 'visible' {
  if (env.GEPPIO_ISOLATION_DESKTOP !== undefined) {
    if (platform !== 'win32' || !/^GeppIOTest[0-9a-f]{32}$/.test(env.GEPPIO_ISOLATION_DESKTOP) || env.GEPPIO_TEST_VISIBLE) throw new Error('ISOLATION_ENVIRONMENT_INVALID')
    return 'isolated'
  }
  if (env.GEPPIO_ISOLATION_CONFIG !== undefined) throw new Error('ISOLATION_DESKTOP_MISSING')
  if (env.GEPPIO_TEST_VISIBLE === '1' || (env.GITHUB_ACTIONS === 'true' && env.CI === 'true')) return 'visible'
  throw new Error('ISOLATION_REQUIRED: use pnpm test:isolated; visible debugging requires GEPPIO_TEST_VISIBLE=1 explicitly')
}
