export type ChromeRegion = 'sidebar' | 'bottom'
export interface RegionChrome { visible: boolean; size: number }
export type WorkbenchChrome = Record<ChromeRegion, RegionChrome>
export type ChromePatch = Partial<Record<ChromeRegion, Partial<RegionChrome>>>
export const CHROME_LIMITS = { sidebar: { min: 180, max: 430, initial: 283 }, bottom: { min: 125, max: 250, initial: 167 } } as const
export function defaultChrome(): WorkbenchChrome { return { sidebar: { visible: true, size: 283 }, bottom: { visible: true, size: 167 } } }
export function parseChrome(value: unknown, partial = false): ChromePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid region chrome')
  const source = value as Record<string, unknown>, result: ChromePatch = {}
  if (Object.keys(source).some(key => key !== 'sidebar' && key !== 'bottom')) throw new Error('Unknown chrome region')
  for (const region of ['sidebar', 'bottom'] as const) {
    const item = source[region]
    if (item === undefined && partial) continue
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid chrome region')
    const record = item as Record<string, unknown>
    if (Object.keys(record).some(key => key !== 'visible' && key !== 'size') || !Object.keys(record).length
      || (!partial && (record.visible === undefined || record.size === undefined))
      || (record.visible !== undefined && typeof record.visible !== 'boolean')
      || (record.size !== undefined && (typeof record.size !== 'number' || !Number.isFinite(record.size) || record.size < CHROME_LIMITS[region].min || record.size > CHROME_LIMITS[region].max))) throw new Error('Invalid chrome size/visibility')
    result[region] = { ...(record.size === undefined ? {} : { size: record.size as number }), ...(record.visible === undefined ? {} : { visible: record.visible as boolean }) }
  }
  return result
}
export function applyChrome(source: WorkbenchChrome, patch: ChromePatch): WorkbenchChrome {
  return { sidebar: { ...source.sidebar, ...patch.sidebar }, bottom: { ...source.bottom, ...patch.bottom } }
}
