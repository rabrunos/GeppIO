import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import { document as essentialsDocument, emptyModel } from '../examples/plugins/workspace-essentials/src/model.ts'
import { emptyTracker, pauseTimer, startTimer, trackerDocument } from '../examples/plugins/time-tracker/src/model.ts'
import { PluginStore } from '../src/main/plugins.ts'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { applyDocumentChanges } from '../src/shared/document-edits.ts'
import { DOCUMENT_LIMIT, editorText } from '../src/shared/documents.ts'
import { portugueseFixture } from './freeform-smoke.ts'
import { electron } from './test-electron.ts'

const sampleCount = 20
const pilots = ['geppio.time-tracker', 'geppio.workspace-essentials'] as const
function distribution(samples: number[]) {
  assert.equal(samples.length, sampleCount)
  const ordered = [...samples].sort((a, b) => a - b)
  return { n: ordered.length, p50Ms: ordered[Math.ceil(ordered.length * .50) - 1]!, p95Ms: ordered[Math.ceil(ordered.length * .95) - 1]!, samplesMs: samples }
}

function fixture(targetBytes: number, eols: string[]) {
  const line = 'x café 🌱 – ' + '0123456789'.repeat(6)
  const block = eols.map(eol => line + eol).join('')
  const text = block.repeat(Math.floor(targetBytes / Buffer.byteLength(block)))
  const rawOffset = text.indexOf('x', Math.floor(text.length / 2))
  const offset = editorText(text.slice(0, rawOffset)).length
  return { text, rawOffset, offset }
}
type TextFixture = ReturnType<typeof fixture>
function pureEdits({ text, rawOffset, offset }: TextFixture) {
  const expected = text.slice(0, rawOffset) + 'z' + text.slice(rawOffset + 1)
  const changes = [{ rangeOffset: offset, rangeLength: 1, text: 'z' }]
  const durations: number[] = []
  for (let i = 0; i <= sampleCount; i++) {
    const start = performance.now()
    const result = applyDocumentChanges(text, changes)
    const duration = performance.now() - start
    assert.ok(result === expected, 'Pure edit must preserve every untouched character and EOL')
    if (i > 0) durations.push(duration)
  }
  return distribution(durations)
}

async function rendererEdits(page: Page, source: TextFixture) {
  const host = page.locator('.monaco-host')
  const durations: number[] = []
  for (let i = 0; i <= sampleCount; i++) {
    const expected = i % 2 ? 'x' : 'z'
    const range = await host.evaluate((node, offset) => {
      const editor = (node as MonacoHost).monacoEditor!, model = editor.getModel()!
      const position = model.getPositionAt(offset)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column, endColumn: position.column + 1 }
      editor.setSelection(range); editor.revealLineInCenterIfOutsideViewport(position.lineNumber); editor.focus()
      return range
    }, source.offset)
    const start = performance.now()
    await page.keyboard.insertText(expected)
    const actual = await host.evaluate(async (node, range) => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      return (node as MonacoHost).monacoEditor!.getModel()!.getValueInRange(range)
    }, range)
    const duration = performance.now() - start
    assert.equal(actual, expected)
    if (i > 0) durations.push(duration)
  }
  return distribution(durations)
}

interface Activation { start: number; done: number; activations: number; reads: number; confirmedReads: number }
interface ObservedWindow extends Window { pilotActivation: Record<string, Activation> }
async function initialSync(page: Page) {
  // This observer runs in each fresh renderer, never in the application bundle.
  await page.addInitScript(ids => {
    const observations: Record<string, Activation> = {}
    const observedWindow = window as unknown as ObservedWindow
    observedWindow.pilotActivation = observations
    window.Worker = class extends Worker {
      private created: number
      private pilot?: Activation
      private activationId?: number
      private readIds = new Set<number>()
      constructor(script: string | URL, options?: WorkerOptions) {
        const start = performance.now()
        super(script, options)
        this.created = start
        this.addEventListener('message', ({ data }) => {
          if (!this.pilot) return
          if (data.type === 'data' && data.operation === 'read') { this.pilot.reads++; this.readIds.add(data.id) }
          if (data.type === 'done' && data.requestId === this.activationId) this.pilot.done = performance.now()
        })
      }
      override postMessage(message: { type?: string; requestId?: number; pluginId?: string; id?: number; result?: { ok: boolean; value?: { revision: number; document: unknown } } }, options?: Transferable[] | StructuredSerializeOptions) {
        if (message.type === 'activate' && message.pluginId && ids.includes(message.pluginId)) {
          this.pilot = observations[message.pluginId] ??= { start: this.created, done: 0, activations: 0, reads: 0, confirmedReads: 0 }
          this.pilot.activations++
          this.activationId = message.requestId
        } else if (this.pilot && message.type === 'data-result' && message.id !== undefined && this.readIds.delete(message.id)
          && message.result?.ok && message.result.value?.revision === 1 && message.result.value.document) this.pilot.confirmedReads++
        if (Array.isArray(options)) super.postMessage(message, options)
        else super.postMessage(message, options)
      }
    }
  }, [...pilots] as string[])
  const totals: number[] = [], navigations: number[] = []
  const byPlugin = Object.fromEntries(pilots.map(id => [id, { durations: [] as number[], activations: 0, reads: 0, confirmedReads: 0 }]))
  for (let i = 0; i <= sampleCount; i++) {
    await page.reload()
    await page.getByTestId('edit-layout').waitFor()
    const results = await page.evaluate(() => (window as unknown as ObservedWindow).pilotActivation)
    assert.deepEqual(Object.keys(results).sort(), pilots)
    for (const id of pilots) {
      const observed = results[id]!
      assert.equal(observed.activations, 1); assert.equal(observed.reads, 1); assert.equal(observed.confirmedReads, 1)
      assert.ok(observed.done >= observed.start)
      if (!i) continue
      const plugin = byPlugin[id]!
      plugin.activations += observed.activations; plugin.reads += observed.reads; plugin.confirmedReads += observed.confirmedReads
      plugin.durations.push(observed.done - observed.start)
    }
    if (i) {
      const lastAck = Math.max(...Object.values(results).map(value => value.done))
      totals.push(lastAck - Math.min(...Object.values(results).map(value => value.start)))
      navigations.push(lastAck)
    }
  }
  return { workerSync: distribution(totals), navigationToFinalAck: distribution(navigations),
    plugins: Object.fromEntries(Object.entries(byPlugin).map(([id, { durations, ...counts }]) => [id, { ...counts, workerSync: distribution(durations) }])) }
}

async function seedPilots(profile: string) {
  const store = new PluginStore(join(profile, 'GeppIO/plugins'))
  const sources = [
    { name: 'time-tracker', document: trackerDocument(pauseTimer(startTimer(emptyTracker(), 1000, 'session.00000000-0000-4000-8000-000000000001'), 2000)) },
    { name: 'workspace-essentials', document: essentialsDocument({ ...emptyModel(), scratch: 'Café 🌱' }) }
  ]
  for (const source of sources) {
    const id = 'geppio.' + source.name
    const inventory = await store.install(resolve('.local/plugin-packages', source.name))
    const installed = inventory.plugins.find(p => p.manifest.id === id)!
    await store.setEnabled(id, true)
    const token = await store.beginData(1, id, installed.revision)
    const saved = await store.dataOperation(1, token, 'write', 0, source.document)
    assert.equal(saved.revision, 1); store.endData(1, token)
  }
}

export async function measureAppHost(env: Record<string, string>) {
  const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-measurements-'))
  let app: ElectronApplication | undefined
  try {
    const fixtureRoot = await realpath(profile)
    await seedPilots(profile)
    app = await electron.launch({ args: ['.'], env: { ...env, GEPPIO_TEST_USER_DATA: profile } })
    const page = await app.firstWindow(), errors: string[] = []
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(1200, 800); win.show(); win.focus() })
    await page.getByTestId('edit-layout').waitFor(); await portugueseFixture(page)
    const sync = await initialSync(page)
    await page.locator('.experience-switch').getByRole('button', { name: 'GeppIO Code', exact: true }).click()
    const documents = []
    for (const [size, bytes] of [['small', 4096], ['near-limit', DOCUMENT_LIMIT - 4096]] as const) {
      for (const [eol, lines] of Object.entries({ lf: ['\n'], crlf: ['\r\n'], mixed: ['\r', '\n', '\r\n'] })) {
        const source = fixture(bytes, lines), name = size + '-' + eol + '.txt', file = join(fixtureRoot, name)
        const transform = pureEdits(source)
        await writeFile(file, source.text)
        await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
        await page.getByRole('button', { name: 'Abrir arquivo', exact: true }).click()
        await page.locator('[data-document-tab][aria-selected="true"]').filter({ hasText: name }).waitFor()
        const interaction = await rendererEdits(page, source)
        await page.keyboard.press('Control+s')
        await page.locator('.file-editor[data-document-status="clean"]').waitFor()
        const expected = source.text.slice(0, source.rawOffset) + 'z' + source.text.slice(source.rawOffset + 1)
        assert.ok(await readFile(file, 'utf8') === expected, 'Saved bytes must match the expected replacement for ' + name)
        documents.push({ size, eol, utf8Bytes: Buffer.byteLength(source.text), transform, interaction })
      }
    }
    assert.deepEqual(errors, [])
    const result = {
      scenario: 'Production build, one disposable profile, seeded revision 1, one warmup excluded per scenario; 20 repeated samples, nearest-rank percentiles; no performance threshold.',
      clocks: { transform: 'Node performance.now around applyDocumentChanges only, one middle ASCII replacement, Unicode throughout.',
        interaction: 'Node performance.now from Playwright insertText through checked Monaco range after next renderer animation frame; includes automation and frame scheduling, excludes selection, open and save.',
        workerSync: 'Renderer performance.now from first pilot Worker construction to last activation done; per-pilot duration is construction to its own done. Counts exclude warmup.',
        navigationToFinalAck: 'Renderer performance.now since fresh document navigation to last activation done, including inventory and other startup. Same warm Electron process, repeated renderer reloads.' },
      environment: { os: platform(), release: release(), architecture: arch(), node: process.version, ...await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome })), dpr: await page.evaluate(() => devicePixelRatio) },
      documents, sync
    }
    const directory = resolve('.local/diagnostics/alpha60-performance')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log('PASS App Host measurements: six document fixtures and two first-party plugin activations; .local/diagnostics/alpha60-performance/result.json')
  } finally {
    try { await app?.close() } finally { await rm(profile, { recursive: true, force: true }) }
  }
}
