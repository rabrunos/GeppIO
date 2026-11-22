import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setImmediate } from 'node:timers/promises'
import { compileFunction } from 'node:vm'
import ts from 'typescript'
import { emptyTerminal, TERMINAL_PAGE_LIMIT, TerminalOutput } from '../src/shared/terminal.ts'
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

function fixture(t: TestContext, initialFailure?: 'reject' | 'result') {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let native: TerminalState = emptyTerminal(), generation = 0, hidden = false
  let output = new TerminalOutput()
  let readGate: Promise<void> | undefined
  let nextReadFailure = initialFailure
  let resizeGate: Promise<void> | undefined
  const focus = t.mock.fn(), resized: Array<[string, number, number]> = []
  const writes: string[] = [], disposeEmulator = t.mock.fn()
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
    dispose = disposeEmulator
    write(data: string, done: () => void) { writes.push(data); done() }
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
  const createEmulator = t.mock.fn(() => emulator)
  const exports = {} as { TerminalSession: typeof TerminalSession }
  loadSession((id: string) => id === '@xterm/xterm' ? { Terminal: class { constructor() { return createEmulator() } } } : requireFromSession(id),
    exports, { createElement: () => element })
  const metadata = (): TerminalResult => ({ ok: true, value: { state: { ...native }, data: '', next: 0, dropped: false } })
  const reads = t.mock.fn(async (id: string | null, after: number): Promise<TerminalResult> => {
    const failure = nextReadFailure
    nextReadFailure = undefined
    if (failure === 'reject') throw new Error('temporary bridge failure')
    if (failure === 'result') return { ok: false, error: 'temporary read failure' }
    if (id !== null && id !== native.id) return { ok: false, error: 'expired terminal session' }
    const value = { state: { ...native }, ...output.read(after) }
    await readGate
    return { ok: true, value }
  })
  const bridge: TerminalBridge = {
    read: reads,
    async start() {
      output = new TerminalOutput()
      native = { ...emptyTerminal(), id: String(++generation), phase: 'starting' }
      return metadata()
    },
    async close() { native.phase = native.phase === 'running' ? 'closing' : 'closed'; return metadata() },
    async input() { return metadata() },
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
  const setNative = (phase: TerminalState['phase'], settings: Partial<TerminalState> = {}) => {
    if (settings.id !== undefined && settings.id !== native.id) output = new TerminalOutput()
    native = { ...native, ...settings, phase }
  }
  const tick = async (ms: number) => { t.mock.timers.tick(ms); await setImmediate() }
  return {
    session, focus, resized, reads, writes, createEmulator, disposeEmulator, setNative, tick,
    append: (data: string) => output.append(data),
    failNextRead(kind: 'reject' | 'result') { nextReadFailure = kind },
    holdRead() {
      let release!: () => void
      readGate = new Promise(resolve => { release = resolve })
      return release
    },
    attach: () => session.attach(host as unknown as HTMLDivElement, 'dark'),
    hide() { hidden = true },
    show() { hidden = false },
    async reconnectRunning(settings: Partial<TerminalState>) {
      setNative('running', settings)
      session.connect()
      await setImmediate()
    },
    async publish(phase: TerminalState['phase'], settings: Partial<TerminalState> = {}) {
      setNative(phase, settings)
      await tick(60)
    },
    holdResize() {
      let release!: () => void
      resizeGate = new Promise(resolve => { release = resolve })
      return release
    }
  }
}

test('an empty initial sync stays idle for 600 ms', async t => {
  const p = fixture(t)
  await setImmediate()
  assert.equal(p.reads.mock.callCount(), 1)
  for (let i = 0; i < 10; i++) await p.tick(60)
  assert.equal(p.reads.mock.callCount() - 1, 0, 'recurring reads after the initial empty sync')
})

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
  assert.equal(p.session.snapshot().native.phase, 'closing')
  await p.publish('closed')
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
  await p.reconnectRunning({ id: 'matching', ...size })
  await p.session.fit()
  assert.deepEqual(p.resized, [])
  await p.reconnectRunning({ id: 'different', cols: 80, rows: 24 })
  assert.deepEqual(p.resized, [['different', 151, 12]])
  assert.equal(p.focus.mock.callCount(), 0)
})

test('an in-flight size acknowledgement cannot replace the dimensions of a new PTY', async t => {
  const p = fixture(t)
  p.attach()
  await setImmediate()
  const release = p.holdResize()
  await p.reconnectRunning({ id: 'previous' })
  await p.reconnectRunning({ id: 'replacement' })
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
  await p.reconnectRunning({ id: 'hidden' })
  assert.deepEqual(p.resized, [])
  p.show()
  await p.session.fit()
  assert.deepEqual(p.resized, [['hidden', 151, 12]])

  detach()
  await p.reconnectRunning({ id: 'detached', cols: 80, rows: 24 })
  assert.deepEqual(p.resized, [['hidden', 151, 12]])
  p.attach()
  await setImmediate()
  assert.deepEqual(p.resized, [['hidden', 151, 12], ['detached', 151, 12]])
  assert.equal(p.focus.mock.callCount(), 0)
})

for (const finalPhase of ['closed', 'exited'] as const) {
  test(`hidden PTY drains a burst and its last ${finalPhase} page, then restart uses a fresh cursor`, async t => {
    const p = fixture(t)
    const detach = p.attach()
    await setImmediate()
    p.hide()
    await p.session.start()
    p.append('ready\n')
    await p.publish('running')
    assert.deepEqual(p.writes, ['ready\n'], 'running output arrives even when hidden')
    await p.tick(1)
    detach()

    const pages = ['A'.repeat(TERMINAL_PAGE_LIMIT), 'B'.repeat(TERMINAL_PAGE_LIMIT), 'last\n']
    if (finalPhase === 'closed') {
      p.session.close()
      await setImmediate()
      assert.equal(p.session.snapshot().native.phase, 'closing')
    }
    p.append(pages.join(''))
    await p.publish(finalPhase, { exitCode: 0 })
    for (let i = 0; i < pages.length; i++) await p.tick(1)
    assert.deepEqual(p.writes, ['ready\n', ...pages], 'drain bounded pages immediately in order without a presentation')
    assert.equal(p.session.snapshot().native.phase, finalPhase)
    const settled = p.reads.mock.callCount()
    for (let i = 0; i < 10; i++) await p.tick(60)
    assert.equal(p.reads.mock.callCount(), settled)

    await p.session.start()
    p.append('first output of replacement PTY\n')
    await p.publish('running')
    await p.tick(1)
    assert.equal(p.session.snapshot().native.id, '2')
    assert.deepEqual(p.writes, ['ready\n', ...pages, 'first output of replacement PTY\n'])
    assert.equal(p.createEmulator.mock.callCount(), 1)
  })
}

test('effect replay with a pending read resumes one stream and final disposal ignores a late reply', async t => {
  const p = fixture(t)
  p.attach()
  await setImmediate()
  await p.session.start()
  await p.publish('running')

  const release = p.holdRead()
  p.append('read during replay\n')
  await p.tick(60)
  const pending = p.reads.mock.callCount()
  p.session.dispose()
  p.session.connect()
  await p.tick(60)
  assert.equal(p.reads.mock.callCount(), pending, 'reconnect cannot stack reads behind the pending reply')
  release()
  await setImmediate()
  await p.tick(1)
  await p.tick(60)
  const active = p.reads.mock.callCount()
  for (let i = 0; i < 3; i++) await p.tick(60)
  assert.equal(p.reads.mock.callCount() - active, 3, 'only one periodic timer remains for the running PTY')
  assert.deepEqual(p.writes, ['read during replay\n'])
  assert.equal(p.createEmulator.mock.callCount(), 1)
  assert.equal(p.disposeEmulator.mock.callCount(), 0)

  const releaseFinal = p.holdRead()
  p.append('late reply\n')
  await p.tick(60)
  const finalRead = p.reads.mock.callCount()
  p.session.dispose()
  releaseFinal()
  await setImmediate()
  await p.tick(600)
  assert.deepEqual(p.writes, ['read during replay\n'])
  assert.equal(p.reads.mock.callCount(), finalRead)
  assert.equal(p.disposeEmulator.mock.callCount(), 1)
})

test('effect replay during initial synchronization retains one discovery and one emulator', async t => {
  const p = fixture(t)
  p.attach()
  p.session.dispose()
  p.session.connect()
  await setImmediate()
  await p.tick(600)
  assert.equal(p.reads.mock.callCount(), 1)
  assert.equal(p.createEmulator.mock.callCount(), 1)
  assert.equal(p.disposeEmulator.mock.callCount(), 0)
})

test('temporary bridge rejection and unsuccessful read recover without replaying the previous page', async t => {
  const p = fixture(t, 'reject')
  await setImmediate()
  assert.ok(p.session.snapshot().feedback)
  p.setNative('running', { id: 'existing' })
  p.append('initial page\n')
  await p.tick(60)
  assert.equal(p.session.snapshot().native.id, 'existing')
  assert.deepEqual(p.writes, ['initial page\n'])
  p.failNextRead('result')
  p.append('after failure\n')
  await p.tick(1)
  assert.equal(p.session.snapshot().feedback, 'temporary read failure')
  await p.tick(60)
  assert.deepEqual(p.writes, ['initial page\n', 'after failure\n'])
})

test('persistent discovery failure stops after one retry and explicit reconnect can recover', async t => {
  const p = fixture(t, 'reject')
  await setImmediate()
  p.failNextRead('result')
  await p.tick(60)
  assert.equal(p.reads.mock.callCount(), 2)
  for (let i = 0; i < 10; i++) await p.tick(60)
  assert.equal(p.reads.mock.callCount(), 2)
  await p.reconnectRunning({ id: 'available-again' })
  assert.equal(p.session.snapshot().native.id, 'available-again')
})

test('immediate restart drains remaining pages of the previous stopped PTY before replacing it', async t => {
  const p = fixture(t)
  await setImmediate()
  await p.session.start()
  await p.publish('running')
  p.session.close()
  await setImmediate()
  assert.equal(p.session.snapshot().native.phase, 'closing')
  const first = 'X'.repeat(TERMINAL_PAGE_LIMIT), last = 'final bytes before termination\n'
  p.append(first + last)
  await p.publish('closed')
  assert.deepEqual(p.writes, [first])
  await p.session.start()
  assert.equal(p.session.snapshot().native.id, '2')
  assert.deepEqual(p.writes, [first, last])
  p.append('second shell\n')
  await p.publish('running')
  assert.deepEqual(p.writes, [first, last, 'second shell\n'])
})

test('reconnect discards the old offset when discovering a different native PTY', async t => {
  const p = fixture(t)
  await setImmediate()
  await p.session.start()
  p.append('old\n')
  await p.publish('exited')
  await p.tick(1)
  p.setNative('running', { id: 'replacement' })
  p.append('replacement output\n')
  p.session.connect()
  await setImmediate()
  await p.tick(1)
  await p.tick(1)
  assert.equal(p.session.snapshot().native.id, 'replacement')
  assert.deepEqual(p.writes, ['old\n', 'replacement output\n'])
})
