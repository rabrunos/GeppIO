import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IDENTITY } from '../src/shared/identity.ts'
const temporary = await mkdtemp(join(tmpdir(), 'semnome-smoke-'))
await mkdir('.local/diagnostics', { recursive: true })
const env: Record<string, string> = {
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  SEMNOME_TEST_USER_DATA: temporary,
  NODE_ENV: 'production'
}
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.NODE_OPTIONS
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  application = await electron.launch({ args: ['.'], cwd: process.cwd(), env, timeout: 30000 })
  const page = await application.firstWindow(); const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByTestId('edit-layout').waitFor()
  if (await page.locator('[data-widget]').count() !== 7) throw new Error('Expected seven main fixtures')
  for (const region of ['sidebar', 'main', 'bottom']) if (await page.locator(`[data-region="${region}"]`).count() !== 1) throw new Error('Missing region: ' + region)
  const privileged = await page.evaluate(() => ({ require: 'require' in window, process: 'process' in window, bridge: Object.keys(window.semnome ?? {}) }))
  if (privileged.require || privileged.process || privileged.bridge.some(key => !['name', 'version', 'platform'].includes(key))) throw new Error('Unexpected privileged renderer surface')
  await page.getByTestId('edit-layout').click()
  const initial = await page.locator('[data-widget="chart"]').evaluate(element => { const style = (element as HTMLElement).style; return [style.left, style.top, style.width, style.height] })
  const grip = page.getByRole('button', { name: 'Mover Ritmo', exact: true }); await grip.focus(); await page.keyboard.press('ArrowRight')
  await page.getByTestId('cancel-layout').click()
  await page.waitForFunction(expected => {
    const element = document.querySelector<HTMLElement>('[data-widget="chart"]')
    if (!element) return false
    const style = element.style
    return JSON.stringify([style.left, style.top, style.width, style.height]) === JSON.stringify(expected)
  }, initial)
  await page.getByTestId('edit-layout').click(); await page.getByTestId('save-layout').click()
  const saved = await page.evaluate(key => localStorage.getItem(key), IDENTITY.layoutStorageKey)
  if (!saved) throw new Error('No saved layout')
  await page.getByRole('button', { name: 'Abrir painel', exact: true }).click()
  await page.getByTestId('test-panel').waitFor()
  await page.getByRole('button', { name: 'Recolher painel', exact: true }).click()
  await page.getByRole('button', { name: 'Alternar tema', exact: true }).click()
  if (await page.locator('.workbench').getAttribute('data-theme') !== 'light') throw new Error('Theme change failed')
  await page.reload(); await page.getByTestId('edit-layout').waitFor()
  if (await page.locator('.workbench').getAttribute('data-theme') !== 'light') throw new Error('Theme did not persist')
  await page.screenshot({ path: '.local/diagnostics/desktop-smoke.png' })
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(JSON.stringify({ result: 'passed', platform: process.platform, checks: ['regions', 'fixtures', 'renderer boundary', 'cancel edit', 'save', 'panel', 'theme', 'reload'] }, null, 2))
  console.log('Process metrics (observed sample, not a performance budget):')
  console.log(JSON.stringify(await application.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ type: metric.type, cpu: metric.cpu, memory: metric.memory }))), null, 2))
} finally { if (application) await application.close(); await rm(temporary, { recursive: true, force: true }) }
