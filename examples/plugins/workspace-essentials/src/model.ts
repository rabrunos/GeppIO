import type { Json } from '../../../../sdk/plugin-v2.d.ts'
export interface Entry { id: string; title: string; body: string }
export interface Model { version: 1; notes: Entry[]; prompts: Entry[]; scratch: string; checklist: { id: string; text: string; done: boolean }[]; selectedNote: string; selectedPrompt: string }
export function emptyModel(): Model { return { version: 1, notes: [], prompts: [], scratch: '', checklist: [], selectedNote: '', selectedPrompt: '' } }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, size: number): v is string => typeof v === 'string' && v.length <= size
const id = (v: unknown): v is string => typeof v === 'string' && /^item\.[a-f0-9-]{36}$/.test(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))
export function parseModel(value: unknown): Model {
  if (!record(value) || !exact(value, ['version', 'notes', 'prompts', 'scratch', 'checklist', 'selectedNote', 'selectedPrompt']) || value.version !== 1 || !text(value.scratch, 32768)) throw new Error('Dados Workspace Essentials incompatíveis. Originais preservados; recupere antes de editar.')
  for (const key of ['notes', 'prompts'] as const) {
    const entries = value[key]
    if (!Array.isArray(entries) || entries.length > 30) throw new Error('Coleção incompatível.')
    const ids = new Set<string>()
    for (const entry of entries) { if (!record(entry) || !exact(entry, ['id', 'title', 'body']) || !id(entry.id) || !text(entry.title, 512) || !text(entry.body, 32768) || ids.has(entry.id)) throw new Error('Documento incompatível.'); ids.add(entry.id) }
    const selected = value[key === 'notes' ? 'selectedNote' : 'selectedPrompt']
    if (typeof selected !== 'string' || (entries.length ? !ids.has(selected) : selected !== '')) throw new Error('Seleção incompatível.')
  }
  if (!Array.isArray(value.checklist) || value.checklist.length > 100) throw new Error('Checklist incompatível.')
  const ids = new Set<string>()
  for (const entry of value.checklist) { if (!record(entry) || !exact(entry, ['id', 'text', 'done']) || !id(entry.id) || !text(entry.text, 512) || typeof entry.done !== 'boolean' || ids.has(entry.id)) throw new Error('Item incompatível.'); ids.add(entry.id) }
  return structuredClone(value) as unknown as Model
}
export function document(model: Model): { schemaVersion: 1; value: Json } { return { schemaVersion: 1, value: structuredClone(model) as unknown as Json } }
