import type { Page } from 'playwright'
import type { MonacoHost } from '../src/renderer/src/files-editor/monaco.ts'

/** Existing document journeys now drive/inspect the actual Monaco instance, never an input surrogate. */
export function fileEditor(page: Page) {
  const host = page.locator('.monaco-host')
  return {
    count: () => host.count(),
    waitFor: () => host.waitFor(),
    inputValue: () => host.evaluate(node => (node as MonacoHost).monacoEditor!.getValue()),
    fill: async (value: string) => {
      await host.waitFor()
      // Fixture replacement is one public model edit, like the previous fill operation.
      // Native keystrokes, multicursors and stock find/replace are exercised separately.
      await host.evaluate((node, value) => {
        const editor = (node as MonacoHost).monacoEditor!
        editor.pushUndoStop(); editor.executeEdits('smoke-fixture', [{ range: editor.getModel()!.getFullModelRange(), text: value }]); editor.pushUndoStop(); editor.focus()
      }, value)
    },
    focus: () => host.evaluate(node => (node as MonacoHost).monacoEditor!.focus()),
    press: async (keys: string) => { await host.evaluate(node => (node as MonacoHost).monacoEditor!.focus()); await page.keyboard.press(keys) },
    focused: () => host.evaluate(node => (node as MonacoHost).monacoEditor!.hasTextFocus())
  }
}
export const pluginWorkers = (page: Page) => page.workers().filter(worker => /plugin-worker/.test(worker.url()))
