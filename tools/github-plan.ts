export interface Label { name: string; color: string; description: string }
export function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+$/.test(value) || value.endsWith('/.') || value.endsWith('/..')) throw new Error('Use an explicit OWNER/REPO, not a URL or a command')
  return value
}
export function repositoryFromOrigin(value: string): string | null {
  const found = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value.trim())
  return found?.[1] ? repositoryName(found[1]) : null
}
export function labelActions(desired: Label[], observed: Label[]): { action: 'create' | 'update'; label: Label }[] {
  return desired.flatMap<{ action: 'create' | 'update'; label: Label }>(label => {
    const existing = observed.find(item => item.name === label.name)
    if (!existing) return [{ action: 'create' as const, label }]
    return existing.color.toLowerCase() === label.color.toLowerCase() && existing.description === label.description ? [] : [{ action: 'update' as const, label }]
  })
}
