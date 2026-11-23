import assert from 'node:assert/strict'
import type { ElectronApplication, Page } from 'playwright'

/** Windows descendants can keep the launcher's output handles alive after Electron exits. */
export async function closeWorkspaceWindow(app: ElectronApplication, page: Page, quitApp = false) {
  const launcher = app.process()
  const endOutput = () => {
    if (launcher.exitCode !== 0 || launcher.signalCode || !page.isClosed()) return
    // Playwright launches Electron with five stdio slots on Windows. Its
    // public close event follows ChildProcess.close, which waits for all pipes.
    for (const pipe of launcher.stdio) pipe?.destroy()
  }
  launcher.once('exit', endOutput)
  page.once('close', endOutput)
  try {
    await Promise.all([
      app.waitForEvent('close'),
      quitApp ? app.close() : app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    ])
    assert.ok(page.isClosed(), 'The Workspace window closed')
    assert.equal(launcher.exitCode, 0, 'Electron exited normally')
  } finally {
    launcher.off('exit', endOutput)
    page.off('close', endOutput)
  }
}
