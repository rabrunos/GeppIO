import type { Locator, Page } from 'playwright'
/** A persisted controlled switch changes only after Main accepts the transaction. */
export async function enableDeveloperMode(scope: Locator | Page): Promise<void> {
  const control = scope.getByRole('switch', { name: 'Modo desenvolvedor', exact: true })
  if (!await control.isChecked()) await control.click()
  await scope.getByRole('button', { name: 'Carregar pasta local', exact: true }).waitFor()
}
