import type { Json, DataDocument } from '../../../../sdk/plugin-v2.d.ts'
export interface Interval { id: string; start: number; end: number }
export interface Tracker { version: 1; running: { id: string; start: number } | null; sessions: Interval[] }
export const MAX_SESSIONS = 200
export const emptyTracker = (): Tracker => ({ version: 1, running: null, sessions: [] })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
const identity = (value: unknown): value is string => typeof value === 'string' && /^session\.[a-f0-9-]{36}$/.test(value)
export function parseTracker(value: unknown): Tracker {
  if (!record(value) || !exact(value, ['version', 'running', 'sessions']) || value.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > MAX_SESSIONS) throw new Error('Histórico incompatível. Originais preservados; recupere antes de editar.')
  const ids = new Set<string>()
  for (const item of value.sessions) {
    if (!record(item) || !exact(item, ['id', 'start', 'end']) || !identity(item.id) || !timestamp(item.start) || !timestamp(item.end) || item.end < item.start || ids.has(item.id)) throw new Error('Intervalo incompatível.')
    ids.add(item.id)
  }
  const running = value.running
  if (running !== null && (!record(running) || !exact(running, ['id', 'start']) || !identity(running.id) || !timestamp(running.start) || ids.has(running.id) || value.sessions.length === MAX_SESSIONS)) throw new Error('Cronômetro incompatível.')
  return structuredClone(value) as unknown as Tracker
}
export function startTimer(source: Tracker, now: number, id: string): Tracker {
  if (!timestamp(now) || !identity(id)) throw new Error('Timestamp ou identidade inválida.')
  if (source.sessions.some(session => session.id === id)) throw new Error('Identidade de sessão já utilizada.')
  if (source.running || source.sessions.length >= MAX_SESSIONS) return source
  return { ...source, running: { id, start: now } }
}
export function pauseTimer(source: Tracker, now: number): Tracker {
  if (!timestamp(now)) throw new Error('Timestamp inválido.')
  if (!source.running) return source
  return { ...source, running: null, sessions: [...source.sessions, { ...source.running, end: Math.max(source.running.start, now) }] }
}
export const elapsed = (start: number, end: number) => Math.max(0, end - start)
export function duration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}
/** Intersect a bounded seven-day window; never iterate over a years-long session. */
export function dailyTotals(source: Tracker, now: number) {
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const intervals = [...source.sessions, ...(source.running ? [{ ...source.running, end: Math.max(source.running.start, now) }] : [])]
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today); date.setDate(date.getDate() - index)
    const next = new Date(date); next.setDate(next.getDate() + 1)
    const ms = intervals.reduce((sum, item) => sum + Math.max(0, Math.min(item.end, next.getTime()) - Math.max(item.start, date.getTime())), 0)
    return { day: date.toLocaleDateString('pt-BR'), ms }
  })
}
export const trackerDocument = (value: Tracker): DataDocument => ({ schemaVersion: 1, value: structuredClone(value) as unknown as Json })
