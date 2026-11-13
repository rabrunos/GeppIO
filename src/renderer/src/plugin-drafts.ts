/** Host-owned field delivery hooks. No paths, storage, Worker API or generic IPC. */
const fields = new Map<string, Set<() => Promise<boolean>>>()
export function registerPluginDraft(id: string, flush: () => Promise<boolean>): () => void {
  const group = fields.get(id) ?? new Set<() => Promise<boolean>>()
  group.add(flush); fields.set(id, group)
  return () => { group.delete(flush); if (!group.size) fields.delete(id) }
}
export async function flushPluginDrafts(ids: readonly string[]): Promise<boolean> {
  for (const id of ids) for (const flush of [...(fields.get(id) ?? [])]) if (!await flush()) return false
  return true
}
