import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { TerminalService } from './terminal.ts'
import { validTerminalRequest } from '../shared/terminal.ts'
import type { TerminalResult } from '../shared/terminal.ts'

export function bindTerminal(win: BrowserWindow, expectedURL: string) {
  let service = new TerminalService()
  const revoke = () => { service.dispose(); service = new TerminalService() }
  win.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) revoke() })
  win.webContents.on('render-process-gone', revoke)
  const shutdown = () => service.dispose()
  app.on('will-quit', shutdown)
  for (const operation of ['read', 'start', 'input', 'resize', 'close'] as const) {
    ipcMain.handle(`terminal:${operation}`, (event, ...args: unknown[]): TerminalResult => {
      if (win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame?.url !== expectedURL || !validTerminalRequest(operation, args)) return { ok: false, error: 'Solicitação de terminal inválida.' }
      try {
        const value = operation === 'read' ? service.read(args[0] as string | null, args[1] as number)
          : operation === 'start' ? service.start()
          : operation === 'input' ? service.input(args[0] as string, args[1] as string)
          : operation === 'resize' ? service.resize(args[0] as string, args[1] as number, args[2] as number)
          : service.close(args[0] as string)
        return { ok: true, value }
      } catch { return { ok: false, error: 'Operação de terminal recusada. Verifique a sessão e os limites de entrada.' } }
    })
  }
  win.once('closed', () => {
    service.dispose(); app.removeListener('will-quit', shutdown)
    for (const operation of ['read', 'start', 'input', 'resize', 'close']) ipcMain.removeHandler(`terminal:${operation}`)
  })
}
