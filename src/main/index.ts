import { app, BrowserWindow, protocol, session } from 'electron'
import { tmpdir } from 'node:os'
import { resolve, relative, isAbsolute } from 'node:path'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IDENTITY } from '../shared/identity.ts'
import { PRODUCTION_CSP, DEVELOPMENT_CSP, rendererAsset, validatedDevURL } from './security.ts'

protocol.registerSchemesAsPrivileged([{ scheme: IDENTITY.protocol, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.setName(IDENTITY.name)
const testData = !app.isPackaged ? process.env.SEMNOME_TEST_USER_DATA : undefined
if (testData) {
  const candidate = resolve(testData), rel = relative(tmpdir(), candidate)
  if (!isAbsolute(testData) || !rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('semnome-smoke-')) throw new Error('Invalid test data directory')
  app.setPath('userData', candidate)
}
const development = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const devURL = development ? validatedDevURL(process.env.ELECTRON_RENDERER_URL ?? '') : null

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    title: IDENTITY.name, width: 1480, height: 980, minWidth: 1000, minHeight: 720,
    show: false, backgroundColor: '#101317', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      webviewTag: false, devTools: development }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.once('ready-to-show', () => win.show())
  await win.loadURL(devURL ?? `${IDENTITY.protocol}://${IDENTITY.host}/index.html`)
}

app.whenReady().then(async () => {
  const root = join(__dirname, '../renderer')
  protocol.handle(IDENTITY.protocol, async request => {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
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
