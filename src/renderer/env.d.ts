/// <reference types="vite/client" />
declare const __APP_VERSION__: string
interface Window { geppio?: Readonly<{ demoFixtures: boolean; name: string; version: string; platform: string; plugins: import('../shared/plugins.ts').PluginBridge; pluginData: import('../shared/plugin-data.ts').PluginDataBridge; windowControls: import('../shared/window-controls.ts').WindowControls; documents: import('../shared/documents.ts').DocumentBridge; explorer: import('../shared/explorer.ts').ExplorerBridge; terminal: import('../shared/terminal.ts').TerminalBridge }> }
