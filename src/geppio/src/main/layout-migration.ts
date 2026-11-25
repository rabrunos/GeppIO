import { BrowserWindow, session } from 'electron'
import type { Session } from 'electron'
import { IDENTITY } from '../shared/identity.ts'
import { MAX_LAYOUT_BYTES } from '../shared/layout.ts'
import { migratedLayout } from '../shared/layout-migration.ts'
import { DEFAULT_LAYOUT, MINIMUMS } from '../shared/layout-defaults.ts'
import { LEGACY_IDENTITY, recoveryProfile } from './profile-migration.ts'
import { recoveryURL, recoveryResponse } from './security.ts'
async function windowAt(ses: Session, url: string): Promise<BrowserWindow> {
  const scheme = new URL(url).protocol.slice(0, -1)
  ses.protocol.handle(scheme, request => recoveryResponse(request.url, request.method, url))
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true,
    nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true, devTools: false } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  try { await win.loadURL(url); return win }
  catch (error) { win.destroy(); ses.protocol.unhandle(scheme); throw error }
}
function close(win: BrowserWindow, url: string): void {
  const ses = win.webContents.session
  win.destroy(); ses.protocol.unhandle(new URL(url).protocol.slice(0, -1))
}
/** Main-owned fixed scripts on inert documents; no script/path/channel comes from the renderer. */
export async function recoverLayout(profile: string, devURL: string | null): Promise<void> {
  const root = recoveryProfile(profile)
  if (!root) return
  const currentURL = recoveryURL(IDENTITY.protocol, devURL)
  const currentWindow = await windowAt(session.defaultSession, currentURL)
  try {
    const current: unknown = await currentWindow.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(IDENTITY.layoutStorageKey)})`)
    if (current !== null) return
    const legacySession = session.fromPath(root, { cache: false })
    legacySession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    legacySession.setPermissionCheckHandler(() => false)
    legacySession.on('will-download', event => event.preventDefault())
    const oldURL = recoveryURL(LEGACY_IDENTITY.protocol, devURL)
    legacySession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== oldURL }))
    const legacyWindow = await windowAt(legacySession, oldURL)
    try {
      const raw: unknown = await legacyWindow.webContents.executeJavaScript(`(() => { const raw = localStorage.getItem(${JSON.stringify(LEGACY_IDENTITY.layoutStorageKey)}); if (raw !== null && raw.length > ${MAX_LAYOUT_BYTES}) throw new Error('Legacy layout too large'); return raw })()`)
      const next = migratedLayout(raw, null, DEFAULT_LAYOUT, MINIMUMS)
      if (next !== null) {
        await currentWindow.webContents.executeJavaScript(`(() => { if (localStorage.getItem(${JSON.stringify(IDENTITY.layoutStorageKey)}) === null) localStorage.setItem(${JSON.stringify(IDENTITY.layoutStorageKey)}, ${JSON.stringify(next)}) })()`)
        await session.defaultSession.flushStorageData()
      }
    } finally { close(legacyWindow, oldURL) }
  } finally { close(currentWindow, currentURL) }
}
