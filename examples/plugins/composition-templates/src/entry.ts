import type { PluginInstance } from '../../../../sdk/plugin.d.ts'

// Templates are available from the accepted manifest even while this entry is disabled.
export function activate(): PluginInstance {
  return { dispose() {} }
}
