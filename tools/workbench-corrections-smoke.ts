import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import type { Page } from 'playwright'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { initialWorkbench, widgetRegistry, WORKBENCH_KEY } from '../tests/fixtures/workbench.ts'
import type { WorkbenchSnapshot } from '../tests/fixtures/workbench.ts'
import { parseWorkbench, serializeWorkbench } from '../src/shared/workbench/codec.ts'
import { moveView } from '../src/shared/workbench/commands.ts'
import { settle } from './freeform-smoke.ts'
import { workbenchDropSmoke } from './workbench-drop-smoke.ts'
import { workbenchCompositionSmoke } from './workbench-composition-smoke.ts'

const canonicalVersion = (JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
const profile = await mkdtemp(join(tmpdir(), 'geppio-smoke-corrections-'))
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined))
env.GEPPIO_TEST_DEMO_WIDGETS = '1'
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL
env.GEPPIO_TEST_USER_DATA = profile; env.NODE_ENV = 'production'
await mkdir('.local/diagnostics/corrections-alpha13', { recursive: true })
await mkdir('.local/diagnostics/compositions-alpha14', { recursive: true })
const application = await electron.launch({ args: ['.', ...(process.argv.includes('--scale125') ? ['--force-device-scale-factor=1.25'] : [])], env })
const observations: unknown[] = []
let page: Page
try {
  page = await application.firstWindow()
  const installNativeEvidence = () => {
    const events: unknown[] = []; Object.assign(window, { correctionPointerEvidence: events })
    const record = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null, pointer = event instanceof PointerEvent ? event : null
      events.push({ time: performance.now(), type: event.type, focused: document.hasFocus(), target: target?.outerHTML.slice(0, 180), point: pointer ? [pointer.clientX, pointer.clientY] : null, buttons: pointer?.buttons })
      if (events.length > 100) events.shift()
    }
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) document.addEventListener(type, record, true)
    window.addEventListener('blur', record); window.addEventListener('focus', record)
  }
  await page.addInitScript(installNativeEvidence); await page.evaluate(installNativeEvidence)
  page.setDefaultTimeout(15000)
  const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error('Renderer error:', error.message) })
  async function size(width: number, height: number) {
    await application.evaluate(({ BrowserWindow }, dimensions) => { const win = BrowserWindow.getAllWindows()[0]!; win.setContentSize(dimensions.width, dimensions.height); win.show(); win.focus() }, { width, height })
    await settle(page)
  }
  await page.getByTestId('edit-layout').waitFor(); await size(1920, 1080)
  async function reset(snapshot: WorkbenchSnapshot = initialWorkbench(), theme = 'light') {
    await page.evaluate(({ key, value, theme }) => { localStorage.clear(); localStorage.setItem(key, value); localStorage.setItem('geppio.locale', 'pt-BR'); localStorage.setItem('geppio:theme:v1', theme) }, { key: WORKBENCH_KEY, value: serializeWorkbench(snapshot, widgetRegistry()), theme })
    await page.reload(); await page.getByTestId('edit-layout').waitFor(); await settle(page)
  }
  async function profileMenu() { await page.getByRole('button', { name: 'Abrir menu do perfil', exact: true }).click() }
  async function settings() { await profileMenu(); await page.getByRole('menuitem', { name: 'Abrir configurações', exact: true }).click(); return page.getByTestId('plugin-settings') }
  async function record(name: string) {
    await page.evaluate(() => document.fonts.ready); await settle(page)
    observations.push({ name, ...(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, userAgent: navigator.userAgent, theme: document.documentElement.dataset.theme,
      regions: [...document.querySelectorAll<HTMLElement>('[data-region]')].map(node => ({ region: node.dataset.region, box: node.getBoundingClientRect().toJSON() })) }))) })
    await page.screenshot({ path: `.local/diagnostics/corrections-alpha13/${name}.png` })
  }
  if (!process.argv.includes('--presentation-only') && !process.argv.includes('--compositions-only')) await workbenchDropSmoke(page, reset, observations)
  if (!process.argv.includes('--presentation-only') && !process.argv.includes('--drops-only')) await workbenchCompositionSmoke(page, reset, observations)
  if (!process.argv.includes('--drops-only') && !process.argv.includes('--compositions-only')) {
  // AC-G01/G02: real host content at the original shell minima, no recovery.
  for (const theme of ['light', 'dark']) {
    const snapshot = initialWorkbench(); snapshot.organization.chrome.sidebar.size = 180; snapshot.organization.chrome.bottom.size = 125
    await reset(snapshot, theme)
    assert.equal(await page.locator('[data-region="sidebar"]').evaluate(node => node.getBoundingClientRect().width), 180)
    const sidebarWidth = Number(await page.locator('[data-surface="sidebar"]').getAttribute('data-usable-width'))
    const dpr = await page.evaluate(() => devicePixelRatio)
    // Thin native gutter pixels quantize at fractional DPR; clientWidth is an
    // integer CSS measure (150 at DPR1, 151 observed at DPR1.25). Keep the outer
    // 180px contract and all feasibility/content checks strict.
    assert.ok(sidebarWidth >= 150 && sidebarWidth <= 150 + (Number.isInteger(dpr) ? 0 : 1), `Native Sidebar usable width: ${sidebarWidth} at DPR ${dpr}`)
    assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-usable-height'), '105')
    assert.equal(await page.locator('[data-surface="sidebar"]').getAttribute('data-feasible'), 'true')
    assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true')
    assert.equal(await page.getByTestId('bottom-recovery').count(), 0)
    const content = await page.locator('[data-widget="library"] .widget-content').evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth, count: node.querySelectorAll('.library-tile').length }))
    assert.equal(content.count, 4); assert.ok(content.scrollWidth <= content.width + 1, JSON.stringify(content))
    const chart = await page.locator('[data-widget="chart"]').evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, caption: node.querySelector('.fixture-caption')!.getBoundingClientRect().bottom }))
    assert.ok(chart.caption <= chart.bottom + .1, JSON.stringify(chart))
    await record(`${theme}-minimum-180-125`)
    for (const [width, height] of [[1912, 907], [1920, 1025], [1000, 720]]) { await size(width!, height!); assert.equal(await page.locator('[data-surface="sidebar"]').getAttribute('data-feasible'), 'true'); assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true'); await record(`${theme}-${width}x${height}`) }
    await size(1920, 1080)
  }
  // RAIL-CLICK: short press/jitter never reparents nodes or reorders the rail.
  const bars = initialWorkbench()
  bars.organization.bars.push({ id: 'bar:a', name: 'A literal', userNamed: true, icon: 'widgets', archived: false, members: ['host:notes'] }, { id: 'bar:b', name: 'B literal', userNamed: true, icon: 'folder', archived: false, members: ['host:library'] })
  bars.organization.activeBar = 'bar:b'; await reset(bars)
  await page.getByTestId('edit-layout').click(); await settle(page)
  const order = () => page.locator('.sidebar-rail [data-bar-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-bar-id')))
  const rail = (id: string) => page.locator(`.sidebar-rail [data-bar-id="${id}"]`)
  for (const id of ['bar:a', 'bar:b', 'home', 'bar:a', 'bar:a']) {
    await rail(id).click(); await page.waitForFunction(id => document.querySelector('.workbench')!.getAttribute('data-active-bar') === id, id)
    assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'docked')
    assert.deepEqual(await order(), ['home', 'bar:a', 'bar:b'])
  }
  const tiny = await rail('bar:b').boundingBox(); assert.ok(tiny)
  await rail('bar:b').evaluate(node => node.setAttribute('data-proof', 'stable'))
  await page.mouse.move(tiny.x + 15, tiny.y + 15); await page.mouse.down(); await page.mouse.move(tiny.x + 17, tiny.y + 15); await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.workbench')!.getAttribute('data-active-bar') === 'bar:b')
  assert.equal(await rail('bar:b').getAttribute('data-proof'), 'stable')
  const from = await rail('bar:b').boundingBox(), to = await rail('bar:a').boundingBox(); assert.ok(from && to)
  await page.mouse.move(from.x + 15, from.y + 15); await page.mouse.down(); await page.mouse.move(to.x + 15, to.y + 2, { steps: 5 }); await page.mouse.up(); await settle(page)
  assert.deepEqual(await order(), ['home', 'bar:b', 'bar:a'])
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); await settle(page); assert.deepEqual(await order(), ['home', 'bar:a', 'bar:b'])
  await rail('bar:a').click(); assert.equal(await page.locator('.workbench').getAttribute('data-active-bar'), 'bar:a')
  for (const signal of ['pointercancel', 'blur']) {
    const start = await rail('bar:b').boundingBox(); assert.ok(start)
    await page.mouse.move(start.x + 15, start.y + 15); await page.mouse.down(); await page.mouse.move(start.x + 15, start.y - 12)
    await page.evaluate(signal => { if (signal === 'blur') window.dispatchEvent(new Event('blur')); else window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })) }, signal)
    await page.mouse.up(); await settle(page); assert.deepEqual(await order(), ['home', 'bar:a', 'bar:b'])
    await rail('bar:b').click(); assert.equal(await page.locator('.workbench').getAttribute('data-active-bar'), 'bar:b')
  }
  await page.getByTestId('cancel-layout').click(); await settle(page)
  // AC-V01/V02: component-specific sizes, divider and safe peek gap.
  const icons = await page.evaluate(() => Object.fromEntries(['.breadcrumb-root .icon', '.breadcrumb-current > .icon', '.explorer .icon', '.notification-trigger .icon', '.project-actions > .square .icon', '.sidebar-main-button .icon'].map(selector => [selector, document.querySelector(selector)!.getBoundingClientRect().width])))
  assert.deepEqual(Object.values(icons), [20, 18, 24, 24, 24, 23])
  const divider = await page.locator('.host-rail-panel').evaluate(node => { const style = getComputedStyle(node, '::after'), box = node.getBoundingClientRect(); return { x: box.right + parseFloat(style.right) * -1 - parseFloat(style.width), width: style.width, opacity: style.opacity, mask: style.maskImage } })
  assert.equal(divider.x, 48); assert.equal(divider.width, '1px'); assert.equal(divider.opacity, '0.5'); assert.ok(divider.mask.includes('6px'))
  await page.getByRole('button', { name: 'Recolher barra lateral', exact: true }).click(); await page.mouse.move(700, 500); await settle(page)
  assert.ok(await page.locator('.host-rail-panel').evaluate(node => getComputedStyle(node, '::after').clipPath.includes('1px')), 'The divider leaves with the final pixel of the collapsing content viewport')
  await rail('home').hover(); await page.waitForFunction(() => document.querySelector('.workbench')!.getAttribute('data-sidebar-mode') === 'peek'); await settle(page)
  const peek = await page.locator('.sidebar-floating').boundingBox(); assert.ok(peek); assert.equal(peek.x, 59); assert.equal(peek.width, 238)
  await page.mouse.click(53, peek.y + 70); await page.mouse.move(peek.x + 40, peek.y + 70); assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'peek')
  await page.getByRole('button', { name: 'Fixar barra lateral', exact: true }).click(); await settle(page)
  // A completed resize that returns to its origin is not a short toggle click,
  // even when all native events arrive before React paints another frame.
  const shellSplitter = page.getByRole('separator', { name: 'Largura da Sidebar', exact: true }), shellWidth = await shellSplitter.getAttribute('aria-valuenow'), shellBytes = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  const shellBox = await shellSplitter.boundingBox(); assert.ok(shellBox)
  await page.mouse.move(shellBox.x + shellBox.width / 2, shellBox.y + shellBox.height / 2); await page.mouse.down()
  assert.ok(await shellSplitter.evaluate(node => node.hasPointerCapture(1)))
  await shellSplitter.evaluate(node => { const box = node.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2; for (const delta of [30, 0]) node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: x + delta, clientY: y })); node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: x, clientY: y })) })
  await page.mouse.up(); await settle(page)
  assert.equal(await shellSplitter.getAttribute('aria-valuenow'), shellWidth); assert.equal(await page.locator('.workbench').getAttribute('data-sidebar-mode'), 'docked')
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), shellBytes)
  const bottomSeparator = page.getByRole('separator', { name: 'Altura da Bottom', exact: true })
  await bottomSeparator.press('Enter'); await settle(page); assert.equal(await page.locator('.workbench').getAttribute('data-bottom-mode'), 'hidden')
  await bottomSeparator.press('ArrowUp'); await bottomSeparator.press('Tab'); await settle(page); assert.equal(await bottomSeparator.getAttribute('aria-valuenow'), '125')
  await bottomSeparator.press('End'); await bottomSeparator.press('Tab'); await settle(page); assert.equal(await bottomSeparator.getAttribute('aria-valuenow'), '250')
  // AC-G04/B02: activation boundaries and native nested-popover dismissal.
  const capacity = initialWorkbench()
  capacity.organization.bars.push(...Array.from({ length: 13 }, (_, i) => ({ id: `bar:cap${i}`, name: `Literal ${i}`, userNamed: true, icon: 'widgets', archived: false, members: [] })), { id: 'bar:restore', name: 'Restaurável', userNamed: true, icon: 'widgets', archived: true, members: [] })
  await reset(capacity)
  await page.getByRole('button', { name: 'Nova barra', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Nova barra', exact: true }); await create.getByRole('textbox', { name: 'Nome', exact: true }).fill('Décima quarta')
  await create.getByRole('button', { name: 'Criar barra', exact: true }).click(); await create.waitFor({ state: 'detached' }); assert.equal((await order()).length, 15)
  assert.ok(await page.getByRole('button', { name: 'Nova barra', exact: true }).isDisabled())
  await page.getByRole('button', { name: 'Barras salvas', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Barras salvas', exact: true })
  const archivedCard = library.locator('.bar-library-card').filter({ hasText: 'Restaurável' })
  assert.ok(await archivedCard.getByRole('button', { name: 'Restaurar', exact: true }).isDisabled())
  assert.ok((await library.locator('.bar-library-hint').textContent())!.includes('14 barras personalizadas ativas'))
  await library.getByRole('button', { name: 'Opções de Literal 0', exact: true }).click()
  await library.locator('.workspace-popover-heading h2').click(); assert.ok(await library.isVisible())
  assert.equal(await page.getByRole('menu', { name: 'Opções da barra', exact: true }).isVisible(), false)
  await library.getByRole('button', { name: 'Opções de Literal 0', exact: true }).click(); await page.getByRole('menuitem', { name: 'Arquivar barra', exact: true }).click()
  // The menu closes immediately; outside Edit the rail changes only after the
  // Web Lock/CAS commit succeeds. Wait for that confirmation before counting.
  await rail('bar:cap0').waitFor({ state: 'detached' })
  assert.ok(await library.isVisible(), 'Archiving updates only the child menu and cards')
  assert.equal((await order()).length, 14)
  const archivedBytes = await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY)
  assert.equal(parseWorkbench(archivedBytes!, widgetRegistry()).organization.bars.find(bar => bar.id === 'bar:cap0')!.archived, true)
  await library.getByRole('searchbox').fill('Nenhum resultado Ω'); await library.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  const scroll = library.locator('.bar-library-viewport')
  await scroll.evaluate(node => { node.scrollTop = node.scrollHeight }); await page.waitForFunction(() => document.querySelector('.bar-library-viewport')!.hasAttribute('data-scroll-can-up'))
  assert.equal(await scroll.getAttribute('data-scroll-can-down'), null)
  await scroll.evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) / 2 }); await page.waitForFunction(() => document.querySelector('.bar-library-viewport')!.hasAttribute('data-scroll-can-down'))
  assert.notEqual(await scroll.getAttribute('data-scroll-can-up'), null)
  await library.getByRole('combobox', { name: 'Ordenar barras', exact: true }).selectOption('name')
  await page.waitForFunction(() => document.querySelector('.bar-library-viewport')!.scrollTop === 0 && !document.querySelector('.bar-library-viewport')!.hasAttribute('data-scroll-can-up'))
  await archivedCard.getByRole('button', { name: 'Restaurar', exact: true }).click(); await library.waitFor({ state: 'hidden' })
  await rail('bar:restore').waitFor(); await settle(page)
  assert.equal(await page.locator('.workbench').getAttribute('data-active-bar'), 'bar:restore'); assert.equal((await order()).length, 15)
  // Legacy twenty active custom records remain editable/reducible after reload.
  const legacy = initialWorkbench(); legacy.organization.bars.push(...Array.from({ length: 20 }, (_, i) => ({ id: `bar:old${i}`, name: `Old ${i}`, userNamed: true, icon: 'widgets', archived: false, members: [] })))
  await reset(legacy); assert.equal((await order()).length, 21)
  await rail('bar:old0').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Editar', exact: true }).click()
  const legacyForm = page.getByRole('dialog', { name: 'Editar barra', exact: true }); await legacyForm.getByRole('textbox', { name: 'Nome', exact: true }).fill('Old Ω edited')
  await legacyForm.getByRole('button', { name: 'Salvar alterações', exact: true }).click(); await legacyForm.waitFor({ state: 'detached' })
  await rail('bar:old1').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Arquivar', exact: true }).click()
  await rail('bar:old1').waitFor({ state: 'detached' }); await page.reload(); await page.getByTestId('edit-layout').waitFor()
  assert.equal((await order()).length, 20); assert.equal(await rail('bar:old0').getAttribute('aria-label'), 'Old Ω edited')
  assert.ok(await page.getByRole('button', { name: 'Nova barra', exact: true }).isDisabled())
  await reset(bars)
  // P18/P30/P34: scoped focus, palette dismissal, stable filtered controls.
  await page.getByRole('button', { name: 'Nova barra', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Nova barra', exact: true }), name = form.getByRole('textbox', { name: 'Nome', exact: true })
  assert.ok(await name.evaluate(node => node === document.activeElement)); await name.fill('Não criar com Enter')
  const palette = form.locator('.custom-bar-icon-picker'); await palette.locator('summary').click()
  assert.equal(await palette.getByRole('radio').count(), 13)
  await page.keyboard.press('Escape'); assert.equal(await palette.getAttribute('open'), null); assert.ok(await form.isVisible())
  assert.ok(await palette.locator('summary').evaluate(node => node === document.activeElement))
  const notes = form.locator('.custom-bar-widget').filter({ hasText: 'Ideias em aberto' }).getByRole('checkbox')
  await notes.check(); await notes.evaluate(node => node.setAttribute('data-proof', 'same-control'))
  const search = form.getByRole('searchbox'); await search.fill('Biblioteca'); await page.keyboard.press('Enter')
  assert.ok(await form.isVisible()); assert.deepEqual(await order(), ['home', 'bar:a', 'bar:b'])
  await search.fill(''); assert.equal(await notes.getAttribute('data-proof'), 'same-control'); assert.ok(await notes.isChecked())
  await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
  // P25/SH20: selected check/focus, neutral backdrop and no drag-out dismissal.
  const settingsDialog = await settings()
  assert.ok(await settingsDialog.locator('.profile-theme-option[aria-pressed="true"]').evaluate(node => node === document.activeElement))
  assert.equal(await settingsDialog.locator('.profile-theme-check').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).visibility === 'visible').length), 1)
  const dialogBox = await settingsDialog.boundingBox(); assert.ok(dialogBox)
  await page.mouse.move(dialogBox.x + 30, dialogBox.y + 30); await page.mouse.down(); await page.mouse.move(5, 5); await page.mouse.up(); assert.ok(await settingsDialog.isVisible())
  await page.mouse.click(5, 5); await settingsDialog.waitFor({ state: 'detached' })
  await profileMenu(); await page.getByRole('menuitem', { name: 'Sobre o GeppIO', exact: true }).click()
  const about = page.getByRole('dialog', { name: 'Sobre o GeppIO', exact: true })
  assert.equal(await about.locator('.profile-version').textContent(), canonicalVersion)
  await about.getByText('Seu espaço para criar, organizar e desenvolver.', { exact: true }).waitFor()
  await about.getByRole('button', { name: 'Voltar ao trabalho', exact: true }).click()
  // P32: local typed model/theme history and confirmed Cancel checkpoint.
  await reset(); const model = page.getByRole('textbox', { name: 'Nome de exemplo', exact: true }); await model.fill('Checkpoint Ω')
  await model.evaluate(node => node.setAttribute('data-proof', 'model-identity'))
  await page.getByTestId('edit-layout').click(); await settle(page)
  await model.fill('Draft Ω'); await profileMenu(); await page.getByRole('menuitem', { name: 'Tema escuro', exact: true }).click()
  assert.ok(await page.getByRole('menu', { name: 'Perfil', exact: true }).isVisible(), 'Approved profile stays open on theme change')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); assert.equal(await page.locator('.workbench').getAttribute('data-theme'), 'light')
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); assert.equal(await model.inputValue(), 'Checkpoint Ω')
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); assert.equal(await model.inputValue(), 'Draft Ω')
  await page.getByTestId('save-layout').click(); await page.waitForFunction(() => !document.querySelector('[data-testid="save-layout"]')?.hasAttribute('disabled'))
  await model.fill('After checkpoint'); await page.getByTestId('cancel-layout').click(); await settle(page)
  assert.equal(await model.inputValue(), 'Draft Ω'); assert.equal(await model.getAttribute('data-proof'), 'model-identity')
  // Project/snap share typed history; locale and native text undo stay outside.
  await page.getByTestId('edit-layout').click(); await settle(page)
  await page.getByRole('button', { name: 'Mais opções do projeto', exact: true }).click(); await page.getByRole('menuitem', { name: 'Renomear projeto…', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Renomear projeto', exact: true }); await rename.getByRole('textbox', { name: 'Nome do projeto', exact: true }).fill('Projeto literal Ω'); await rename.getByRole('button', { name: 'Salvar nome', exact: true }).click()
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); assert.equal(await page.locator('.project-text h1').textContent(), 'Laboratório')
  await page.getByRole('button', { name: 'Refazer', exact: true }).click(); assert.equal(await page.locator('.project-text h1').textContent(), 'Projeto literal Ω')
  const snapDialog = await settings(), snap = snapDialog.getByRole('switch', { name: 'Guia e encaixe no centro', exact: true }), wasSnap = await snap.isChecked()
  await snap.click(); await snapDialog.getByRole('button', { name: 'Fechar configurações', exact: true }).click(); await page.getByRole('button', { name: 'Desfazer', exact: true }).click()
  await settings(); assert.equal(await snap.isChecked(), wasSnap); await snapDialog.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  await model.focus(); await model.press('End'); await model.pressSequentially(' native undo'); await model.press('Control+z')
  assert.equal(await page.locator('.project-text h1').textContent(), 'Projeto literal Ω', 'Text undo must not undo session history')
  await page.getByTestId('cancel-layout').click(); await settle(page); assert.equal(await page.locator('.project-text h1').textContent(), 'Laboratório')
  // P10/P11: exact reservation fill, closed-dock reopen, Save retains slots.
  await reset(); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.getByRole('tab', { name: 'Composições', exact: true }).click()
  const focus = page.locator('[data-composition-id="system:focus"] [data-composition-reorder]')
  await focus.click(); await settle(page); await focus.click(); await settle(page)
  const slots = page.locator('.host-format-slot'); assert.equal(await slots.count(), 2)
  await slots.first().click(); await settle(page)
  const selectedId = await slots.first().getAttribute('data-catalog-slot-target'); assert.notEqual(selectedId, null)
  await page.locator('.widget-catalog-toggle').click(); await settle(page); await slots.first().click(); await settle(page)
  assert.equal(await page.locator('.widget-catalog-toggle').getAttribute('aria-expanded'), 'true')
  assert.equal(await slots.first().getAttribute('data-catalog-slot-target'), '')
  const slotBox = await slots.first().boundingBox(); assert.ok(slotBox)
  const tile = page.locator('[data-catalog-type="host:notes"]'); assert.equal(await tile.isDisabled(), false); await tile.click(); await settle(page)
  assert.equal(await slots.count(), 1)
  const filled = page.locator('[data-widget="host:notes:view:main"]'); const filledBox = await filled.boundingBox(); assert.ok(filledBox)
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(filledBox[key] - slotBox[key]) < .1, `${key}: ${JSON.stringify({ filledBox, slotBox })}`)
  assert.equal(await page.getByRole('tab', { name: 'Composições', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByTestId('save-layout').click(); await page.waitForFunction(() => !document.querySelector('[data-testid="save-layout"]')?.hasAttribute('disabled')); assert.equal(await slots.count(), 1)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor(); assert.equal(await slots.count(), 0)
  // AC-C02/C03: library-only intentions and viewport changes are not format edits.
  await reset(bars); await page.getByTestId('edit-layout').click(); await settle(page); await page.getByRole('tab', { name: 'Composições', exact: true }).click()
  await page.getByRole('tab', { name: 'Composições Salvas', exact: true }).click()
  const balanced = page.locator('[data-composition-id="system:balanced"]')
  await balanced.hover(); await balanced.locator('[data-composition-action="default"]').click(); await balanced.locator('[data-composition-action="default"]').click()
  assert.equal(await balanced.locator('.composition-name').evaluate(node => getComputedStyle(node).fontWeight), '400')
  await rail('bar:a').click(); await size(1912, 907); await size(1920, 1080)
  await page.locator('[data-composition-id="system:default"] [data-composition-reorder]').press('Alt+ArrowRight')
  assert.equal(await page.locator('.layout-save-pending').count(), 0)
  await page.getByRole('button', { name: 'Salvar atual', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Salvar nova composição', exact: true }); await save.waitFor()
  assert.ok(await save.getByRole('textbox', { name: 'Nome', exact: true }).evaluate(node => node === document.activeElement))
  await save.getByRole('textbox', { name: 'Nome', exact: true }).fill('Só Main Ω')
  await save.getByRole('checkbox', { name: 'Barra inferior', exact: true }).uncheck(); await save.getByRole('checkbox', { name: 'Largura da barra lateral', exact: true }).uncheck()
  assert.equal(await save.locator('.thumbnail-sidebar,.thumbnail-bottom').count(), 0)
  await save.getByRole('button', { name: 'Salvar composição', exact: true }).click(); await save.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Restaurar layout padrão', exact: true }).click(); await settle(page)
  await page.getByTestId('conclude-layout').click(); await page.getByTestId('edit-layout').waitFor()
  const compositionState = parseWorkbench((await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY))!, widgetRegistry())!
  assert.equal(compositionState.organization.defaultComposition, null); assert.deepEqual(compositionState.organization.compositions[0]!.scopes, ['main'])
  // P19 is test/report only: incompatible old association is rejected intact by
  // the current codec, so no editable picker is reachable. Never auto-repair it.
  const incompatible = initialWorkbench(), previousRegistry = new Map(widgetRegistry()), oldQueue = previousRegistry.get('host:queue')!
  previousRegistry.set(oldQueue.id, { ...oldQueue, constraint: { ...oldQueue.constraint, regions: ['main', 'sidebar'] } })
  const oldQueuePlacement = incompatible.placements.find(p => p.id === 'queue')!
  Object.assign(oldQueuePlacement, { region: 'sidebar', x: 0, y: 550, width: 253, height: 160, preferred: { width: 253, height: 160 } })
  incompatible.organization.bars[0]!.members.push('host:queue'); incompatible.organization.bars[0]!.positions!['host:queue'] = 550
  // This really validates under the isolated prior declaration. Only the current
  // registry drops Sidebar compatibility; no product registry/SDK is modified.
  const incompatibleBytes = serializeWorkbench(incompatible, previousRegistry)
  assert.equal(parseWorkbench(incompatibleBytes, previousRegistry).organization.bars[0]!.members.includes('host:queue'), true)
  assert.throws(() => parseWorkbench(incompatibleBytes, widgetRegistry()), /Invalid Sidebar membership/)
  await page.evaluate(({ key, bytes }) => localStorage.setItem(key, bytes), { key: WORKBENCH_KEY, bytes: incompatibleBytes }); await page.reload()
  await page.getByRole('button', { name: 'Editar layout', exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: 'Editar layout', exact: true }).isDisabled())
  assert.equal(await page.evaluate(key => localStorage.getItem(key), WORKBENCH_KEY), incompatibleBytes)
  await record('legacy-incompatible-recovery')
  // AC-W03/W04/T03: actual header/grip drag and catalog origin distinction.
  await reset(); await page.getByTestId('edit-layout').click(); await settle(page)
  await page.locator('[data-widget="summary"]').hover(); await settle(page)
  await page.locator('[data-widget="summary"] .widget-grip').click(); await page.locator('.widget-browser-destination:not([hidden])').waitFor()
  await page.getByText('Este widget tem uma única presença. Escolha para onde mover.', { exact: true }).waitFor()
  await page.locator('.widget-catalog-toggle').click(); await settle(page)
  const invalidFrame = page.locator('[data-widget="queue"]'), header = await invalidFrame.locator('.widget-heading').boundingBox(); assert.ok(header)
  const invalidBefore = await invalidFrame.evaluate(node => ['data-x', 'data-y', 'data-w', 'data-h'].map(name => node.getAttribute(name)))
  await page.mouse.move(header.x + 100, header.y + 20); await page.mouse.down(); await page.mouse.move(600, 400, { steps: 4 }); await page.locator('.layout-drag-node').waitFor()
  assert.equal(await page.locator('.host-drag-origin').count(), 1)
  await page.mouse.move(150, 300); await page.mouse.up(); await page.locator('.layout-drag-node,.drag-picture-flight').waitFor({ state: 'detached' })
  await page.locator('.workspace-feedback').filter({ hasText: 'Transferência incompatível ou sem espaço.' }).waitFor({ state: 'attached' })
  assert.deepEqual(await invalidFrame.evaluate(node => ['data-x', 'data-y', 'data-w', 'data-h'].map(name => node.getAttribute(name))), invalidBefore)
  await page.waitForFunction(() => !document.querySelector('.workspace-feedback')!.classList.contains('workspace-toast'))
  const persistent = await invalidFrame.getAttribute('class'); observations.push({ name: 'M07-after-toast', className: persistent, invalid: persistent?.split(' ').includes('invalid') })
  await record('invalid-drop-after-toast')
  await page.locator('.widget-catalog-toggle').click(); await settle(page)
  const frame = page.locator('[data-widget="summary"]'), summaryTile = page.locator('[data-catalog-type="host:summary"]'), tileBox = await summaryTile.boundingBox(); assert.ok(tileBox)
  await page.mouse.move(tileBox.x + 20, tileBox.y + 20); await page.mouse.down(); await page.mouse.move(tileBox.x - 40, tileBox.y + 20, { steps: 4 }); await page.locator('.layout-drag-node').waitFor()
  assert.equal(await page.locator('.host-drag-origin').count(), 1); assert.equal(await frame.evaluate(node => getComputedStyle(node).opacity), '0')
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
  const notesTile = page.locator('[data-catalog-type="host:notes"]'), notesBox = await notesTile.boundingBox(); assert.ok(notesBox)
  await page.mouse.move(notesBox.x + 20, notesBox.y + 20); await page.mouse.down(); await page.mouse.move(notesBox.x - 40, notesBox.y + 20, { steps: 4 }); await page.locator('.layout-drag-node').waitFor()
  assert.equal(await page.locator('.host-drag-origin').count(), 0); assert.equal(await page.locator('[data-widget="notes"]').evaluate(node => getComputedStyle(node).opacity), '1')
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page)
  // All-card saturation feedback, including the sibling presence controls.
  const saturated = page.locator('[data-catalog-type="host:queue"]'), saturatedBox = await saturated.boundingBox(); assert.ok(saturatedBox)
  await page.mouse.move(saturatedBox.x + 20, saturatedBox.y + 20); await page.mouse.down(); await page.mouse.move(saturatedBox.x - 40, saturatedBox.y + 20)
  assert.ok(await saturated.evaluate(node => node.parentElement!.getAnimations().length > 0)); assert.equal(await saturated.evaluate(node => node.getAnimations().length), 0)
  await page.mouse.up(); await settle(page); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(saturatedBox.x + 20, saturatedBox.y + 20); await page.mouse.down(); await page.mouse.move(saturatedBox.x - 40, saturatedBox.y + 20)
  assert.equal(await saturated.evaluate(node => node.parentElement!.getAnimations().length), 0); await page.mouse.up()
  // Same engine path for the other eligible Bottom host format at 125px.
  const summaryBottom = initialWorkbench(); summaryBottom.placements = summaryBottom.placements.filter(p => p.id !== 'chart')
  const adapted = moveView(summaryBottom, widgetRegistry(), 'summary', { region: 'bottom', width: 1543, height: 105, expanded: false })!
  assert.ok(adapted); adapted.organization.chrome.bottom.size = 125; await reset(adapted)
  assert.equal(await page.locator('[data-surface="bottom"]').getAttribute('data-feasible'), 'true')
  await record('summary-bottom125')
  const compactSummary = adapted.placements.find(p => p.id === 'summary')!; compactSummary.width = 164; compactSummary.preferred.width = 164
  await reset(adapted)
  const summaryContent = await page.locator('[data-widget="summary"]').evaluate(node => ({ frame: node.getBoundingClientRect().toJSON(), text: node.querySelector('.summary-fixture > p')!.getBoundingClientRect().toJSON() }))
  assert.ok(summaryContent.text.bottom <= summaryContent.frame.bottom, JSON.stringify(summaryContent)); await record('summary-bottom125-minimum-width')
  const compactChart = initialWorkbench(); compactChart.organization.chrome.bottom.size = 125
  const chartPlacement = compactChart.placements.find(p => p.id === 'chart')!; chartPlacement.width = 164; chartPlacement.preferred.width = 164
  await reset(compactChart)
  const chartContent = await page.locator('[data-widget="chart"]').evaluate(node => ({ frame: node.getBoundingClientRect().toJSON(), text: node.querySelector('.fixture-caption')!.getBoundingClientRect().toJSON() }))
  assert.ok(chartContent.text.bottom <= chartContent.frame.bottom, JSON.stringify(chartContent))
  const literalBar = initialWorkbench(); literalBar.organization.bars.push({ id: 'bar:literal', name: 'Ferramentas', userNamed: true, icon: 'widgets', archived: false, members: [] })
  await reset(literalBar); await profileMenu(); await page.getByRole('menuitemradio', { name: 'English', exact: true }).click(); await page.keyboard.press('Escape')
  assert.equal(await rail('bar:literal').getAttribute('aria-label'), 'Ferramentas', 'User names remain literal even when they equal an application translation key')
  assert.equal(await rail('home').getAttribute('aria-label'), 'Tools')
  }
  assert.deepEqual(errors, [])
  await writeFile('.local/diagnostics/corrections-alpha13/observations.json', JSON.stringify(observations, null, 2))
  console.log(process.argv.includes('--compositions-only') ? 'PASS focused native alpha14 composition suite' : process.argv.includes('--drops-only') ? 'PASS focused native drops: six region directions, scrolled custom bar, landing geometry, exact catalog/existing reservation drop, hover/cancel/duplicate/history, themes and reduced motion' : 'PASS approved corrections and native drops: minima/themes/viewports, rail click/jitter/reorder/cancel/blur, 14/legacy20 bars/library/scroll, focus/backdrop, local history/checkpoint, exact slots, format/library scope, preserved incompatible bytes, catalog origins/reduced motion and observed post-toast outline')
} catch (error) {
  if (page!) {
    await page.screenshot({ path: '.local/diagnostics/corrections-alpha13/failure.png' })
    const pointer = await page.evaluate(() => ({ events: Reflect.get(window, 'correctionPointerEvidence'), feedback: document.querySelector('.workspace-feedback')?.textContent, host: { ...(document.querySelector<HTMLElement>('.workbench')?.dataset ?? {}) } }))
    await writeFile('.local/diagnostics/corrections-alpha13/pointer-failure.json', JSON.stringify(pointer, null, 2)); console.error('Correction pointer evidence:', JSON.stringify(pointer))
  }
  throw error
} finally {
  await application.close()
  assert.ok(isAbsolute(profile) && profile.startsWith(join(tmpdir(), 'geppio-smoke-corrections-')))
  await rm(profile, { recursive: true, force: true })
}
