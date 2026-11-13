import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { DocumentFailure, DocumentStore, documentFailure } from './documents.ts'
import { validDocumentRequest } from '../shared/documents.ts'
import type { DocumentDraft, DocumentResult } from '../shared/documents.ts'

/** Installed for the exact app window, never a recovery window or another WebContents. */
export function bindDocuments(win: BrowserWindow, expectedURL: string): void {
  const store = new DocumentStore()
  let busy = false, closing = false, ticket: string | null = null
  const revoke = () => { store.revoke(); ticket = null }
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) revoke() })
  win.webContents.on('render-process-gone', revoke)
  win.on('close', event => {
    if (closing || !store.snapshot && !busy) return
    event.preventDefault()
    if (busy || ticket) return
    ticket = randomUUID()
    win.webContents.send('document:close-requested', ticket)
  })
  const operations = ['open', 'save', 'release', 'close'] as const
  for (const operation of operations) ipcMain.handle(`document:${operation}`, async (event, ...args: unknown[]): Promise<DocumentResult> => {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL) return documentFailure(new DocumentFailure('invalid'))
    if (!validDocumentRequest(operation, args)) { if (operation === 'close' && args[0] === ticket) ticket = null; return documentFailure(new DocumentFailure('invalid')) }
    if (busy || closing) { if (operation === 'close' && args[0] === ticket) ticket = null; return documentFailure(new DocumentFailure('busy')) }
    if (operation === 'close' && args[0] !== ticket) return documentFailure(new DocumentFailure('stale'))
    busy = true
    const generationCurrent = store.guard()
    const current = () => !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL && generationCurrent()
    const draft = (operation === 'close' ? args[1] : args[0]) as DocumentDraft | null
    const decide = async () => {
      const result = await dialog.showMessageBox(win, { type: 'question', title: 'Alterações não salvas', message: 'Salvar as alterações antes de continuar?', detail: 'Cancelar mantém o arquivo e o rascunho abertos.', buttons: ['Salvar', 'Descartar', 'Cancelar'], defaultId: 2, cancelId: 2, noLink: true })
      return (['save', 'discard', 'cancel'] as const)[result.response] ?? 'cancel'
    }
    try {
      if (operation === 'open') {
        const selected = await dialog.showOpenDialog(win, { title: 'Abrir arquivo de texto', buttonLabel: 'Abrir', properties: ['openFile'], filters: [{ name: 'Texto e código UTF-8', extensions: ['txt', 'js', 'ts', 'json', 'md', 'css', 'html'] }, { name: 'Todos os arquivos', extensions: ['*'] }] })
        if (!current()) throw new DocumentFailure('stale')
        if (selected.canceled || selected.filePaths.length !== 1) return { ok: true, document: store.snapshot, canceled: true }
        return await store.select(selected.filePaths[0]!, draft, decide, current)
      }
      if (operation === 'save') return { ok: true, document: await store.save(draft!, current) }
      if (!await store.resolveDraft(draft, decide, current)) return { ok: true, document: store.snapshot, canceled: true }
      store.revoke()
      if (operation === 'close') { closing = true; setImmediate(() => { if (!win.isDestroyed()) win.close() }) }
      return { ok: true, document: null }
    } catch (error) {
      const result = documentFailure(error)
      return !result.ok && store.snapshot ? { ...result, confirmed: store.snapshot } : result
    } finally { busy = false; if (operation === 'close') ticket = null }
  })
  win.webContents.on('destroyed', () => { revoke(); for (const operation of operations) ipcMain.removeHandler(`document:${operation}`) })
}
