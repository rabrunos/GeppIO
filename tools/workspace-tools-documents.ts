import assert from 'node:assert/strict'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'
import { fileEditor } from './monaco-support.ts'

/** Continue the same disposable Code session with its active dirty buffer, PTY and plugin. */
export async function exerciseWorkspaceFiles(app: ElectronApplication, page: Page, project: string): Promise<void> {
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const item = (name: string) => page.getByRole('tree', { name: 'Arquivos da pasta' }).getByRole('treeitem', { name, exact: true })
  const state = page.locator('.file-editor'), host = page.locator('.monaco-host'), editor = fileEditor(page)
  const idle = () => page.waitForFunction(() => !document.querySelector('.file-explorer[aria-busy="true"], .workspace-controls[aria-busy="true"], .file-editor[data-document-status="busy"]'))
  async function activity(name: string) {
    const control = button(name)
    if (await control.getAttribute('aria-pressed') !== 'true') await control.click()
  }
  async function submit(trigger: string, title: string, field: string, value: string, action: string) {
    await button(trigger).press('Enter')
    const dialog = page.getByRole('dialog', { name: title, exact: true })
    await dialog.getByRole('textbox', { name: field, exact: true }).fill(value)
    await dialog.getByRole('button', { name: action, exact: true }).press('Enter')
    await dialog.waitFor({ state: 'detached' }); await idle()
  }
  async function reloadDecision(choice: number) {
    const receipt = await app.evaluateHandle(({ dialog }, choice) => {
      const original = dialog.showMessageBox, result = { observed: false }
      dialog.showMessageBox = (async (_win, options) => {
        dialog.showMessageBox = original
        result.observed = options.title === 'Recarregar do disco' && options.defaultId === 0 && options.cancelId === 0 &&
          options.buttons?.[0] === 'Cancelar' && options.buttons[1] === 'Descartar rascunho e recarregar'
        return { response: choice, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      return result
    }, choice)
    await button('Recarregar do disco').press('Enter'); await idle()
    assert.ok((await receipt.jsonValue()).observed); await receipt.dispose()
  }

  const dirty = 'rascunho preservado\n', original = await readFile(join(project, 'modified.ts'), 'utf8')
  assert.equal(await editor.inputValue(), dirty)
  const retained = await state.getAttribute('data-document-id'); assert.ok(retained)
  const model = await host.evaluateHandle(node => (node as MonacoHost).monacoEditor!.getModel()!)
  const folder = 'leitura-final', first = 'registro.txt', last = 'resultado.txt'
  const marker = 'busca-salva-meio69', saved = marker + '\n', external = 'versão externa confirmada\n', final = 'resultado confirmado após recarga\n'
  const directory = join(project, folder), path = join(directory, first)
  await activity('Explorador')
  const projectItem = item(basename(project)), root = await projectItem.getAttribute('data-explorer-node')
  assert.ok(root)
  await projectItem.focus()
  await submit('Nova pasta', 'Criar pasta', 'Nome da pasta', folder, 'Criar')
  await item(folder).waitFor(); assert.deepEqual(await readdir(directory), [])
  await item(folder).focus(); await submit('Novo arquivo', 'Criar arquivo', 'Nome do arquivo', first, 'Criar')
  await page.getByRole('tab', { name: /registro\.txt/ }).waitFor()
  assert.deepEqual(await readFile(path), Buffer.alloc(0))
  const created = await state.getAttribute('data-document-id'); assert.ok(created && created !== retained)
  await editor.fill(saved); await editor.press('Control+s')
  await page.locator('.file-editor[data-document-status="clean"]').waitFor()
  assert.equal(await readFile(path, 'utf8'), saved)

  await activity('Busca no projeto')
  const search = page.getByRole('region', { name: 'Busca no projeto', exact: true })
  const field = search.getByRole('textbox', { name: 'Texto a buscar' })
  await field.fill(marker); await field.press('Enter')
  const match = search.getByRole('button', { name: 'Abrir ' + folder + '/' + first + ', linha 1, coluna 1', exact: true })
  await match.waitFor(); assert.equal(await match.locator('mark').textContent(), marker)
  await match.press('Enter'); await idle()
  assert.equal(await state.getAttribute('data-document-id'), created)
  await button('Abrir arquivo do projeto...').press('Enter')
  const quick = page.getByRole('dialog', { name: 'Abrir arquivo do projeto', exact: true })
  await quick.getByRole('textbox', { name: 'Nome ou caminho relativo' }).fill('modified.ts')
  await quick.getByRole('button', { name: 'modified.ts', exact: true }).press('Enter')
  await quick.waitFor({ state: 'detached' }); await idle()
  assert.equal(await state.getAttribute('data-document-id'), retained); assert.equal(await editor.inputValue(), dirty)
  assert.ok(await host.evaluate((node, held) => (node as MonacoHost).monacoEditor!.getModel() === held, model))
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), original.replaceAll('\r\n', '\n'))
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), dirty)
  await page.locator('[data-document-tab="' + created + '"]').press('Enter'); await idle()
  assert.equal(await state.getAttribute('data-document-id'), created)
  await writeFile(path, external); await button('Recarregar do disco').press('Enter'); await idle()
  assert.equal(await editor.inputValue(), external)
  await editor.fill('rascunho no arquivo de teste'); await writeFile(path, final)
  await reloadDecision(0); assert.equal(await editor.inputValue(), 'rascunho no arquivo de teste')
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), external)
  await editor.press('Control+y'); assert.equal(await editor.inputValue(), 'rascunho no arquivo de teste')
  await reloadDecision(1); assert.equal(await editor.inputValue(), final)
  await editor.press('Control+z'); assert.equal(await editor.inputValue(), final)

  await activity('Explorador'); await button('Atualizar árvore').press('Enter'); await idle()
  if (await item(folder).getAttribute('aria-expanded') !== 'true') { await item(folder).press('ArrowRight'); await idle() }
  const fileNode = await item(first).getAttribute('data-explorer-node'); assert.ok(fileNode)
  const refused = await page.evaluate(({ root, fileNode, last }) => window.geppio!.explorer.renameFile(root, fileNode, last), { root, fileNode, last })
  assert.equal(refused.outcome, 'refused'); assert.equal(await readFile(path, 'utf8'), final)
  await assert.rejects(stat(join(directory, last)), { code: 'ENOENT' })
  await button('Fechar arquivo').press('Enter')
  await page.locator('[data-document-tab="' + created + '"]').waitFor({ state: 'detached' }); await idle()

  const old = await page.evaluate(async ({ root, relative, needle }) => {
    const { search, quickOpen } = window.geppio!
    const names = await quickOpen.start(root, relative), text = await search.start(root, needle, true)
    if (!names.ok || !text.ok) throw new Error('Expected authorized search jobs')
    const end = Date.now() + 15000
    while (Date.now() < end) {
      const a = await quickOpen.read(names.value.job, relative), b = await search.read(text.value.job, 0)
      if (!a.ok || !b.ok) throw new Error('Expected active search jobs')
      const file = a.value.items.find(item => item.file === relative), match = b.value.items.find(item => item.file === relative)
      if (file && match) return { nameJob: a.value.job, nameId: file.id, textJob: b.value.job, textId: match.id }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('Timed out waiting for the two current result IDs')
  }, { root, relative: folder + '/' + first, needle: final.trim() })
  await item(first).focus(); await submit('Renomear arquivo', 'Renomear arquivo', 'Novo nome', last, 'Renomear')
  await item(last).waitFor()
  assert.equal(await readFile(join(directory, last), 'utf8'), final)
  await assert.rejects(stat(path), { code: 'ENOENT' })
  const stale = await page.evaluate(async old => {
    const { search, quickOpen } = window.geppio!
    return [await quickOpen.open(old.nameJob, old.nameId), await search.open(old.textJob, old.textId)].map(result => !result.ok && result.expired === true)
  }, old)
  assert.deepEqual(stale, [true, true])
  assert.equal(await state.getAttribute('data-document-id'), retained); assert.equal(await editor.inputValue(), dirty)
  assert.ok(await host.evaluate((node, held) => (node as MonacoHost).monacoEditor!.getModel() === held, model)); await model.dispose()
  assert.equal(await readFile(join(project, 'modified.ts'), 'utf8'), original)
}
