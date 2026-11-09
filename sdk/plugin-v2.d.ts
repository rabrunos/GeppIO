import type { PluginContext, PluginInstance } from './plugin.d.ts'

/** Opt-in trusted-local API 2. Plain text only; no DOM, native or clipboard authority. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface DataDocument { schemaVersion: 1; value: Json }
export interface DataSnapshot { revision: number; document: DataDocument | null }
export interface TextField { id: string; label: string; value: string; multiline?: boolean; maxLength?: number }
export interface TextList { id: string; label: string; items: { id: string; text: string; checked?: boolean }[]; selected?: string }
export interface WidgetViewV2 {
  text: string
  fields?: TextField[]
  lists?: TextList[]
  actions?: { id: string; label: string }[]
  copy?: { label: string; fieldId: string }
}
export type WidgetEvent =
  | { kind: 'input'; controlId: string; value: string }
  | { kind: 'select'; controlId: string; itemId: string }
  | { kind: 'toggle'; controlId: string; itemId: string; value: boolean }
  | { kind: 'action'; controlId: string }
export interface PluginContextV2 extends Omit<PluginContext, 'publishWidget'> {
  publishWidget(widgetId: string, view: WidgetViewV2): void
  readonly data: {
    read(): Promise<DataSnapshot>
    write(expectedRevision: number, document: DataDocument): Promise<DataSnapshot>
  }
}
export interface PluginInstanceV2 extends PluginInstance {
  onEvent?(widgetId: string, event: WidgetEvent): void | Promise<void>
}
export type ActivateV2 = (context: PluginContextV2) => PluginInstanceV2 | Promise<PluginInstanceV2>
