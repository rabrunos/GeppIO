import { contextBridge, ipcRenderer } from 'electron'
import { IDENTITY } from '../shared/identity.ts'
import type { PluginBridge } from '../shared/plugins.ts'
import type { WindowControls } from '../shared/window-controls.ts'
declare const __APP_VERSION__: string
const plugins: PluginBridge = Object.freeze({
  list: () => ipcRenderer.invoke('plugins:list'),
  install: () => ipcRenderer.invoke('plugins:install'),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('plugins:set-enabled', id, enabled),
  remove: (id: string) => ipcRenderer.invoke('plugins:remove', id)
})
const windowControls: WindowControls = Object.freeze({
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close')
})
contextBridge.exposeInMainWorld('geppio', Object.freeze({ name: IDENTITY.name, version: __APP_VERSION__, platform: process.platform, plugins, windowControls,
  demoFixtures: process.argv.includes('--geppio-demo-fixtures') }))
