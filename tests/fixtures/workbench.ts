/** Explicit synthetic host scene for geometry/interaction regression suites. */
import { initialWorkbench as initial, widgetRegistry as registry } from '../../src/shared/workbench/model.ts'
import type { InstalledPlugin } from '../../src/shared/plugins.ts'
export * from '../../src/shared/workbench/model.ts'
export const initialWorkbench = () => initial(true)
export const widgetRegistry = (plugins: readonly InstalledPlugin[] = []) => registry(plugins, true)
