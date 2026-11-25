export interface Tile { id: string; kind: 'note' | 'counter' | 'surface'; title: string; source?: string }
export interface Definition { schema: 1; productId: string; name: string; tiles: Tile[] }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const title = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value)
export function parseDefinition(value: unknown): Definition {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'name,productId,schema,tiles' || value.schema !== 1
    || !identifier(value.productId) || !title(value.name) || !Array.isArray(value.tiles) || !value.tiles.length || value.tiles.length > 16) throw new Error('Invalid standalone definition')
  const ids = new Set<string>()
  for (const tile of value.tiles) {
    if (!record(tile) || !identifier(tile.id) || ids.has(tile.id) || !title(tile.title)
      || (typeof tile.kind !== 'string' || !['note', 'counter', 'surface'].includes(tile.kind))
      || (tile.kind === 'surface' ? !identifier(tile.source) || Object.keys(tile).length !== 4 : Object.keys(tile).length !== 3)) throw new Error('Invalid standalone tile')
    ids.add(tile.id)
  }
  return value as unknown as Definition
}
