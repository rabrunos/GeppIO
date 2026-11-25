import type { PluginCompositionTemplate } from '../../src/geppio/src/shared/plugins.ts'

export function template(name = 'Formato local'): PluginCompositionTemplate {
  return { id: 'simple', composition: { kind: 'geppio-layout', version: 1, name, mode: 'format', scopes: ['main'],
    reference: { main: { width: 800, height: 500 } }, chrome: {},
    format: [{ key: 's1', region: 'main', x: 0, y: 0, width: 300, height: 200 }], views: [], placements: [], groups: [] } }
}
