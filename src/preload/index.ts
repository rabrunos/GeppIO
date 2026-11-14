import { contextBridge, ipcRenderer } from 'electron'
import { IDENTITY } from '../shared/identity.ts'
import type { PluginBridge } from '../shared/plugins.ts'
import type { WindowControls } from '../shared/window-controls.ts'
import type { PluginDataBridge } from '../shared/plugin-data.ts'
import type { DocumentBridge } from '../shared/documents.ts'
import type { ExplorerBridge } from '../shared/explorer.ts'
declare const __APP_VERSION__: string
const plugins: PluginBridge = Object.freeze({
  list: () => ipcRenderer.invoke('plugins:list'),
  install: () => ipcRenderer.invoke('plugins:install'),
  installFile: () => ipcRenderer.invoke('plugins:install-file'),
  setDeveloperMode: (enabled: boolean) => ipcRenderer.invoke('plugins:set-developer-mode', enabled),
  reload: (id: string) => ipcRenderer.invoke('plugins:reload', id),
  link: (id: string) => ipcRenderer.invoke('plugins:link', id),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('plugins:set-enabled', id, enabled),
  remove: (id: string) => ipcRenderer.invoke('plugins:remove', id)
})
const windowControls: WindowControls = Object.freeze({
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close')
})
const pluginData = Object.freeze<PluginDataBridge>({
  begin: (id, installation, generation) => ipcRenderer.invoke('plugin-data:begin', id, installation, generation),
  read: token => ipcRenderer.invoke('plugin-data:read', token),
  write: (token, expectedRevision, document) => ipcRenderer.invoke('plugin-data:write', token, expectedRevision, document),
  end: token => ipcRenderer.invoke('plugin-data:end', token)
})
const documents = Object.freeze<DocumentBridge>({
  open: draft => ipcRenderer.invoke('document:open', draft),
  save: draft => ipcRenderer.invoke('document:save', draft),
  release: draft => ipcRenderer.invoke('document:release', draft),
  close: (ticket, draft) => ipcRenderer.invoke('document:close', ticket, draft),
  onCloseRequested(listener) {
    const receive = (_event: Electron.IpcRendererEvent, ticket: string) => listener(ticket)
    ipcRenderer.on('document:close-requested', receive)
    return () => { ipcRenderer.removeListener('document:close-requested', receive) }
  }
})
const explorer = Object.freeze<ExplorerBridge>({
  select: () => ipcRenderer.invoke('explorer:select'),
  list: (root, node) => ipcRenderer.invoke('explorer:list', root, node),
  open: (root, node, draft) => ipcRenderer.invoke('explorer:open', root, node, draft),
  release: root => ipcRenderer.invoke('explorer:release', root)
})
const terminal = Object.freeze<import('../shared/terminal.ts').TerminalBridge>({
  read: (id, after) => ipcRenderer.invoke('terminal:read', id, after),
  start: () => ipcRenderer.invoke('terminal:start'),
  input: (id, data) => ipcRenderer.invoke('terminal:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  close: id => ipcRenderer.invoke('terminal:close', id)
})
contextBridge.exposeInMainWorld('geppio', Object.freeze({ name: IDENTITY.name, version: __APP_VERSION__, platform: process.platform, plugins, pluginData, windowControls, documents, explorer, terminal,
  demoFixtures: process.argv.includes('--geppio-demo-fixtures') }))
