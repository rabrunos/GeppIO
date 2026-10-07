import { contextBridge } from 'electron'
import { IDENTITY } from '../shared/identity.ts'
declare const __APP_VERSION__: string
// Static information only. No IPC dispatch, shell, filesystem, secrets or plugin loader.
contextBridge.exposeInMainWorld('semnome', Object.freeze({ name: IDENTITY.name, version: __APP_VERSION__, platform: process.platform }))
