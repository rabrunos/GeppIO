import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { compileFunction } from 'node:vm'
import ts from 'typescript'
import { emptyTerminal } from '../src/shared/terminal.ts'
import type { TerminalBridge, TerminalResult, TerminalState } from '../src/shared/terminal.ts'
import type { TerminalSession } from '../src/renderer/src/terminal/session.ts'

// Exercise the renderer session with controlled IPC and geometry. No browser,
// test-only application API, or change to production xterm module resolution.
const source = new URL('../src/renderer/src/terminal/session.ts', import.meta.url)
const requireFromSession = createRequire(source)
const loadSession = compileFunction(ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 }
}).outputText, ['require', 'exports', 'document'])
const size = { cols: 151, rows: 12 }

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let native: TerminalState = emptyTerminal(), generation = 0, hidden = false
  let resizeGate: Promise<void> | undefined
  const focus = t.mock.fn(), resized: Array<[string, number, number]> = []
  class Emulator {
    cols = 80
    rows = 24
    focus = focus
    options = {}
    parser = { registerOscHandler() {} }
    onData() {}
    attachCustomKeyEventHandler() {}
    open() {}
    reset() {}
    dispose() {}
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows }
    screen = () => ({ width: this.cols * 7, height: this.rows * 15 })
  }
  const host = {
    append() { element.parentElement = host },
    getClientRects: () => hidden ? [] : [{}],
    getBoundingClientRect: () => ({ width: 1073, height: 180 }),
    closest: () => null
  }
  const element = {
    parentElement: null as typeof host | null,
    querySelector: () => ({ getBoundingClientRect: emulator.screen }),
    remove() { this.parentElement = null }
  }
  const emulator = new Emulator()
  const exports = {} as { TerminalSession: typeof TerminalSession }
  loadSession((id: string) => id === '@xterm/xterm' ? { Terminal: class { constructor() { return emulator } } } : requireFromSession(id),
    exports, { createElement: () => element })
  const read = (): TerminalResult => ({ ok: true, value: { state: { ...native }, data: '', next: 0, dropped: false } })
  const bridge: TerminalBridge = {
    async read() { return read() },
    async start() { native = { ...emptyTerminal(), id: String(++generation), phase: 'starting' }; return read() },
    async close() { native.phase = 'closed'; return read() },
    async input() { return read() },
    async resize(id, cols, rows) {
      const settings = { ...native, cols, rows }
      resized.push([id, cols, rows])
      await resizeGate
      if (native.id === id) native = settings
      return { ok: true, value: { state: settings, data: '', next: 0, dropped: false } }
    }
  }
  const session = new exports.TerminalSession(bridge)
  session.connect()
  t.after(() => session.dispose())
  return {
    session, focus, resized,
    attach: () => session.attach(host as unknown as HTMLDivElement, 'dark'),
    hide() { hidden = true },
    show() { hidden = false },
    async publish(phase: TerminalState['phase'], settings: Partial<TerminalState> = {}) {
      native = { ...native, ...settings, phase }
      t.mock.timers.tick(60)
      await setImmediate()
    },
    holdResize() {
      let release!: () => void
      resizeGate = new Promise(resolve => { release = resolve })
      return release
    }
  }
}

test('startup and restart converge once per PTY without focusing on readiness', async t => {
  const p = fixture(t)
  p.attach()
  await setImmediate()
  const release = p.holdResize()
  await p.session.start()
  assert.equal(p.session.snapshot().native.phase, 'starting')
  assert.deepEqual(p.resized, [])
  const intentionalFocus = p.focus.mock.callCount()
  await p.publish('running')
  assert.deepEqual(p.resized, [['1', 151, 12]])
  assert.equal(p.focus.mock.callCount(), intentionalFocus)
  await p.session.fit()
  await p.session.fit()
  release()
  await setImmediate()
  await p.publish('running')
  assert.deepEqual(p.resized, [['1', 151, 12]], 'coalesced fit uses the acknowledged native dimensions')

  p.session.close()
  await setImmediate()
  assert.equal(p.session.snapshot().native.phase, 'closed')
  await p.session.start()
  const restartFocus = p.focus.mock.callCount()
  await p.publish('running')
  assert.deepEqual(p.resized, [['1', 151, 12], ['2', 151, 12]])
  assert.equal(p.focus.mock.callCount(), restartFocus)
  assert.deepEqual({ cols: p.session.snapshot().native.cols, rows: p.session.snapshot().native.rows }, size)
})

test('matching dimensions skip resize, and a directly observed new running generation fits', async t => {
  const p = fixture(t)
  p.attach()
  await setImmediate()
  await p.publish('running', { id: 'matching', ...size })
  await p.session.fit()
  assert.deepEqual(p.resized, [])
  await p.publish('running', { id: 'different', cols: 80, rows: 24 })
  assert.deepEqual(p.resized, [['different', 151, 12]])
  assert.equal(p.focus.mock.callCount(), 0)
})

test('an in-flight size acknowledgement cannot replace the dimensions of a new PTY', async t => {
  const p = fixture(t)
  p.attach()
  await setImmediate()
  const release = p.holdResize()
  await p.publish('running', { id: 'previous' })
  await p.publish('running', { id: 'replacement' })
  assert.deepEqual(p.resized, [['previous', 151, 12]])
  release()
  await setImmediate()
  assert.deepEqual(p.resized, [['previous', 151, 12], ['replacement', 151, 12]])
  assert.equal(p.session.snapshot().native.id, 'replacement')
})

test('readiness while hidden or unmounted waits for a usable host', async t => {
  const p = fixture(t)
  const detach = p.attach()
  await setImmediate()
  p.hide()
  await p.publish('running', { id: 'hidden' })
  assert.deepEqual(p.resized, [])
  p.show()
  await p.session.fit()
  assert.deepEqual(p.resized, [['hidden', 151, 12]])

  detach()
  await p.publish('running', { id: 'detached', cols: 80, rows: 24 })
  assert.deepEqual(p.resized, [['hidden', 151, 12]])
  p.attach()
  await setImmediate()
  assert.deepEqual(p.resized, [['hidden', 151, 12], ['detached', 151, 12]])
  assert.equal(p.focus.mock.callCount(), 0)
})
