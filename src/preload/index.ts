import { contextBridge, ipcRenderer } from 'electron'
import { IDENTITY } from '../shared/identity.ts'
import type { PluginBridge } from '../shared/plugins.ts'
declare const __APP_VERSION__: string
const plugins: PluginBridge = Object.freeze({
  list: () => ipcRenderer.invoke('plugins:list'),
  install: () => ipcRenderer.invoke('plugins:install'),
  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('plugins:set-enabled', id, enabled),
  remove: (id: string) => ipcRenderer.invoke('plugins:remove', id)
})
contextBridge.exposeInMainWorld('geppio', Object.freeze({ name: IDENTITY.name, version: __APP_VERSION__, platform: process.platform, plugins }))
