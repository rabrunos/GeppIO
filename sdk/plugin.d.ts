/** Experimental trusted-local API v1. UI surfaces are separate from the logic lifecycle. */
export interface WidgetView {
  text: string
  action?: { id: string; label: string }
}
export interface PluginContext {
  readonly pluginId: string
  publishWidget(widgetId: string, view: WidgetView): void
  reportStatus(message: string): void
}
export interface PluginInstance {
  dispose(): void | Promise<void>
  onAction?(widgetId: string, actionId: string): void | Promise<void>
}
export type Activate = (context: PluginContext) => PluginInstance | Promise<PluginInstance>
