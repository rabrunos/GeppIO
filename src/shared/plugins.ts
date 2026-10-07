export type { WidgetView, PluginContext, PluginInstance } from '../../sdk/plugin.d.ts'
import type { WidgetView } from '../../sdk/plugin.d.ts'

export const PLUGIN_LIMITS = Object.freeze({ manifestBytes: 16 * 1024, fileBytes: 512 * 1024, packageBytes: 2 * 1024 * 1024, files: 64, plugins: 32, widgets: 8, timeoutMs: 3000 })
export interface PluginManifest {
  schemaVersion: 1
  apiVersion: 1
  id: string
  name: string
  version: string
  entry: string
  widgets: { id: string; title: string; surface: 'declarative' }[]
}
export interface InstalledPlugin { manifest: PluginManifest; enabled: boolean; revision: string }
export interface PluginInventory { plugins: InstalledPlugin[]; errors: string[] }
export type PluginResult<T> = { ok: true; value: T } | { ok: false; error: string }
export interface PluginBridge {
  list(): Promise<PluginResult<PluginInventory>>
  install(): Promise<PluginResult<PluginInventory | null>>
  setEnabled(id: string, enabled: boolean): Promise<PluginResult<PluginInventory>>
  remove(id: string): Promise<PluginResult<PluginInventory>>
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)) }
export function pluginId(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value) && value.length <= 64 && !Object.hasOwn(Object.prototype, value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(value) }
export function packagePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}
export function boundedText(value: unknown, max = 512): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
export function parseManifest(text: string): PluginManifest {
  if (new TextEncoder().encode(text).byteLength > PLUGIN_LIMITS.manifestBytes) throw new Error('Manifesto maior que 16 KiB.')
  let value: unknown
  try { value = JSON.parse(text) } catch (error) { throw new Error('Manifesto JSON inválido.', { cause: error }) }
  if (!isRecord(value) || !exact(value, ['schemaVersion', 'apiVersion', 'id', 'name', 'version', 'entry', 'widgets']) || value.schemaVersion !== 1 || value.apiVersion !== 1 || !pluginId(value.id) || !boundedText(value.name, 80)
    || !boundedText(value.version, 64) || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/.test(value.version)
    || !packagePath(value.entry) || !value.entry.endsWith('.js') || !Array.isArray(value.widgets) || value.widgets.length > PLUGIN_LIMITS.widgets) throw new Error('Manifesto inválido ou API incompatível.')
  const ids = new Set<string>()
  for (const widget of value.widgets) {
    if (!isRecord(widget) || !exact(widget, ['id', 'title', 'surface']) || !pluginId(widget.id) || !boundedText(widget.title, 80) || widget.surface !== 'declarative' || ids.has(widget.id)) throw new Error('Contribuição de widget inválida ou duplicada.')
    ids.add(widget.id)
  }
  return value as unknown as PluginManifest
}
export function parseWidgetView(value: unknown): WidgetView {
  if (!isRecord(value) || !exact(value, ['text', 'action']) || !boundedText(value.text, 2048)) throw new Error('Conteúdo do widget inválido.')
  if (value.action !== undefined && (!isRecord(value.action) || !exact(value.action, ['id', 'label']) || !pluginId(value.action.id) || !boundedText(value.action.label, 80))) throw new Error('Ação do widget inválida.')
  return { text: value.text, ...(value.action ? { action: value.action as WidgetView['action'] } : {}) }
}
