import { dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { parsePortableText } from '../shared/workbench/portable.ts'
import type { PortableExport, PortableImport } from '../shared/portable-layout-bridge.ts'
import { exportLayoutFile, importLayoutFile, portableExtension } from './portable-layout-files.ts'

/** The native picker is the only source of paths for these two app-owned operations. */
export function bindPortableLayouts(win: BrowserWindow, expectedURL: string) {
  const filters = [{ name: 'Composição GeppIO', extensions: [portableExtension] }]
  let generation = 0, busy = false
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) generation++ })
  win.webContents.on('render-process-gone', () => { generation++ })
  const refused = { ok: false, error: 'Solicitação de composição indisponível ou expirada.' } as const
  for (const operation of ['import', 'export'] as const) {
    ipcMain.handle('portable-layout:' + operation, async (event, ...args: unknown[]): Promise<PortableImport | PortableExport> => {
      const frame = event.senderFrame, ticket = generation
      const current = () => ticket === generation && !win.isDestroyed() && !win.webContents.isDestroyed() &&
        event.sender === win.webContents && frame === win.webContents.mainFrame && frame?.url === expectedURL
      if (!current() || busy) return refused
      busy = true
      try {
        if (operation === 'import') {
          if (args.length) return refused
          const result = await dialog.showOpenDialog(win, { title: 'Importar composição', filters, properties: ['openFile'] })
          if (!current()) return refused
          if (result.canceled) return { ok: true, recipe: null }
          if (result.filePaths.length !== 1) return refused
          return await importLayoutFile(result.filePaths[0]!, current)
        }
        if (args.length !== 1 || typeof args[0] !== 'string') return refused
        parsePortableText(args[0])
        const result = await dialog.showSaveDialog(win, { title: 'Exportar composição', filters, defaultPath: 'composicao.' + portableExtension })
        if (!current()) return refused
        if (result.canceled) return { ok: true, canceled: true }
        if (!result.filePath) return refused
        return await exportLayoutFile(result.filePath, args[0], current)
      } catch { return refused }
      finally { busy = false }
    })
  }
  win.once('closed', () => {
    generation++
    for (const operation of ['import', 'export']) ipcMain.removeHandler('portable-layout:' + operation)
  })
}
