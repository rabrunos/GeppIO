import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { DEFAULT_FREEFORM, FREEFORM_KEY } from '../src/shared/freeform/policy.ts'

/** Disposable, built Windows renderer; opt-in diagnostics never extend the native bridge. */
const temporary = await mkdtemp(join(tmpdir(), 'geppio-smoke-performance-'))
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), GEPPIO_TEST_USER_DATA: temporary, NODE_ENV: 'production' }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
type Sample = { ms: number; states: number; probes: number; candidates: number; affected: number; status: string }
type Profile = { samples: Sample[]; frames: number[]; pointers: number[]; commits: number[]; nextFrames: number[]; running: boolean; last: number }
type ProfileWindow = Window & { freeformProfile: Profile }
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * .95)] ?? 0, max: sorted.at(-1) ?? 0 }
}
try {
  application = await electron.launch({ args: ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])], env, timeout: 30000 })
  const page = await application.firstWindow(); await page.getByTestId('edit-layout').waitFor()
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1100))
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-surface="main"]')!.clientHeight >= 620)
  const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
  await settle()
  for (let i = 0; i < 5; i++) {
    const delta = await page.evaluate(() => { const port = document.querySelector<HTMLElement>('[data-surface="main"]')!; return { width: innerWidth + 960 - port.clientWidth, height: innerHeight + 620 - port.clientHeight } })
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await application.evaluate(({ BrowserWindow }, { size, viewport }) => {
      const win = BrowserWindow.getAllWindows()[0]!, content = win.getContentSize()
      win.setContentSize(Math.round(size.width * content[0]! / viewport.width), Math.round(size.height * content[1]! / viewport.height))
    }, { size: delta, viewport })
    await settle()
  }
  const size = await page.locator('[data-surface="main"]').evaluate(e => ({ width: (e as HTMLElement).clientWidth, height: (e as HTMLElement).clientHeight }))
  assert.ok(Math.abs(size.width - 960) <= 1 && Math.abs(size.height - 620) <= 1, JSON.stringify(size))
  const fixture = structuredClone(DEFAULT_FREEFORM); fixture.reference.main = size
  await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify(fixture)), { key: FREEFORM_KEY, fixture })
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Largura da Sidebar"]')!.getAttribute('aria-valuenow')) > 0)
  await settle(); await page.getByTestId('edit-layout').click(); await settle()
  await page.evaluate(() => {
    performance.mark('geppio:profile')
    const profile: Profile = { samples: [], frames: [], pointers: [], commits: [], nextFrames: [], running: true, last: 0 }
    ;(window as unknown as ProfileWindow).freeformProfile = profile
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.name === 'geppio:reflow') profile.samples.push({ ms: entry.duration, ...(entry as PerformanceMeasure).detail })
    }).observe({ entryTypes: ['measure'] })
    // Mutation delivery observes completed geometry DOM commits; the following RAF is
    // a scheduling proxy. Neither claims GPU paint or React component render duration.
    let lastCommit = -1
    new MutationObserver(() => {
      const solve = performance.getEntriesByName('geppio:reflow').at(-1)
      if (!solve || solve.startTime === lastCommit) return
      lastCommit = solve.startTime; profile.commits.push(performance.now() - solve.startTime)
      requestAnimationFrame(() => profile.nextFrames.push(performance.now() - solve.startTime))
    }).observe(document.querySelector('.freeform-layer')!, { attributes: true, subtree: true, attributeFilter: ['data-x', 'data-y', 'data-w', 'data-h', 'style'] })
    document.addEventListener('pointermove', () => profile.pointers.push(performance.now()))
    const frame = (time: number) => { if (!profile.running) return; if (profile.last) profile.frames.push(time - profile.last); profile.last = time; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  })
  for (const [id, direction, dx, dy] of [['summary', 's', 0, 200], ['notes', 's', 0, 200], ['properties', 'move', 300, 300], ['library', 'se', 300, 300]] as const) {
    if (await page.getByTestId('edit-layout').count()) await page.getByTestId('edit-layout').click()
    await settle()
    const selector = `[data-widget="${id}"] ${direction === 'move' ? '.widget-grip' : `[data-resize="${direction}"]`}`
    const box = await page.locator(selector).boundingBox(); assert.ok(box)
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await page.mouse.move(x, y); await page.mouse.down()
    for (let reversal = 0; reversal < 2; reversal++) {
      await page.mouse.move(x + dx, y + dy, { steps: 40 }); await page.mouse.move(x, y, { steps: 40 })
    }
    await page.keyboard.press('Escape'); await page.mouse.up()
  }
  const profile = await page.evaluate(() => { const p = (window as unknown as ProfileWindow).freeformProfile; p.running = false; return p })
  const evidence = { label: process.argv.includes('--baseline') ? 'baseline' : 'corrected', dpr: await page.evaluate(() => devicePixelRatio), viewport: size,
    solver: distribution(profile.samples.map(p => p.ms)), frames: distribution(profile.frames),
    solveToDOMCommit: distribution(profile.commits), solveToNextFrame: distribution(profile.nextFrames),
    pointerIntervals: distribution(profile.pointers.slice(1).map((p, i) => p - profile.pointers[i]!)),
    affected: distribution(profile.samples.map(p => p.affected)), states: distribution(profile.samples.map(p => p.states)),
    probes: distribution(profile.samples.map(p => p.probes)), candidates: distribution(profile.samples.map(p => p.candidates)), samples: profile.samples }
  assert.ok(profile.samples.some(p => p.affected >= 3), 'Must exercise real multi-widget rearrangement')
  await mkdir('.local/diagnostics', { recursive: true })
  const name = `freeform-${evidence.label}-latency-${evidence.dpr}`
  await writeFile(`.local/diagnostics/${name}.json`, JSON.stringify(evidence, null, 2))
  await page.screenshot({ path: `.local/diagnostics/${name}.png` })
  console.log(JSON.stringify({ ...evidence, samples: undefined }, null, 2))
} finally { await application?.close(); await rm(temporary, { recursive: true, force: true }) }
