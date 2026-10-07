import { resolve, relative, isAbsolute, extname } from 'node:path'
import { IDENTITY } from '../shared/identity.ts'
export const PRODUCTION_CSP = "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
export const DEVELOPMENT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' semnome://app; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:5173; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }
/** Resolve only bundled renderer assets. Never accepts an arbitrary filesystem path. */
export function rendererAsset(root: string, source: string): { path: string; mime: string } | null {
  try {
    const url = new URL(source)
    if (url.protocol !== IDENTITY.protocol + ':' || url.hostname !== IDENTITY.host || url.port || url.username || url.password) return null
    const decoded = decodeURIComponent(url.pathname)
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) return null
    const destination = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded))
    const rel = relative(root, destination)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    const mime = TYPES[extname(destination)]
    return mime ? { path: destination, mime } : null
  } catch { return null }
}
export function validatedDevURL(value: string): string {
  const url = new URL(value)
  if (url.origin !== 'http://127.0.0.1:5173' || url.username || url.password) throw new Error('Unexpected development server')
  return url.href
}
