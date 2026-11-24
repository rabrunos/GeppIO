import { app, dialog, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { DocumentFailure, DocumentStore, documentFailure, expiredDocumentResponse, outsideApplicationProfile } from './documents.ts'
import { validDocumentRequest } from '../shared/documents.ts'
import type { DocumentDraft, DocumentResult } from '../shared/documents.ts'
import { DirectoryStore, ExplorerFailure, explorerFailure, explorerFileNames } from './explorer.ts'
import { explorerMutations, validExplorerMutationRequest, validExplorerRequest } from '../shared/explorer.ts'
import type { ExplorerMutationResult, ExplorerResult, RenameBinding } from '../shared/explorer.ts'
import { mutateExplorer } from './explorer-write.ts'
import { GitStore, GitFailure, gitFailure } from './git.ts'
import { SearchExpired, SearchStore } from './search.ts'
import { validSearchRequest } from '../shared/search.ts'
import type { ReplacementMark, SearchFilters } from '../shared/search-replacement.ts'
import { QuickOpenExpired, QuickOpenStore } from './quick-open.ts'
import { validQuickOpenRequest } from '../shared/quick-open.ts'
import { gitOperations, validGitRequest } from '../shared/git.ts'
import { WorkspaceOwner } from './workspace.ts'
import { readWorkspaceTools } from './workspace-tools.ts'
import type { WorkspaceToolsResult } from '../shared/workspace-tools.ts'
import { WorkspaceRecovery } from './workspace-recovery.ts'
import { validWorkspaceRequest } from '../shared/workspace.ts'
import type { WorkspaceEditor, WorkspaceResult, WorkspaceView } from '../shared/workspace.ts'

/** Installed for the exact app window, never a recovery window or another WebContents. */
export function bindDocuments(win: BrowserWindow, expectedURL: string): WorkspaceOwner {
  const store = new DocumentStore(undefined, {
    select: async name => {
      const choice = await dialog.showSaveDialog(win, { title: 'Salvar documento como', defaultPath: name, buttonLabel: 'Escolher destino' })
      return choice.canceled ? null : choice.filePath ?? null
    },
    confirmOverwrite: async path => (await dialog.showMessageBox(win, { type: 'warning', title: 'Substituir arquivo',
      message: 'Substituir o conteúdo do arquivo selecionado?', detail: path, buttons: ['Cancelar', 'Substituir'], defaultId: 0, cancelId: 0, noLink: true })).response === 1,
    reconcile: async () => (await dialog.showMessageBox(win, { type: 'warning', title: 'Conferir salvamento',
      message: 'Você conferiu no disco o resultado da operação anterior?', detail: 'O próximo seletor permite salvar este rascunho em um destino escolhido novamente.',
      buttons: ['Cancelar', 'Conferi, escolher destino'], defaultId: 0, cancelId: 0, noLink: true })).response === 1,
    permitted: path => outsideApplicationProfile(app.getPath('userData'), path)
  })
  const directories = new DirectoryStore()
  const git = new GitStore(directories)
  const search = new SearchStore(directories)
  const quickOpen = new QuickOpenStore(directories)
  const revokeProjectResults = () => { git.revoke(); search.revoke(); quickOpen.revoke() }
  const workspace = new WorkspaceOwner(directories, store, new WorkspaceRecovery(app.getPath('userData')), revokeProjectResults)
  let busy = false, closing = false, remembering = false, ticket: string | null = null
  let releasedInFrame = false
  let explorerWriting = false, indexWriting = false, reloading = false, choosingDestination = false
  const revoke = () => { workspace.revoke(); revokeProjectResults(); store.revoke(); directories.revoke(); ticket = null; releasedInFrame = false }
  const decide = async (name = store.snapshot?.label ?? store.snapshot?.name ?? 'arquivo', id = store.snapshot?.id, discardOnly = false) => {
    if (discardOnly) {
      const choice = await dialog.showMessageBox(win, { type: 'warning', title: 'Operação de arquivo não confirmada', message: 'Descartar o rascunho de ' + name + ' e fechar?',
        detail: 'Para conferir o arquivo antes de salvar, cancele e use Recarregar do disco.', buttons: ['Cancelar', 'Descartar'], defaultId: 0, cancelId: 0, noLink: true })
      return choice.response === 1 ? 'discard' : 'cancel'
    }
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
      const path = store.filePath(document.id), names = folder && path ? explorerFileNames(folder, path) : null
      return { ...document, ...(root && names ? { location: { root: root.id, names, caseInsensitive: process.platform === 'win32' } } : {}) }
    })
    const registry = { ...(result.documents ? { documents } : {}), ...(invalidRoot ? { invalidRoot } : {}) }
    return result.ok ? { ...result, ...registry, document: documents.find(value => value.id === result.document?.id) ?? null }
      : { ...result, ...registry, ...(result.confirmed ? { confirmed: documents.find(value => value.id === result.confirmed?.id) } : {}) }
  }
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) revoke() })
  win.webContents.on('render-process-gone', revoke)
  win.on('close', event => {
    if (closing || !store.snapshot && !directories.snapshot && !busy && !releasedInFrame) return
    event.preventDefault()
    if (busy || ticket) return
    ticket = randomUUID()
    win.webContents.send('document:close-requested', ticket)
  })
  const operations = ['create', 'saveAs', 'saveAll', 'open', 'save', 'release', 'close', 'activate', 'reload'] as const
  for (const operation of operations) ipcMain.handle(`document:${operation}`, async (event, ...args: unknown[]): Promise<DocumentResult> => {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL) return documentFailure(new DocumentFailure('invalid'))
    if (!validDocumentRequest(operation, args)) { if (operation === 'close' && args[0] === ticket) ticket = null; return documentFailure(new DocumentFailure('invalid')) }
    if (busy || closing) { if (operation === 'close' && args[0] === ticket) ticket = null; return documentFailure(new DocumentFailure('busy')) }
    if (operation === 'close' && args[0] !== ticket) return documentFailure(new DocumentFailure('stale'))
    const authoring = operation === 'saveAs' || operation === 'saveAll' || (operation === 'save' || operation === 'release' || operation === 'close') && store.snapshots.some(doc => doc.untitled)
    if ((authoring || operation === 'reload') && (ticket && operation !== 'close' || indexWriting || remembering)) {
      if (operation === 'close') ticket = null
      return documentFailure(new DocumentFailure('busy'))
    }
    if (authoring) choosingDestination = true
    busy = true
    const generationCurrent = store.guard()
    const current = () => !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL && generationCurrent()
    const draft = args[0] as DocumentDraft | null
    const writesBefore = store.writeCount
    const receipt = async (result: DocumentResult) => {
      const value = await response(result, current)
      return !current() && store.writeCount !== writesBefore ? documentFailure(new DocumentFailure('unconfirmed')) : value
    }
    try {
      if (operation === 'create') return await response(store.create(), current)
      if (operation === 'saveAll') {
        const result = await store.saveAll(args[0] as DocumentDraft[], current)
        const changed = result.saves?.some(entry => entry.status === 'saved' || entry.status === 'unconfirmed')
        if (changed) { revokeProjectResults(); await workspace.persist(current) }
        return await receipt(result)
      }
      if (operation === 'saveAs' || operation === 'save' && store.snapshots.some(doc => doc.id === draft!.id && doc.untitled)) {
        const saved = await store.saveAs(draft!, operation === 'saveAs' && args[1] === true, current)
        if (saved) { revokeProjectResults(); await workspace.persist(current) }
        return await receipt(store.result(!saved))
      }
      if (operation === 'open') {
        const selected = await dialog.showOpenDialog(win, { title: 'Abrir arquivo de texto', buttonLabel: 'Abrir', properties: ['openFile'], filters: [{ name: 'Texto e código UTF-8', extensions: ['txt', 'js', 'ts', 'json', 'md', 'css', 'html'] }, { name: 'Todos os arquivos', extensions: ['*'] }] })
        if (!current()) throw new DocumentFailure('stale')
        if (selected.canceled || selected.filePaths.length !== 1) return await response(store.result(true), current)
        return await response(await store.select(selected.filePaths[0]!, draft, decide, current), current)
      }
      if (operation === 'activate') return await response(store.activate(args[0] as string), current)
      if (operation === 'reload') {
        reloading = true
        const confirmDiscard = async () => {
          if (!current()) return false
          const reply = await dialog.showMessageBox(win, {
            type: 'warning', title: 'Recarregar do disco', message: 'Descartar o rascunho desta aba e recarregar o arquivo?',
            detail: 'Cancelar mantém o rascunho e o histórico de desfazer. Recarregar substitui o texto pelo conteúdo do disco e descarta o histórico se o texto mudar.',
            buttons: ['Cancelar', 'Descartar rascunho e recarregar'], defaultId: 0, cancelId: 0, noLink: true
          })
          return current() && reply.response === 1
        }
        const result = await store.reload(draft!, args[1] as boolean, confirmDiscard, current)
        if (!current()) return expiredDocumentResponse(result)
        if (result.ok && !result.canceled && result.document) {
          const path = store.filePath(result.document.id)
          if (path && directories.invalidateFile(path)) revokeProjectResults()
        }
        return await response(result, current)
      }
      if (operation === 'save') { await store.save(draft!, current); return await receipt(store.result()) }
      if (operation === 'release') {
        const document = store.snapshots.find(value => value.id === draft!.id)
        const result = await store.release(draft!, () => decide(document?.label ?? document?.name, draft!.id, draft!.discardOnly), current)
        if (result.ok && !result.canceled) {
          // Even an empty native registry may have a renderer draft awaiting this receipt.
          if (current()) releasedInFrame = true
          await workspace.persist(current)
        }
        return await receipt(result)
      }
      const supplied = args[1] as DocumentDraft[] | DocumentDraft | null, drafts = supplied === null ? [] : Array.isArray(supplied) ? supplied : [supplied]
      if (!await store.resolveAll(drafts, document => decide(document.label ?? document.name, document.id, drafts.find(draft => draft.id === document.id)?.discardOnly), current)) return await receipt(store.result(true))
      const remembered = await workspace.persist(current, true)
      if ((!remembered || workspace.recovery.snapshot.error) && current()) await dialog.showMessageBox(win, { type: 'warning', title: 'Sessão local', message: 'Os arquivos foram resolvidos, mas a lembrança da sessão não pôde ser confirmada.', detail: 'Rascunhos não são armazenados para recuperação. Os metadados existentes foram preservados.' })
      if (!current()) throw new DocumentFailure('stale')
      store.revoke()
      if (operation === 'close') { closing = true; setImmediate(() => { if (!win.isDestroyed()) win.close() }) }
      return store.result()
    } catch (error) {
      const result = documentFailure(error)
      if (operation === 'reload') return current() ? result : expiredDocumentResponse(result)
      if (!result.ok && result.code === 'unconfirmed') revokeProjectResults()
      return await receipt(!result.ok ? { ...result, documents: store.snapshots, ...(store.snapshot ? { confirmed: store.snapshot } : {}), ...(['save', 'release'].includes(operation) ? { failed: draft!.id } : {}) } : result)
    } finally { busy = false; if (authoring) choosingDestination = false; if (operation === 'reload') reloading = false; if (operation === 'close') ticket = null }
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
  ipcMain.handle('workspace:readTools', async (event, ...args: unknown[]): Promise<WorkspaceToolsResult> => {
    const caller = projectCaller(event), owner = workspace.guard()
    const expired = { ok: false, expired: true, error: 'Autorização do projeto expirada.' } as const
    if (!caller || !validWorkspaceRequest('readTools', args)) return expired
    const current = () => caller() && owner() && workspace.status().root?.id === args[0]
    if (!current()) return expired
    const result = await readWorkspaceTools(workspace, current)
    return current() ? result : expired
  })
  const bound = (path: string) => !outsideApplicationProfile(profile, path) || workspace.hasFileBinding(path)
  for (const operation of explorerMutations) ipcMain.handle(`explorer:${operation}`, async (event, ...args: unknown[]): Promise<ExplorerMutationResult> => {
    const current = projectCaller(event)
    if (!current?.() || !validExplorerMutationRequest(args, operation)) return { outcome: 'refused', message: 'Solicitação do Explorador inválida ou expirada.' }
    if (busy || remembering || ticket || indexWriting) return { outcome: 'refused', message: 'Aguarde a operação de arquivo ou projeto em andamento.' }
    busy = explorerWriting = true
    const uncertain = { outcome: 'unconfirmed', message: 'Não foi possível confirmar o resultado. Confira a pasta antes de tentar outra operação.' } as const
    try {
      const result = await mutateExplorer(directories, operation, args[0] as string, args[1] as string, args[2] as string, current, bound,
        args.length === 4 ? { openFile: { store, binding: args[3] as RenameBinding } } : {})
      if (result.outcome === 'refused') return result
      if (!current()) return uncertain
      revokeProjectResults()
      if (args.length === 4) {
        if (result.outcome === 'confirmed' && result.renamed) workspace.rememberRenamedView(args[3] as WorkspaceView, result.renamed.revision)
        await workspace.persist(current)
        if (!current()) return uncertain
        if (result.outcome === 'confirmed' && result.renamed) {
          const decorated = await response({ ok: true, document: result.renamed }, current)
          if (!current() || !decorated.ok || !decorated.document) return uncertain
          return { ...result, renamed: decorated.document, message: [result.message, workspace.status().notice].filter(Boolean).join(' ') }
        }
      }
      return result
    } catch {
      if (current()) revokeProjectResults()
      return uncertain
    } finally { busy = explorerWriting = false }
  })
  const searchOperations = ['start', 'read', 'cancel', 'open'] as const
  const replacementOperations = ['preview', 'applyFile'] as const
  for (const operation of replacementOperations) ipcMain.handle(`search:${operation}`, async (event, ...args: unknown[]) => {
    const current = projectCaller(event)
    if (!current?.() || !validSearchRequest(operation, args)) return { ok: false, error: 'Pedido de substituição inválido ou expirado.' }
    if (busy || ticket || remembering || indexWriting) {
      if (operation === 'applyFile') search.refusePreview(args[0] as string, args[1] as string)
      return { ok: false, error: 'Aguarde a operação de arquivo e gere outra prévia.' }
    }
    const job = args[0] as string, marks = args[3] as ReplacementMark[]
    if (operation === 'preview') {
      try { return { ok: true, preview: await search.preview(job, args[1] as string[], args[2] as string, marks, store, current) } }
      catch (error) { return { ok: false, error: error instanceof DocumentFailure && error.kind === 'limit' ? 'Reduza a seleção. Cada prévia comporta até 100 arquivos e 128 KiB de metadados.' : 'A prévia expirou ou está indisponível. Confira o projeto e os resultados.' } }
    }
    busy = explorerWriting = true
    const before = store.writeCount
    try {
      const document = await search.applyFile(job, args[1] as string, args[2] as string, marks, store, current)
      let notice: string | undefined
      if (store.writeCount !== before) {
        git.revoke(); quickOpen.revoke()
        if (!await workspace.persist(current).catch(() => false) || workspace.recovery.snapshot.error) notice = 'A atualização da sessão lembrada não foi confirmada.'
      }
      if (!current()) throw new DocumentFailure(store.writeCount === before ? 'stale' : 'unconfirmed')
      return { ok: true, document, ...(notice ? { notice } : {}) }
    } catch (error) {
      const uncertain = store.writeCount !== before || error instanceof DocumentFailure && error.kind === 'unconfirmed'
      if (uncertain) { git.revoke(); quickOpen.revoke() }
      return { ok: false, ...(uncertain ? { uncertain: true } : {}), error: uncertain ? 'Gravação não confirmada. Confira o arquivo no disco.' :
        'Arquivo recusado. Confira a aba e o conteúdo do disco antes de gerar outra prévia.' }
    } finally { busy = explorerWriting = false }
  })
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
      const value = operation === 'start' ? await search.start(id, args[1] as string, args[2] as boolean, current, args[3] as SearchFilters | undefined)
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
  for (const operation of gitOperations) ipcMain.handle(`git:${operation}`, async (event, ...args: unknown[]) => {
    const frame = event.senderFrame
    if (win.isDestroyed() || event.sender !== win.webContents || frame !== win.webContents.mainFrame || frame?.url !== expectedURL || !validGitRequest(operation, args)) return gitFailure(new GitFailure('invalid'))
    const current = () => !closing && !win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame === frame && frame.url === expectedURL
    const writesIndex = operation === 'stage' || operation === 'unstage'
    if (writesIndex && (explorerWriting || reloading || choosingDestination || indexWriting)) return gitFailure(new GitFailure('busy'))
    if (writesIndex) indexWriting = true
    try { return await git.inspect(operation, args[0] as string, args[1] as string | undefined, current, args.slice(2) as string[]) } catch (error) { return gitFailure(error) }
    finally { if (writesIndex) indexWriting = false }
  })
  win.webContents.on('destroyed', () => {
    revoke()
    for (const operation of operations) ipcMain.removeHandler(`document:${operation}`)
    for (const operation of directoryOperations) ipcMain.removeHandler(`explorer:${operation}`)
    for (const operation of explorerMutations) ipcMain.removeHandler(`explorer:${operation}`)
    for (const operation of gitOperations) ipcMain.removeHandler(`git:${operation}`)
    for (const operation of searchOperations) ipcMain.removeHandler(`search:${operation}`)
    for (const operation of replacementOperations) ipcMain.removeHandler(`search:${operation}`)
    for (const operation of searchOperations) ipcMain.removeHandler(`quick-open:${operation}`)
    for (const operation of workspaceOperations) ipcMain.removeHandler(`workspace:${operation}`)
    ipcMain.removeHandler('workspace:readTools')
  })
  return workspace
}
