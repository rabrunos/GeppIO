import { assertUniqueJsonKeys } from './json-keys.ts'
import { pluginId } from './plugin-id.ts'

export const WORKSPACE_TOOLS_LIMITS = Object.freeze({
  bytes: 64 * 1024, reports: 8, blocks: 8, title: 80, text: 4096, item: 256, items: 50, columns: 6, rows: 50, cells: 1000
})
export type WorkspaceToolBlock = { kind: 'text'; text: string } | { kind: 'list'; items: string[] } |
  { kind: 'table'; columns: string[]; rows: string[][] }
export interface WorkspaceToolReport { id: string; title: string; blocks: WorkspaceToolBlock[] }
export type WorkspaceToolsResult = { ok: true; root: string; status: 'ready' | 'missing'; reports: WorkspaceToolReport[] } |
  { ok: false; error: string; expired?: true }

function invalid(): never { throw new Error('Relatório Tools inválido ou acima dos limites.') }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      !keys.every(key => Object.hasOwn(value, key))) return invalid()
  return value as Record<string, unknown>
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid()
  return value
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return invalid()
  return value
}
/** Literal report values only. All character quotas are measured in UTF-16 code units. */
export function parseWorkspaceTools(bytes: Uint8Array): { schemaVersion: 1; reports: WorkspaceToolReport[] } {
  const limits = WORKSPACE_TOOLS_LIMITS
  if (bytes.byteLength > limits.bytes) return invalid()
  let input: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    input = JSON.parse(text)
    assertUniqueJsonKeys(text)
  } catch { return invalid() }
  const data = object(input, ['schemaVersion', 'reports'])
  if (data.schemaVersion !== 1) return invalid()
  const ids = new Set<string>()
  let cells = 0
  function strings(value: unknown, max: number): string[] {
    const items = list(value, max)
    cells += items.length
    if (cells > limits.cells) return invalid()
    return items.map(item => string(item, limits.item))
  }
  function block(value: unknown): WorkspaceToolBlock {
    if (!value || typeof value !== 'object' || !('kind' in value)) return invalid()
    if (value.kind === 'text') return { kind: 'text', text: string(object(value, ['kind', 'text']).text, limits.text) }
    if (value.kind === 'list') return { kind: 'list', items: strings(object(value, ['kind', 'items']).items, limits.items) }
    if (value.kind !== 'table') return invalid()
    const table = object(value, ['kind', 'columns', 'rows'])
    const columns = strings(table.columns, limits.columns)
    const rows = list(table.rows, limits.rows).map(row => {
      const cells = strings(row, columns.length)
      if (cells.length !== columns.length) return invalid()
      return cells
    })
    return { kind: 'table', columns, rows }
  }
  const reports = list(data.reports, limits.reports).map(value => {
    const report = object(value, ['id', 'title', 'blocks'])
    if (!pluginId(report.id) || ids.has(report.id)) return invalid()
    ids.add(report.id)
    return { id: report.id, title: string(report.title, limits.title), blocks: list(report.blocks, limits.blocks).map(block) }
  })
  return { schemaVersion: 1, reports }
}
