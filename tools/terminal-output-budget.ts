import { TERMINAL_PAGE_LIMIT } from '../src/geppio/src/shared/terminal.ts'
import type { TerminalResult } from '../src/geppio/src/shared/terminal.ts'

/** Measure one fixed output interval, not the sum of a tail window that keeps receiving output. */
export async function terminalOutputBudget(read: (after: number) => Promise<TerminalResult>) {
  const edge = await read(Number.MAX_SAFE_INTEGER)
  if (!edge.ok) throw new Error(edge.error)
  const end = edge.value.next
  let after = 0, start: number | null = null, retained = 0, dropped = false, complete = false
  for (let i = 0; i < 10; i++) {
    const result = await read(after)
    if (!result.ok) throw new Error(result.error)
    const page = result.value, beginning = page.next - page.data.length
    if (page.data.length > TERMINAL_PAGE_LIMIT) throw new Error('Terminal transport page exceeded its limit')
    if (start === null) { start = beginning; after = beginning }
    if (beginning !== after) throw new Error('Terminal output interval was lost while measuring its budget')
    dropped ||= page.dropped
    retained += Math.max(0, Math.min(page.next, end) - after)
    after = page.next
    if (after >= end) { complete = true; break }
    if (!page.data) break
  }
  return { dropped, retained, start, end, after, complete }
}
