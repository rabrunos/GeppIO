/// <reference types="vite/client" />
declare const __APP_VERSION__: string
interface Window { semnome?: Readonly<{ name: string; version: string; platform: string }> }
