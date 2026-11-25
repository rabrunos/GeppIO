import type { PluginInstance } from '@geppio/plugin-sdk/v1'

// Templates are available from the accepted manifest even while this entry is disabled.
export function activate(): PluginInstance {
  return { dispose() {} }
}
