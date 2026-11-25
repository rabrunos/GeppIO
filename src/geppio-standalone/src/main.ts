import { app, BrowserWindow, protocol, session } from 'electron'
import { dirname, join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import type { Definition } from './composition.ts'
interface Resource { id: string; revision: string; html: string; csp: string }
const root = app.getAppPath()
const definition: Definition = JSON.parse(readFileSync(join(root, 'composition.json'), 'utf8'))
const resources: Resource[] = JSON.parse(readFileSync(join(root, 'resources.json'), 'utf8'))
const identity = 'geppio-export-' + definition.productId
app.setName(identity)
app.setAppUserModelId('org.geppio.export.' + definition.productId)
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const base = app.commandLine.hasSwitch('portable') ? join(dirname(process.execPath), 'data') : app.getPath('appData')
  const profile = join(base, identity)
  mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
}
app.setPath('sessionData', app.getPath('userData'))
protocol.registerSchemesAsPrivileged([
  { scheme: 'gpp-app', privileges: { standard: true, secure: true } },
  { scheme: 'geppio-surface', privileges: { standard: true, secure: true } }
])
const home = 'gpp-app://' + definition.productId
const surface = (url: string) => resources.find(r => url === 'geppio-surface://' + r.revision + '/' + r.id + '/index.html')
app.whenReady().then(async () => {
  protocol.handle('gpp-app', request => {
    const types: Record<string, string> = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' }
    const name = request.url.slice(home.length + 1)
    if (request.method !== 'GET' || !Object.hasOwn(types, name) || request.url !== home + '/' + name) return new Response(null, { status: 403 })
    return new Response(readFileSync(join(root, name)), { headers: { 'Content-Type': types[name]! + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; frame-src geppio-surface:; base-uri 'none'; form-action 'none'"
    } })
  })
  protocol.handle('geppio-surface', request => {
    const r = request.method === 'GET' && surface(request.url)
    return r ? new Response(r.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': r.csp, 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 403 })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.on('will-download', event => event.preventDefault())
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*','http://*/*','ws://*/*','wss://*/*','file://*/*'] }, (_details, callback) => callback({ cancel: true }))
  const window = new BrowserWindow({ title: definition.name, width: 960, height: 700, autoHideMenuBar: true,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, webviewTag: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame || event.initiator !== window.webContents.mainFrame || !surface(event.url)) event.preventDefault()
  })
  await window.loadURL(home + '/index.html')
}).catch(() => app.exit(1))
app.on('window-all-closed', () => app.quit())
