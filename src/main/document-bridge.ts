import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import { DocumentFailure, DocumentStore, documentFailure } from './documents.ts'
import { validDocumentRequest } from '../shared/documents.ts'
import type { DocumentDraft, DocumentResult } from '../shared/documents.ts'
import { DirectoryStore, ExplorerFailure, explorerFailure, safeExplorerName } from './explorer.ts'
import { validExplorerRequest } from '../shared/explorer.ts'
import type { ExplorerResult } from '../shared/explorer.ts'
import { GitStore, GitFailure, gitFailure } from './git.ts'
import { validGitRequest } from '../shared/git.ts'

/** Installed for the exact app window, never a recovery window or another WebContents. */
export function bindDocuments(win: BrowserWindow, expectedURL: string): void {
  const store = new DocumentStore()
  const directories = new DirectoryStore()
  const git = new GitStore(directories)
  let busy = false, closing = false, ticket: string | null = null
  const revoke = () => { git.revoke(); store.revoke(); directories.revoke(); ticket = null }
  const decide = async (name = store.snapshot?.label ?? store.snapshot?.name ?? 'arquivo', id = store.snapshot?.id) => {
    const path = id ? store.filePath(id) : null
    const result = await dialog.showMessageBox(win, { type: 'question', title: 'Alterações não salvas', message: 'Salvar as alterações de ' + name + ' antes de continuar?', detail: (path ? 'Arquivo: ' + path + '\n\n' : '') + 'Cancelar mantém as abas e os rascunhos abertos. Nenhum outro arquivo será salvo automaticamente.', buttons: ['Salvar', 'Descartar', 'Cancelar'], defaultId: 2, cancelId: 2, noLink: true })
    return (['save', 'discard', 'cancel'] as const)[result.response] ?? 'cancel'
  }
  const response = async (result: DocumentResult, current: () => boolean): Promise<DocumentResult> => {
    let folder: string | null = null
    let invalidRoot: string | undefined
    const root = directories.snapshot
    const source = result.documents ?? (result.ok ? result.document ? [result.document] : [] : result.confirmed ? [result.confirmed] : [])
    if (root && source.length) {
      try { folder = await directories.folder(root.id, current) } catch { invalidRoot = root.id; git.revoke() /* Independent file grants remain; stale Git action IDs do not. */ }
    }
    if (!current()) return documentFailure(new DocumentFailure('stale'))
    const documents = source.map(document => {
      const path = store.filePath(document.id), inside = folder && path ? relative(folder, path) : null
      const names = inside?.split(sep)
      return { ...document, ...(root && inside && !isAbsolute(inside) && names?.every(name => safeExplorerName(name) && name.toLowerCase() !== '.git') ? { location: { root: root.id, names, caseInsensitive: process.platform === 'win32' } } : {}) }
    })
    const registry = { ...(result.documents ? { documents } : {}), ...(invalidRoot ? { invalidRoot } : {}) }
    return result.ok ? { ...result, ...registry, document: documents.find(value => value.id === result.document?.id) ?? null }
      : { ...result, ...registry, ...(result.confirmed ? { confirmed: documents.find(value => value.id === result.confirmed?.id) } : {}) }
  }
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) revoke() })
  win.webContents.on('render-process-gone', revoke)
  win.on('close', event => {
    if (closing || !store.snapshot && !busy) return
    event.preventDefault()
    if (busy || ticket) return
    ticket = randomUUID()
    win.webContents.send('document:close-requested', ticket)
  })
  const operations = ['open', 'save', 'release', 'close', 'activate'] as const
  for (const operation of operations) ipcMain.handle(`document:${operation}`, async (event, ...args: unknown[]): Promise<DocumentResult> => {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL) return documentFailure(new DocumentFailure('invalid'))
    if (!validDocumentRequest(operation, args)) { if (operation === 'close' && args[0] === ticket) ticket = null; return documentFailure(new DocumentFailure('invalid')) }
    if (busy || closing) { if (operation === 'close' && args[0] === ticket) ticket = null; return documentFailure(new DocumentFailure('busy')) }
    if (operation === 'close' && args[0] !== ticket) return documentFailure(new DocumentFailure('stale'))
    busy = true
    const generationCurrent = store.guard()
    const current = () => !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL && generationCurrent()
    const draft = args[0] as DocumentDraft | null
    try {
      if (operation === 'open') {
        const selected = await dialog.showOpenDialog(win, { title: 'Abrir arquivo de texto', buttonLabel: 'Abrir', properties: ['openFile'], filters: [{ name: 'Texto e código UTF-8', extensions: ['txt', 'js', 'ts', 'json', 'md', 'css', 'html'] }, { name: 'Todos os arquivos', extensions: ['*'] }] })
        if (!current()) throw new DocumentFailure('stale')
        if (selected.canceled || selected.filePaths.length !== 1) return await response(store.result(true), current)
        return await response(await store.select(selected.filePaths[0]!, draft, decide, current), current)
      }
      if (operation === 'activate') return await response(store.activate(args[0] as string), current)
      if (operation === 'save') { await store.save(draft!, current); return await response(store.result(), current) }
      if (operation === 'release') {
        const document = store.snapshots.find(value => value.id === draft!.id)
        return await response(await store.release(draft!, () => decide(document?.label ?? document?.name, draft!.id), current), current)
      }
      const supplied = args[1] as DocumentDraft[] | DocumentDraft | null, drafts = supplied === null ? [] : Array.isArray(supplied) ? supplied : [supplied]
      if (!await store.resolveAll(drafts, document => decide(document.label ?? document.name, document.id), current)) return await response(store.result(true), current)
      store.revoke()
      if (operation === 'close') { closing = true; setImmediate(() => { if (!win.isDestroyed()) win.close() }) }
      return store.result()
    } catch (error) {
      const result = documentFailure(error)
      return await response(!result.ok ? { ...result, documents: store.snapshots, ...(store.snapshot ? { confirmed: store.snapshot } : {}), ...(['save', 'release'].includes(operation) ? { failed: draft!.id } : {}) } : result, current)
    } finally { busy = false; if (operation === 'close') ticket = null }
  })
  const directoryOperations = ['select', 'list', 'open', 'release'] as const
  for (const operation of directoryOperations) ipcMain.handle(`explorer:${operation}`, async (event, ...args: unknown[]): Promise<ExplorerResult | DocumentResult> => {
    const fail = (error: unknown) => {
      if (operation !== 'open') return explorerFailure(error)
      if (!(error instanceof ExplorerFailure)) return documentFailure(error)
      const result = documentFailure(new DocumentFailure(error.kind === 'limit' ? 'unavailable' : error.kind))
      // Only our fixed path-free Explorer messages may cross this document result boundary.
      return result.ok ? result : { ...result, error: error.message }
    }
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL || !validExplorerRequest(operation, args)) return fail(new ExplorerFailure('invalid'))
    if (busy || closing) return operation === 'open' ? documentFailure(new DocumentFailure('busy')) : explorerFailure(new ExplorerFailure('busy'))
    busy = true
    const directoryCurrent = directories.guard(), documentCurrent = store.guard()
    const current = () => !win.isDestroyed() && !win.webContents.isDestroyed() && frame === win.webContents.mainFrame && frame.url === expectedURL && directoryCurrent() && documentCurrent()
    try {
      if (operation === 'select') {
        const selected = await dialog.showOpenDialog(win, { title: 'Abrir pasta', buttonLabel: 'Abrir pasta', properties: ['openDirectory'] })
        if (!current()) throw new ExplorerFailure('stale')
        if (selected.canceled || selected.filePaths.length !== 1) return { ok: true, root: directories.snapshot, canceled: true }
        const result = await directories.select(selected.filePaths[0]!, current)
        git.revoke()
        return result
      }
      const root = args[0] as string, node = args[1] as string
      if (operation === 'release') { const result = directories.release(root); git.revoke(); return result }
      if (operation === 'list') return await directories.list(root, node, current)
      const path = await directories.file(root, node, current)
      return await response(await store.select(path, args[2] as DocumentDraft | null, decide, current, async () => { await directories.file(root, node, current) }), current)
    } catch (error) {
      const result = fail(error)
      return operation === 'open' ? await response(!result.ok ? { ...result, documents: store.snapshots, ...(store.snapshot ? { confirmed: store.snapshot } : {}) } : documentFailure(new DocumentFailure('invalid')), current) : result
    } finally { busy = false }
  })
  const gitOperations = ['status', 'compare', 'stage', 'unstage'] as const
  for (const operation of gitOperations) ipcMain.handle(`git:${operation}`, async (event, ...args: unknown[]) => {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL || !validGitRequest(operation, args)) return gitFailure(new GitFailure('invalid'))
    const current = () => !closing && !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL
    try { return await git.inspect(operation, args[0] as string, args[1] as string | undefined, current) } catch (error) { return gitFailure(error) }
  })
  win.webContents.on('destroyed', () => {
    revoke()
    for (const operation of operations) ipcMain.removeHandler(`document:${operation}`)
    for (const operation of directoryOperations) ipcMain.removeHandler(`explorer:${operation}`)
    for (const operation of gitOperations) ipcMain.removeHandler(`git:${operation}`)
  })
}
