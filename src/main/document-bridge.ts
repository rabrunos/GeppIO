import { app, dialog, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import { DocumentFailure, DocumentStore, documentFailure, expiredDocumentResponse } from './documents.ts'
import { validDocumentRequest } from '../shared/documents.ts'
import type { DocumentDraft, DocumentResult } from '../shared/documents.ts'
import { DirectoryStore, ExplorerFailure, explorerFailure, safeExplorerName } from './explorer.ts'
import { explorerMutations, validExplorerMutationRequest, validExplorerRequest } from '../shared/explorer.ts'
import type { ExplorerMutationResult, ExplorerResult } from '../shared/explorer.ts'
import { mutateExplorer } from './explorer-write.ts'
import { GitStore, GitFailure, gitFailure } from './git.ts'
import { SearchExpired, SearchStore } from './search.ts'
import { validSearchRequest } from '../shared/search.ts'
import { QuickOpenExpired, QuickOpenStore } from './quick-open.ts'
import { validQuickOpenRequest } from '../shared/quick-open.ts'
import { validGitRequest } from '../shared/git.ts'
import { WorkspaceOwner } from './workspace.ts'
import { WorkspaceRecovery } from './workspace-recovery.ts'
import { validWorkspaceRequest } from '../shared/workspace.ts'
import type { WorkspaceEditor, WorkspaceResult } from '../shared/workspace.ts'

/** Installed for the exact app window, never a recovery window or another WebContents. */
export function bindDocuments(win: BrowserWindow, expectedURL: string): WorkspaceOwner {
  const store = new DocumentStore()
  const directories = new DirectoryStore()
  const git = new GitStore(directories)
  const search = new SearchStore(directories)
  const quickOpen = new QuickOpenStore(directories)
  const revokeProjectResults = () => { git.revoke(); search.revoke(); quickOpen.revoke() }
  const workspace = new WorkspaceOwner(directories, store, new WorkspaceRecovery(app.getPath('userData')), revokeProjectResults)
  let busy = false, closing = false, remembering = false, ticket: string | null = null
  let explorerWriting = false, indexWriting = false
  const revoke = () => { workspace.revoke(); revokeProjectResults(); store.revoke(); directories.revoke(); ticket = null }
  const decide = async (name = store.snapshot?.label ?? store.snapshot?.name ?? 'arquivo', id = store.snapshot?.id) => {
    const path = id ? store.filePath(id) : null
    const result = await dialog.showMessageBox(win, { type: 'question', title: 'Alterações não salvas', message: 'Salvar as alterações de ' + name + ' antes de continuar?', detail: (path ? 'Arquivo: ' + path + '\n\n' : '') + 'Cancelar mantém as abas e os rascunhos abertos. Nenhum outro arquivo será salvo automaticamente.', buttons: ['Salvar', 'Descartar', 'Cancelar'], defaultId: 2, cancelId: 2, noLink: true })
    return (['save', 'discard', 'cancel'] as const)[result.response] ?? 'cancel'
  }
  const response = async (result: DocumentResult, current: () => boolean): Promise<DocumentResult> => {
    if (!current()) return expiredDocumentResponse(result)
    let folder: string | null = null
    let invalidRoot: string | undefined
    const root = directories.snapshot
    const source = result.documents ?? (result.ok ? result.document ? [result.document] : [] : result.confirmed ? [result.confirmed] : [])
    if (root && source.length) {
      try { folder = await directories.folder(root.id, current) } catch {
        if (!current()) return expiredDocumentResponse(result)
        invalidRoot = root.id; revokeProjectResults()
      }
    }
    if (!current()) return expiredDocumentResponse(result)
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
    if (closing || !store.snapshot && !directories.snapshot && !busy) return
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
        const result = await store.release(draft!, () => decide(document?.label ?? document?.name, draft!.id), current)
        if (result.ok && !result.canceled) await workspace.persist(current)
        return await response(result, current)
      }
      const supplied = args[1] as DocumentDraft[] | DocumentDraft | null, drafts = supplied === null ? [] : Array.isArray(supplied) ? supplied : [supplied]
      if (!await store.resolveAll(drafts, document => decide(document.label ?? document.name, document.id), current)) return await response(store.result(true), current)
      await workspace.persist(current, true)
      if (workspace.recovery.snapshot.error && current()) await dialog.showMessageBox(win, { type: 'warning', title: 'Sessão local', message: 'Os arquivos foram resolvidos, mas a lembrança da sessão não pôde ser confirmada.', detail: 'Rascunhos não são armazenados para recuperação. Os metadados existentes foram preservados.' })
      if (!current()) throw new DocumentFailure('stale')
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
    const contextCurrent = () => !win.isDestroyed() && !win.webContents.isDestroyed() && frame === win.webContents.mainFrame && frame.url === expectedURL && documentCurrent()
    const current = () => contextCurrent() && directoryCurrent()
    try {
      if (operation === 'select') {
        const selected = await dialog.showOpenDialog(win, { title: 'Abrir pasta', buttonLabel: 'Abrir pasta', properties: ['openDirectory'] })
        if (!current()) throw new ExplorerFailure('stale')
        if (selected.canceled || selected.filePaths.length !== 1) return { ok: true, root: directories.snapshot, canceled: true }
        const value = await workspace.opened(selected.filePaths[0]!, contextCurrent)
        if (!contextCurrent()) throw new ExplorerFailure('stale')
        return { ok: true, root: value.root }
      }
      const root = args[0] as string, node = args[1] as string
      if (operation === 'release') { const value = await workspace.close(root, contextCurrent); if (!contextCurrent()) throw new ExplorerFailure('stale'); return { ok: true, root: value.root } }
      if (operation === 'list') return await directories.list(root, node, current)
      const path = await directories.file(root, node, current)
      return await response(await store.select(path, args[2] as DocumentDraft | null, decide, current, async () => { await directories.file(root, node, current) }, undefined, 'file-identity'), current)
    } catch (error) {
      const result = fail(error)
      return operation === 'open' ? await response(!result.ok ? { ...result, documents: store.snapshots, ...(store.snapshot ? { confirmed: store.snapshot } : {}) } : documentFailure(new DocumentFailure('invalid')), current) : result
    } finally { busy = false }
  })
  const workspaceOperations = ['read', 'restore', 'standalone', 'configure', 'forget', 'remember'] as const
  for (const operation of workspaceOperations) ipcMain.handle(`workspace:${operation}`, async (event, ...args: unknown[]): Promise<WorkspaceResult> => {
    const frame = event.senderFrame
    const fail = (error = 'Operação de projeto recusada. A pasta, a sessão local ou a autorização mudou. Rascunhos e arquivos existentes foram preservados.'): WorkspaceResult => ({ ok: false, error })
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL || !validWorkspaceRequest(operation, args)) return fail('Solicitação de projeto inválida.')
    if (closing || busy && operation !== 'read') return fail('Aguarde a operação de arquivo em andamento.')
    if (operation === 'remember' && remembering) return fail('Atualização de sessão em andamento.')
    const ownerCurrent = workspace.guard()
    const current = () => !win.isDestroyed() && !win.webContents.isDestroyed() && frame === win.webContents.mainFrame && frame.url === expectedURL && ownerCurrent()
    const exclusive = !['read', 'remember'].includes(operation)
    if (exclusive) busy = true
    if (operation === 'remember') remembering = true
    try {
      if (operation === 'read') { const value = await workspace.read(); return current() ? { ok: true, value } : fail() }
      if (operation === 'restore') {
        const result = await workspace.restore(current, async (name, path, unsaved) => {
          const choice = await dialog.showMessageBox(win, { type: 'question', title: 'Restaurar projeto', message: 'Restaurar ' + name + '?', detail: 'Pasta: ' + path + '\n\nSomente arquivos salvos, abas e estado limpo de visualização serão reabertos após validação. Rascunhos, undo e processos não são recuperados.' + (unsaved ? ` Há indicação de ${unsaved} rascunho(s) não salvo(s) na última lembrança do projeto; o conteúdo deles não foi armazenado.` : ''), buttons: ['Restaurar', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true })
          return choice.response === 0
        }, async name => {
          const choice = await dialog.showMessageBox(win, { type: 'question', title: 'Arquivo alterado', message: name + ' mudou desde a sessão anterior.', detail: 'Nenhum conteúdo será gravado. Escolha abrir a versão atual do disco sem restaurar a posição antiga, ignorar esta aba ou cancelar toda a restauração.', buttons: ['Abrir versão atual', 'Ignorar arquivo', 'Cancelar restauração'], defaultId: 2, cancelId: 2, noLink: true })
          return (['current', 'skip', 'cancel'] as const)[choice.response] ?? 'cancel'
        })
        if (!current()) return fail()
        return result.ok && result.documents ? { ...result, documents: await response(result.documents, current) } : result
      }
      if (operation === 'standalone') {
        const selected = await dialog.showOpenDialog(win, { title: 'Abrir arquivo avulso', buttonLabel: 'Abrir arquivo', properties: ['openFile'] })
        if (!current()) return fail()
        if (selected.canceled || selected.filePaths.length !== 1) return { ok: true, value: workspace.status(), canceled: true }
        const document = await store.select(selected.filePaths[0]!, null, decide, current)
        if (directories.snapshot) await workspace.close(directories.snapshot.id, current, document.ok ? document.document?.id : undefined)
        else await workspace.persist(current)
        if (!current()) return fail()
        return { ok: true, value: workspace.status(), documents: await response(document, current) }
      }
      const value = operation === 'remember' ? await workspace.remember(args[0] as WorkspaceEditor, current)
        : operation === 'configure' ? await workspace.configure(args[0] as boolean, current) : await workspace.forget(current)
      return current() ? { ok: true, value } : fail()
    } catch { return current() ? { ...fail(), value: workspace.status() } : fail() }
    finally { if (exclusive) busy = false; if (operation === 'remember') remembering = false }
  })
  function projectCaller(event: IpcMainInvokeEvent) {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL) return
    const documentCurrent = store.guard(), directoryCurrent = directories.guard()
    return () => !closing && !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL && documentCurrent() && directoryCurrent()
  }
  const profile = app.getPath('userData')
  const bound = (path: string) => {
    const inside = relative(profile, path)
    return (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) || workspace.hasFileBinding(path)
  }
  for (const operation of explorerMutations) ipcMain.handle(`explorer:${operation}`, async (event, ...args: unknown[]): Promise<ExplorerMutationResult> => {
    const current = projectCaller(event)
    if (!current?.() || !validExplorerMutationRequest(args)) return { outcome: 'refused', message: 'Solicitação do Explorador inválida ou expirada.' }
    if (busy || remembering || ticket || indexWriting) return { outcome: 'refused', message: 'Aguarde a operação de arquivo ou projeto em andamento.' }
    busy = explorerWriting = true
    const uncertain = { outcome: 'unconfirmed', message: 'Não foi possível confirmar o resultado. Confira a pasta antes de tentar outra operação.' } as const
    try {
      const result = await mutateExplorer(directories, operation, args[0] as string, args[1] as string, args[2] as string, current, bound)
      if (result.outcome === 'refused') return result
      if (!current()) return uncertain
      revokeProjectResults()
      return result
    } catch {
      if (current()) revokeProjectResults()
      return uncertain
    } finally { busy = explorerWriting = false }
  })
  const searchOperations = ['start', 'read', 'cancel', 'open'] as const
  for (const operation of searchOperations) ipcMain.handle(`search:${operation}`, async (event, ...args: unknown[]) => {
    const current = projectCaller(event)
    if (!current || !validSearchRequest(operation, args)) return documentFailure(new DocumentFailure('invalid'))
    if (!current()) return { ...documentFailure(new DocumentFailure('stale')), expired: true }
    const id = args[0] as string
    if (operation === 'open') {
      if (busy || ticket) return documentFailure(new DocumentFailure('busy'))
      busy = true
      try {
        const opened = await search.open(id, args[1] as string, store, current)
        const decorated = await response(opened, current)
        if (!opened.ok || !decorated.ok) return decorated
        return { ...decorated, matchesSnapshot: !decorated.invalidRoot && opened.matchesSnapshot === true }
      }
      catch (error) {
        const failure = documentFailure(error)
        if (error instanceof SearchExpired) return { ...failure, expired: true }
        return !failure.ok && failure.code === 'stale'
          ? { ...failure, error: 'Resultado de busca desatualizado. Confira o projeto e busque novamente.' } : failure
      }
      finally { busy = false }
    }
    // Search owns its work independently. Enumeration and progress requests
    // never acquire the document transaction used for Open and Save.
    try {
      const value = operation === 'start' ? await search.start(id, args[1] as string, args[2] as boolean, current)
        : operation === 'read' ? await search.read(id, args[1] as number, current) : await search.cancel(id, current)
      return current() ? { ok: true, value } : { ...documentFailure(new DocumentFailure('stale')), expired: true }
    } catch (error) {
      return { ok: false, error: 'Busca indisponível ou expirada. Confira o projeto e inicie outra busca.',
        ...(error instanceof SearchExpired ? { expired: true } : {}) }
    }
  })
  for (const operation of searchOperations) ipcMain.handle(`quick-open:${operation}`, async (event, ...args: unknown[]) => {
    const current = projectCaller(event)
    if (!current || !validQuickOpenRequest(operation, args)) return documentFailure(new DocumentFailure('invalid'))
    const expired = () => ({ ...documentFailure(new DocumentFailure('stale')), expired: true as const })
    if (!current()) return expired()
    const id = args[0] as string
    try {
      if (operation === 'open') {
        if (busy || ticket) return documentFailure(new DocumentFailure('busy'))
        busy = true
        try { return await response(await quickOpen.open(id, args[1] as string, store, current), current) }
        finally { busy = false }
      }
      if (operation === 'cancel') return quickOpen.cancel(id, current)
      const query = args[1] as string
      const value = operation === 'start' ? quickOpen.start(id, query, current) : await quickOpen.read(id, query, current)
      return current() ? { ok: true, value } : expired()
    } catch (error) {
      if (!current() || error instanceof QuickOpenExpired) return expired()
      return documentFailure(error)
    }
  })
  const gitOperations = ['status', 'compare', 'stage', 'unstage'] as const
  for (const operation of gitOperations) ipcMain.handle(`git:${operation}`, async (event, ...args: unknown[]) => {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL || !validGitRequest(operation, args)) return gitFailure(new GitFailure('invalid'))
    const current = () => !closing && !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL
    const writesIndex = operation === 'stage' || operation === 'unstage'
    if (writesIndex && (explorerWriting || indexWriting)) return gitFailure(new GitFailure('busy'))
    if (writesIndex) indexWriting = true
    try { return await git.inspect(operation, args[0] as string, args[1] as string | undefined, current) } catch (error) { return gitFailure(error) }
    finally { if (writesIndex) indexWriting = false }
  })
  win.webContents.on('destroyed', () => {
    revoke()
    for (const operation of operations) ipcMain.removeHandler(`document:${operation}`)
    for (const operation of directoryOperations) ipcMain.removeHandler(`explorer:${operation}`)
    for (const operation of explorerMutations) ipcMain.removeHandler(`explorer:${operation}`)
    for (const operation of gitOperations) ipcMain.removeHandler(`git:${operation}`)
    for (const operation of searchOperations) ipcMain.removeHandler(`search:${operation}`)
    for (const operation of searchOperations) ipcMain.removeHandler(`quick-open:${operation}`)
    for (const operation of workspaceOperations) ipcMain.removeHandler(`workspace:${operation}`)
  })
  return workspace
}
