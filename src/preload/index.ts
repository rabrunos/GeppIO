import { contextBridge, ipcRenderer } from 'electron'
import { IDENTITY } from '../shared/identity.ts'
import type { PluginBridge } from '../shared/plugins.ts'
import type { WindowControls } from '../shared/window-controls.ts'
import type { PluginDataBridge } from '../shared/plugin-data.ts'
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
contextBridge.exposeInMainWorld('geppio', Object.freeze({ name: IDENTITY.name, version: __APP_VERSION__, platform: process.platform, plugins, pluginData, windowControls,
  demoFixtures: process.argv.includes('--geppio-demo-fixtures') }))
