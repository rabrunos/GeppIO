/// <reference types="vite/client" />
declare const __APP_VERSION__: string
interface Window { geppio?: Readonly<{ name: string; version: string; platform: string; plugins: import('../shared/plugins.ts').PluginBridge }> }
