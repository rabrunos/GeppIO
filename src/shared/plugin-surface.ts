import { boundedText, isRecord, pluginId } from './plugins.ts'
import { exactKeys } from './plugin-data.ts'
import type { WidgetViewV2, WidgetEvent } from '../../sdk/plugin-v2.d.ts'
export type { WidgetViewV2, WidgetEvent } from '../../sdk/plugin-v2.d.ts'
export const SURFACE_LIMITS = Object.freeze({ text: 32768, items: 100, bytes: 256 * 1024, events: 10 })
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max }
export function parseWidgetViewV2(value: unknown): WidgetViewV2 {
  if (!isRecord(value) || !exactKeys(value, ['text', 'fields', 'lists', 'actions', 'copy']) || !boundedText(value.text, 2048)) throw new Error('Superfície v2 inválida.')
  const ids = new Set<string>()
  function control(item: unknown, keys: string[]): asserts item is Record<string, unknown> {
    if (!isRecord(item) || !exactKeys(item, keys) || !pluginId(item.id) || !boundedText(item.label, 80) || ids.has(item.id)) throw new Error('Controle v2 inválido.'); ids.add(item.id)
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length > 8) throw new Error('Campos demais.')
    for (const field of value.fields) { control(field, ['id', 'label', 'value', 'multiline', 'maxLength']); if ((field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || (field.maxLength as number) < 1 || (field.maxLength as number) > SURFACE_LIMITS.text)) || !text(field.value, (field.maxLength as number | undefined) ?? SURFACE_LIMITS.text) || (field.multiline !== undefined && typeof field.multiline !== 'boolean')) throw new Error('Campo de texto inválido.') }
  }
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || value.actions.length > 8) throw new Error('Ações demais.')
    for (const action of value.actions) control(action, ['id', 'label'])
  }
  if (value.lists !== undefined) {
    if (!Array.isArray(value.lists) || value.lists.length > 4) throw new Error('Listas demais.')
    for (const list of value.lists) {
      control(list, ['id', 'label', 'items', 'selected'])
      if (!Array.isArray(list.items) || list.items.length > SURFACE_LIMITS.items) throw new Error('Lista inválida.')
      const itemIds = new Set<string>()
      for (const item of list.items) { if (!isRecord(item) || !exactKeys(item, ['id', 'text', 'checked']) || !pluginId(item.id) || !text(item.text, 512) || (item.checked !== undefined && typeof item.checked !== 'boolean') || itemIds.has(item.id)) throw new Error('Item inválido.'); itemIds.add(item.id) }
      if (list.selected !== undefined && (typeof list.selected !== 'string' || !itemIds.has(list.selected))) throw new Error('Seleção inválida.')
    }
  }
  if (value.copy !== undefined && (!isRecord(value.copy) || !exactKeys(value.copy, ['label', 'fieldId']) || !boundedText(value.copy.label, 80) || !pluginId(value.copy.fieldId) || !(value.fields as WidgetViewV2['fields'])?.some(field => field.id === (value.copy as Record<string, unknown>).fieldId))) throw new Error('Cópia inválida.')
  // All children have bounded primitive shapes before serialization.
  if (new TextEncoder().encode(JSON.stringify(value)).length > SURFACE_LIMITS.bytes) throw new Error('Superfície muito grande.')
  return structuredClone(value) as unknown as WidgetViewV2
}
export function parseWidgetEvent(value: unknown, view: WidgetViewV2): WidgetEvent {
  if (!isRecord(value) || !pluginId(value.controlId)) throw new Error('Evento inválido.')
  const list = view.lists?.find(list => list.id === value.controlId), item = list?.items.find(item => item.id === value.itemId)
  const field = view.fields?.find(field => field.id === value.controlId)
  if (value.kind === 'input' && exactKeys(value, ['kind', 'controlId', 'value']) && field && text(value.value, field.maxLength ?? SURFACE_LIMITS.text)) return { kind: 'input', controlId: value.controlId, value: value.value }
  if (value.kind === 'select' && exactKeys(value, ['kind', 'controlId', 'itemId']) && item && item.checked === undefined) return { kind: 'select', controlId: value.controlId, itemId: item.id }
  if (value.kind === 'toggle' && exactKeys(value, ['kind', 'controlId', 'itemId', 'value']) && item && typeof item.checked === 'boolean' && typeof value.value === 'boolean') return { kind: 'toggle', controlId: value.controlId, itemId: item.id, value: value.value }
  if (value.kind === 'action' && exactKeys(value, ['kind', 'controlId']) && view.actions?.some(action => action.id === value.controlId)) return { kind: 'action', controlId: value.controlId }
  throw new Error('Evento não corresponde ao controle publicado.')
}
