import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { emptyTerminal, terminalFailed, terminalLabel, TerminalOutput, TERMINAL_OUTPUT_LIMIT, TERMINAL_PAGE_LIMIT, validTerminalRequest } from '../src/shared/terminal.ts'
import { TERMINAL_TYPE } from '../src/shared/terminal-widget.ts'
import { widgetRegistry } from '../src/shared/workbench/model.ts'
import { terminalOutputBudget } from '../tools/terminal-output-budget.ts'

test('fixed terminal requests reject malformed fields, dimensions, input and stale token shapes', () => {
  const id = randomUUID()
  for (const [operation, args] of [['start', []], ['read', [null, 0]], ['read', [id, 42]], ['input', [id, '\u0003']], ['resize', [id, 80, 24]], ['close', [id]]] as const) assert.equal(validTerminalRequest(operation, args), true)
  for (const [operation, args] of [['start', ['powershell']], ['read', [null, -1]], ['read', [id, Infinity]], ['input', [id, 'x'.repeat(8193)]], ['input', [id, '']], ['input', ['foreign', 'ls']], ['resize', [id, 1, 24]], ['resize', [id, 80, 201]], ['resize', [id, 80.1, 24]], ['close', [id, true]], ['spawn', [id]]]) assert.equal(validTerminalRequest(operation as string, args as unknown[]), false)
})
test('output retains bounded contiguous tail with explicit loss and bounded pages', () => {
  const output = new TerminalOutput()
  for (let i = 0; i < 1000; i++) output.append('x'.repeat(1000))
  let cursor = 0, count = 0, first = true
  for (;;) {
    const page = output.read(cursor)
    assert.equal(page.dropped, first); first = false
    assert.ok(page.data.length <= TERMINAL_PAGE_LIMIT)
    if (!page.data) break
    count += page.data.length; cursor = page.next
  }
  assert.equal(count, TERMINAL_OUTPUT_LIMIT); assert.equal(cursor, 1000000)
  assert.equal(output.read(cursor + 1).dropped, true)
})
test('output does not split a Unicode pair across transport pages', () => {
  const output = new TerminalOutput(); output.append('a'.repeat(TERMINAL_PAGE_LIMIT - 1) + '😀end')
  const first = output.read(0), second = output.read(first.next)
  assert.equal(first.data.length, TERMINAL_PAGE_LIMIT - 1); assert.equal(second.data, '😀end')
})
test('status reports shell exit only and official widget is Main/Bottom eligible', () => {
  const running = { ...emptyTerminal(), phase: 'running' as const }
  assert.equal(terminalFailed(running), false)
  assert.equal(terminalFailed({ ...running, phase: 'exited', exitCode: 0 }), false)
  assert.equal(terminalFailed({ ...running, phase: 'exited', exitCode: 7 }), true)
  assert.match(terminalLabel({ ...running, phase: 'exited', exitCode: 7 }), /7/)
  assert.equal(terminalFailed({ ...running, phase: 'closed', exitCode: 1 }), false)
  assert.match(terminalLabel({ ...running, phase: 'closed', exitCode: 1 }), /\(1\)/)
  assert.equal(terminalFailed({ ...running, phase: 'failed' }), true)
  assert.deepEqual(widgetRegistry([]).get(TERMINAL_TYPE)?.constraint.regions, ['main', 'bottom'])
})
test('output budget measures a fixed interval while later native output continues arriving', async () => {
  const output = new TerminalOutput(); output.append('x'.repeat(TERMINAL_OUTPUT_LIMIT * 3))
  let reads = 0
  const budget = await terminalOutputBudget(async after => {
    const result = { ok: true as const, value: { state: emptyTerminal(), ...output.read(after) } }
    if (++reads === 2) output.append('p'.repeat(73))
    return result
  })
  assert.equal(budget.complete, true); assert.equal(budget.dropped, true)
  assert.equal(budget.retained, TERMINAL_OUTPUT_LIMIT)
  assert.equal(budget.retained, budget.end - budget.start!); assert.ok(budget.after >= budget.end)
  assert.equal(output.read(budget.end).data, 'p'.repeat(73))
  const unbounded = await terminalOutputBudget(async after => {
    const text = 'x'.repeat(TERMINAL_OUTPUT_LIMIT * 2), start = Math.min(after, text.length), data = text.slice(start, start + TERMINAL_PAGE_LIMIT)
    return { ok: true, value: { state: emptyTerminal(), data, next: start + data.length, dropped: start > 0 } }
  })
  assert.equal(unbounded.complete, false); assert.ok(unbounded.retained > TERMINAL_OUTPUT_LIMIT)
  await assert.rejects(terminalOutputBudget(async () => ({ ok: true, value: { state: emptyTerminal(), data: 'x'.repeat(TERMINAL_PAGE_LIMIT + 1), next: TERMINAL_PAGE_LIMIT + 1, dropped: false } })), /page exceeded/)
})
