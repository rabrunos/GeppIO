import { validContract } from '@geppio/plugin-sdk'
import type { SurfaceContract } from '@geppio/plugin-sdk'
export type { WidgetView, PluginContext, PluginInstance } from '@geppio/plugin-sdk/v1'
import type { WidgetView } from '@geppio/plugin-sdk/v1'
import { pluginId } from './plugin-id.ts'
import { assertUniqueJsonKeys } from './json-keys.ts'
import { parsePortableLayout } from './workbench/portable-format.ts'
import type { PortableCompositionV1 } from './workbench/portable-format.ts'
export { pluginId }

export const PLUGIN_LIMITS = Object.freeze({ manifestBytes: 16 * 1024, fileBytes: 512 * 1024, packageBytes: 2 * 1024 * 1024, files: 64, plugins: 32, widgets: 8, compositionTemplates: 4, timeoutMs: 3000 })
export interface PluginCompositionTemplate { id: string; composition: PortableCompositionV1 }
export interface PluginManifest {
  schemaVersion: 1
  apiVersion: 1 | 2 | 3
  surface?: SurfaceContract
  id: string
  name: string
  version: string
  entry: string
  widgets: { id: string; title: string; surface: 'declarative' | 'web' }[]
  compositionTemplates?: PluginCompositionTemplate[]
}
export interface InstalledPlugin {
  manifest: PluginManifest; enabled: boolean; revision: string
  source?: 'legacy' | 'signed' | 'external'
  generation?: string
  desiredEnabled?: boolean
  unavailable?: string
  recoveryWidgets?: PluginManifest['widgets']
}
export interface PluginInventory { plugins: InstalledPlugin[]; errors: string[]; developerMode?: boolean }
export type PluginResult<T> = { ok: true; value: T } | { ok: false; error: string }
export interface PluginBridge {
  list(): Promise<PluginResult<PluginInventory>>
  install(): Promise<PluginResult<PluginInventory | null>>
  installFile(): Promise<PluginResult<PluginInventory | null>>
  setDeveloperMode(enabled: boolean): Promise<PluginResult<PluginInventory>>
  reload(id: string): Promise<PluginResult<PluginInventory>>
  link(id: string): Promise<PluginResult<PluginInventory | null>>
  setEnabled(id: string, enabled: boolean): Promise<PluginResult<PluginInventory>>
  remove(id: string): Promise<PluginResult<PluginInventory>>
}
export function codeGeneration(plugin: InstalledPlugin): string { return plugin.generation ?? plugin.revision }
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)) }
export function packagePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}
export function boundedText(value: unknown, max = 512): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
export function parseManifest(text: string): PluginManifest {
  if (new TextEncoder().encode(text).byteLength > PLUGIN_LIMITS.manifestBytes) throw new Error('Manifesto maior que 16 KiB.')
  let value: unknown
  try { value = JSON.parse(text) } catch (error) { throw new Error('Manifesto JSON inválido.', { cause: error }) }
  if (!isRecord(value) || !exact(value, ['schemaVersion', 'apiVersion', 'id', 'name', 'version', 'entry', 'widgets', 'compositionTemplates', 'surface']) || value.schemaVersion !== 1 || ![1, 2, 3].includes(value.apiVersion as number) || !pluginId(value.id) || !boundedText(value.name, 80)
    || !boundedText(value.version, 64) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/.test(value.version)
    || !packagePath(value.entry) || !(value.apiVersion === 3 ? /\.(?:js|ts|tsx|jsx)$/.test(value.entry) : value.entry.endsWith('.js')) || !Array.isArray(value.widgets) || value.widgets.length > PLUGIN_LIMITS.widgets) throw new Error('Manifesto inválido ou API incompatível.')
  if (value.apiVersion === 3) {
    assertUniqueJsonKeys(text)
    if (!validContract(value.surface) || !packagePath(value.surface.html) || !value.surface.html.endsWith('.html')
      || !packagePath(value.surface.css) || !value.surface.css.endsWith('.css') || value.widgets.length !== 1) throw new Error('Contrato de superfície inválido.')
  } else if (value.surface !== undefined) throw new Error('Superfície exige API 3.')
  const ids = new Set<string>()
  for (const widget of value.widgets) {
    if (!isRecord(widget) || !exact(widget, ['id', 'title', 'surface']) || !pluginId(widget.id) || !boundedText(widget.title, 80) || widget.surface !== (value.apiVersion === 3 ? 'web' : 'declarative') || ids.has(widget.id)) throw new Error('Contribuição de widget inválida ou duplicada.')
    ids.add(widget.id)
  }
  if (Object.hasOwn(value, 'compositionTemplates')) {
    assertUniqueJsonKeys(text)
    const templates = value.compositionTemplates
    if (!Array.isArray(templates) || templates.length > PLUGIN_LIMITS.compositionTemplates) throw new Error('Lista de modelos de composição inválida ou acima do limite.')
    const templateIds = new Set<string>()
    value.compositionTemplates = templates.map((item: unknown): PluginCompositionTemplate => {
      if (!isRecord(item) || !exact(item, ['id', 'composition']) || !pluginId(item.id) || templateIds.has(item.id)) throw new Error('Modelo de composição inválido ou duplicado.')
      templateIds.add(item.id)
      return { id: item.id, composition: parsePortableLayout(item.composition) }
    })
  }
  return value as unknown as PluginManifest
}
export function parseWidgetView(value: unknown): WidgetView {
  if (!isRecord(value) || !exact(value, ['text', 'action']) || !boundedText(value.text, 2048)) throw new Error('Conteúdo do widget inválido.')
  if (value.action !== undefined && (!isRecord(value.action) || !exact(value.action, ['id', 'label']) || !pluginId(value.action.id) || !boundedText(value.action.label, 80))) throw new Error('Ação do widget inválida.')
  return { text: value.text, ...(value.action ? { action: value.action as WidgetView['action'] } : {}) }
}
