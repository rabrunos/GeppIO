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
  create: () => ipcRenderer.invoke('document:create'),
  saveAs: (draft, reconcile) => ipcRenderer.invoke('document:saveAs', draft, reconcile),
  saveAll: drafts => ipcRenderer.invoke('document:saveAll', drafts),
  open: draft => ipcRenderer.invoke('document:open', draft),
  save: draft => ipcRenderer.invoke('document:save', draft),
  reload: (draft, confirmUnresolved) => ipcRenderer.invoke('document:reload', draft, confirmUnresolved),
  release: draft => ipcRenderer.invoke('document:release', draft),
  activate: id => ipcRenderer.invoke('document:activate', id),
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
  release: root => ipcRenderer.invoke('explorer:release', root),
  createFile: (root, node, name) => ipcRenderer.invoke('explorer:create-file', root, node, name),
  createDirectory: (root, node, name) => ipcRenderer.invoke('explorer:create-directory', root, node, name),
  renameFile: (root, node, name, ...binding) => ipcRenderer.invoke('explorer:rename-file', root, node, name, ...binding)
})
const terminal = Object.freeze<import('../shared/terminal.ts').TerminalBridge>({
  read: (id, after) => ipcRenderer.invoke('terminal:read', id, after),
  start: () => ipcRenderer.invoke('terminal:start'),
  input: (id, data) => ipcRenderer.invoke('terminal:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  close: id => ipcRenderer.invoke('terminal:close', id)
})
const git = Object.freeze<import('../shared/git.ts').GitBridge>({
  status: root => ipcRenderer.invoke('git:status', root),
  compare: (root, change) => ipcRenderer.invoke('git:compare', root, change),
  stage: (root, change) => ipcRenderer.invoke('git:stage', root, change),
  unstage: (root, change) => ipcRenderer.invoke('git:unstage', root, change),
  history: root => ipcRenderer.invoke('git:history', root),
  historyPage: (root, snapshot, cursor) => ipcRenderer.invoke('git:historyPage', root, snapshot, cursor),
  historyCommit: (root, snapshot, commit) => ipcRenderer.invoke('git:historyCommit', root, snapshot, commit),
  historyCompare: (root, snapshot, commit, file) => ipcRenderer.invoke('git:historyCompare', root, snapshot, commit, file)
})
const search = Object.freeze<import('../shared/search.ts').SearchBridge>({
  start: (root, query, matchCase, ...filters) => ipcRenderer.invoke('search:start', root, query, matchCase, ...filters),
  read: (job, offset) => ipcRenderer.invoke('search:read', job, offset),
  cancel: job => ipcRenderer.invoke('search:cancel', job),
  open: (job, match) => ipcRenderer.invoke('search:open', job, match),
  preview: (job, matches, replacement, marks) => ipcRenderer.invoke('search:preview', job, matches, replacement, marks),
  applyFile: (job, preview, file, marks) => ipcRenderer.invoke('search:applyFile', job, preview, file, marks)
})
const workspace = Object.freeze<import('../shared/workspace.ts').WorkspaceBridge>({
  read: () => ipcRenderer.invoke('workspace:read'),
  readTools: root => ipcRenderer.invoke('workspace:readTools', root),
  restore: () => ipcRenderer.invoke('workspace:restore'),
  standalone: () => ipcRenderer.invoke('workspace:standalone'),
  configure: remember => ipcRenderer.invoke('workspace:configure', remember),
  forget: () => ipcRenderer.invoke('workspace:forget'),
  remember: editor => ipcRenderer.invoke('workspace:remember', editor)
})
const portableLayouts = Object.freeze<import('../shared/portable-layout-bridge.ts').PortableLayoutBridge>({
  importFile: () => ipcRenderer.invoke('portable-layout:import'),
  exportFile: text => ipcRenderer.invoke('portable-layout:export', text)
})
const quickOpen = Object.freeze<import('../shared/quick-open.ts').QuickOpenBridge>({
  start: (root, query) => ipcRenderer.invoke('quick-open:start', root, query),
  read: (job, query) => ipcRenderer.invoke('quick-open:read', job, query),
  cancel: job => ipcRenderer.invoke('quick-open:cancel', job),
  open: (job, id) => ipcRenderer.invoke('quick-open:open', job, id)
})
contextBridge.exposeInMainWorld('geppio', Object.freeze({ name: IDENTITY.name, version: __APP_VERSION__, platform: process.platform, plugins, pluginData, windowControls, documents, explorer, terminal, git, workspace, search, portableLayouts, quickOpen,
  demoFixtures: process.argv.includes('--geppio-demo-fixtures') }))
