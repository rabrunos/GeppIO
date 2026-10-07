import { app, BrowserWindow, protocol, session, ipcMain, dialog } from 'electron'
import { tmpdir } from 'node:os'
import { resolve, relative, isAbsolute } from 'node:path'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IDENTITY } from '../shared/identity.ts'
import { PRODUCTION_CSP, DEVELOPMENT_CSP, rendererAsset, validatedDevURL } from './security.ts'
import { PluginStore } from './plugins.ts'
import { pluginId } from '../shared/plugins.ts'
import type { PluginResult } from '../shared/plugins.ts'

protocol.registerSchemesAsPrivileged([{ scheme: IDENTITY.protocol, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
app.setName(IDENTITY.name)
const testData = !app.isPackaged ? process.env.SEMNOME_TEST_USER_DATA : undefined
if (testData) {
  const candidate = resolve(testData), rel = relative(tmpdir(), candidate)
  if (!isAbsolute(testData) || !rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('semnome-smoke-')) throw new Error('Invalid test data directory')
  app.setPath('userData', candidate)
}
const development = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const devURL = development ? validatedDevURL(process.env.ELECTRON_RENDERER_URL ?? '') : null
const plugins = new PluginStore(join(app.getPath('userData'), 'plugins'))
let managementBusy = false

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    title: IDENTITY.name, width: 1480, height: 980, minWidth: 1000, minHeight: 720,
    show: false, backgroundColor: '#101317', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      nodeIntegrationInWorker: false, webviewTag: false, devTools: development }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.once('ready-to-show', () => win.show())
  await win.loadURL(devURL ?? `${IDENTITY.protocol}://${IDENTITY.host}/index.html`)
}

app.whenReady().then(async () => {
  // Explicit operations only; no IPC channel name or filesystem path comes from the renderer.
  for (const operation of ['list', 'install', 'set-enabled', 'remove'] as const) {
    ipcMain.handle('plugins:' + operation, async (event, ...args: unknown[]): Promise<PluginResult<unknown>> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== (devURL ?? `${IDENTITY.protocol}://${IDENTITY.host}/index.html`)) return { ok: false, error: 'Origem de gerenciamento inválida.' }
      const mutation = operation !== 'list'
      if (mutation && managementBusy) return { ok: false, error: 'Aguarde a operação de plugins em andamento.' }
      if (mutation) managementBusy = true
      try {
        if (operation === 'list' && !args.length) return { ok: true, value: await plugins.list() }
        if (operation === 'install' && !args.length) {
          const selected = await dialog.showOpenDialog(win, { title: 'Instalar plugin local confiável', buttonLabel: 'Instalar desativado', properties: ['openDirectory'] })
          return { ok: true, value: selected.canceled || selected.filePaths.length !== 1 ? null : await plugins.install(selected.filePaths[0]!) }
        }
        if (operation === 'set-enabled' && args.length === 2 && pluginId(args[0]) && typeof args[1] === 'boolean') return { ok: true, value: await plugins.setEnabled(args[0], args[1]) }
        if (operation === 'remove' && args.length === 1 && pluginId(args[0])) return { ok: true, value: await plugins.remove(args[0]) }
        return { ok: false, error: 'Operação de plugins inválida.' }
      } catch (error) {
        // OS errors may contain private source paths; only deliberate validation errors reach UI.
        return { ok: false, error: error instanceof Error && !('code' in error) && !(error instanceof SyntaxError) ? error.message.slice(0, 512) : 'Não foi possível ler ou alterar o pacote. Verifique o manifesto e os arquivos locais.' }
      } finally { if (mutation) managementBusy = false }
    })
  }
  const root = join(__dirname, '../renderer')
  protocol.handle(IDENTITY.protocol, async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    if (new URL(request.url).pathname.startsWith('/plugins/')) {
      const bytes = plugins.asset(request.url)
      return bytes ? new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': 'text/javascript; charset=utf-8', 'Content-Security-Policy': PRODUCTION_CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        ...(devURL ? { 'Access-Control-Allow-Origin': new URL(devURL).origin } : {})
      } }) : new Response(null, { status: 403 })
    }
    const asset = rendererAsset(root, request.url)
    if (!asset) return new Response(null, { status: 403 })
    try {
      const bytes = await readFile(asset.path)
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': asset.mime, 'Content-Security-Policy': PRODUCTION_CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
      } })
    } catch { return new Response(null, { status: 404 }) }
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.on('will-download', event => event.preventDefault())
  if (development) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEVELOPMENT_CSP] }
    }))
  } else {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }))
  }
  await createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createWindow() })
}).catch(error => { console.error('Application startup failed:', error instanceof Error ? error.message : 'unknown error'); app.exit(1) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
