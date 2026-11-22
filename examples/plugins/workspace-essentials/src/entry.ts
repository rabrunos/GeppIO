import type { DataDocument, DataSnapshot, Json, PluginContextV2, PluginInstanceV2, WidgetViewV2, WidgetEvent } from '../../../../sdk/plugin-v2.d.ts'
import { emptyModel, parseModel, document } from './model.ts'

// JSON object member order is not part of the stored document's identity.
function sameValue(left: Json, right: Json): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, i) => sameValue(value, right[i]!))
  if (Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key]!, right[key]!))
}

function storedModel(snapshot: DataSnapshot) {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('Revisão incompatível.')
  if (snapshot.document === null) return emptyModel()
  if (snapshot.document.schemaVersion !== 1) throw new Error('Formato incompatível.')
  return parseModel(snapshot.document.value)
}

export async function activate(context: PluginContextV2): Promise<PluginInstanceV2> {
  let confirmed: DataSnapshot = { revision: 0, document: null }
  let attempted: DataDocument | null = null
  let model = emptyModel(), state = 'Salvo.', writable = true, itemDraft = '', active = true
  try { confirmed = await context.data.read(); model = storedModel(confirmed) }
  catch { writable = false; state = 'Falha ao ler dados. Originais preservados para recuperação; edição bloqueada.' }
  function publish() {
    if (!active) return
    context.reportDraft?.(attempted !== null || itemDraft.length > 0)
    for (const kind of ['notes', 'prompts'] as const) {
      const selected = model[kind].find(entry => entry.id === (kind === 'notes' ? model.selectedNote : model.selectedPrompt))
      const view: WidgetViewV2 = { text: state }
      if (writable) {
        view.lists = [{ id: 'entries', label: kind === 'notes' ? 'Anotações' : 'Prompts salvos', items: model[kind].map(entry => ({ id: entry.id, text: entry.title })), ...(selected ? { selected: selected.id } : {}) }]
        view.actions = [{ id: 'new', label: kind === 'notes' ? 'Nova anotação' : 'Novo prompt' }, { id: 'save', label: 'Tentar salvar novamente' }]
        if (selected) {
          view.fields = [{ id: 'title.' + selected.id, label: 'Título', value: selected.title, maxLength: 512 }, { id: 'body.' + selected.id, label: kind === 'notes' ? 'Texto da anotação' : 'Texto do prompt', value: selected.body, multiline: true }]
          if (kind === 'prompts') view.copy = { label: 'Copiar prompt', fieldId: 'body.' + selected.id }
        }
      }
      context.publishWidget(kind, view)
    }
    context.publishWidget('scratch', { text: state, ...(writable ? { fields: [{ id: 'scratch', label: 'Texto do rascunho', value: model.scratch, multiline: true }], actions: [{ id: 'save', label: 'Tentar salvar novamente' }] } : {}) })
    context.publishWidget('checklist', { text: state, ...(writable ? { fields: [{ id: 'item', label: 'Novo item', value: itemDraft, maxLength: 512 }], lists: [{ id: 'items', label: 'Itens', items: model.checklist.map(item => ({ id: item.id, text: item.text, checked: item.done })) }], actions: [{ id: 'add', label: 'Adicionar item' }, { id: 'save', label: 'Tentar salvar novamente' }] } : {}) })
  }
  async function save() {
    state = 'Salvando…'; publish()
    try {
      if (attempted) {
        const observed = await context.data.read()
        storedModel(observed)
        const value = observed.document?.value ?? null
        if (!sameValue(value, attempted.value) && !sameValue(value, confirmed.document?.value ?? null)) {
          throw new Error('Conflito com dados armazenados. Copie o rascunho antes de fechar e tente novamente após resolver a divergência.')
        }
        confirmed = observed
      }
      const desired = document(model)
      if (!sameValue(desired.value, confirmed.document?.value ?? null)) {
        // Keep this exact payload even if a committed write returns an error.
        attempted = desired
        confirmed = await context.data.write(confirmed.revision, desired)
      }
      attempted = null
      state = 'Salvo.'
    }
    catch (error) { state = 'Falha ao salvar. Texto pendente preservado nesta ativação. ' + (error instanceof Error ? error.message : '') }
    publish()
  }
  async function onEvent(widgetId: string, event: WidgetEvent) {
    if (!active || !writable) return
    if (event.kind === 'action' && event.controlId === 'save') { if (attempted) await save(); return }
    if (widgetId === 'scratch' && event.kind === 'input' && event.controlId === 'scratch') model.scratch = event.value
    else if (widgetId === 'checklist') {
      if (event.kind === 'input' && event.controlId === 'item') { itemDraft = event.value.slice(0, 512); publish(); return }
      if (event.kind === 'action' && event.controlId === 'add' && itemDraft.trim() && model.checklist.length < 100) { model.checklist.push({ id: 'item.' + crypto.randomUUID(), text: itemDraft, done: false }); itemDraft = '' }
      else if (event.kind === 'toggle') { const item = model.checklist.find(item => item.id === event.itemId); if (item) item.done = event.value }
      else return
    } else if (widgetId === 'notes' || widgetId === 'prompts') {
      const key = widgetId === 'notes' ? 'selectedNote' : 'selectedPrompt'
      if (event.kind === 'action' && event.controlId === 'new' && model[widgetId].length < 30) {
        const entry = { id: 'item.' + crypto.randomUUID(), title: widgetId === 'notes' ? 'Sem título' : 'Novo prompt', body: '' }; model[widgetId].push(entry); model[key] = entry.id
      } else if (event.kind === 'select' && model[widgetId].some(entry => entry.id === event.itemId)) model[key] = event.itemId
      else if (event.kind === 'input') { const entry = model[widgetId].find(entry => entry.id === model[key]); if (!entry) return; if (event.controlId === 'title.' + entry.id) entry.title = event.value.slice(0, 512); else if (event.controlId === 'body.' + entry.id) entry.body = event.value; else return }
      else return
    } else return
    await save()
  }
  publish(); context.reportStatus('Workspace Essentials: dados locais comuns; Main; texto literal.')
  return { onEvent, dispose() { active = false } }
}
