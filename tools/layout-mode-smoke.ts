import type { Page } from 'playwright'

/** Explicit UI selection, never a persisted mode or a production test bypass. */
export async function selectLayoutMode(page: Page, engine: 'responsive' | 'horizontal') {
  await page.getByRole('button', { name: 'Abrir configurações', exact: true }).click()
  await page.getByRole('combobox', { name: 'Layout experimental', exact: true }).selectOption(engine)
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click()
  await page.locator(`[data-engine="${engine}"]`).waitFor()
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}
export async function reloadResponsive(page: Page) {
  await page.reload(); await page.getByTestId('edit-layout').waitFor(); await selectLayoutMode(page, 'responsive')
}
