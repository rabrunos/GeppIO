import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/geppio/src/main/index.ts', external: ['node-pty', 'typescript'], output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  preload: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: { rollupOptions: { input: 'src/geppio/src/preload/index.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
  },
  renderer: {
    root: 'src/geppio/src/renderer',
    worker: { format: 'es' },
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: false, outDir: 'out/renderer', rollupOptions: { input: 'src/geppio/src/renderer/index.html' } }
  }
})
