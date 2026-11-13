import { open, lstat } from 'node:fs/promises'
import { createPublicKey, verify } from 'node:crypto'
import { extname } from 'node:path'
import { isRecord, packagePath, parseManifest, PLUGIN_LIMITS } from '../shared/plugins.ts'
import type { PluginManifest } from '../shared/plugins.ts'
import { PLUGIN_TRUST } from './plugin-trust.ts'
import type { PluginTrustEntry } from './plugin-trust.ts'

export interface Package { manifest: PluginManifest; files: Map<string, Uint8Array> }
export const PACKAGE_LIMITS = Object.freeze({ bytes: 3 * 1024 * 1024, metadataBytes: 1024 })
export const PACKAGE_MAGIC = Buffer.from('GEPPIOPK', 'ascii')
export const PACKAGE_DOMAIN = Buffer.from('GeppIO signed plugin package\0Ed25519\0v1\0', 'ascii')
const decoder = new TextDecoder('utf-8', { fatal: true })
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) }

/** Validate the entire file namespace, including implicit directories, on every platform. */
export function validatePackageFiles(files: Map<string, Uint8Array>): Package {
  const paths = new Map<string, 'file' | 'directory'>()
  let total = 0
  for (const [path, bytes] of files) {
    if (!packagePath(path) || path.split('/').length > 9 || !['.js', '.json'].includes(extname(path)) || bytes.length > PLUGIN_LIMITS.fileBytes) throw new Error('Caminho, tipo ou tamanho inválido no pacote.')
    total += bytes.length
    if (total > PLUGIN_LIMITS.packageBytes) throw new Error('Pacote maior que 2 MiB.')
    const parts = path.toLowerCase().split('/')
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('/'), kind = i === parts.length ? 'file' : 'directory'
      if (paths.has(key) && (kind === 'file' || paths.get(key) !== kind)) throw new Error('Caminhos duplicados ou conflitantes no pacote.')
      paths.set(key, kind)
    }
  }
  if (paths.size > PLUGIN_LIMITS.files) throw new Error('Pacote com arquivos demais.')
  // Directory spelling must also be unique under Windows case folding.
  const spelling = new Map<string, string>()
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/'), lower = name.toLowerCase()
      if (spelling.has(lower) && spelling.get(lower) !== name) throw new Error('Colisão de nomes no pacote.')
      spelling.set(lower, name)
    }
  }
  const bytes = files.get('plugin.json')
  if (!bytes) throw new Error('plugin.json não encontrado.')
  const manifest = parseManifest(decoder.decode(bytes))
  if (!files.has(manifest.entry)) throw new Error('Módulo de entrada não encontrado.')
  return { manifest, files }
}

/** One bounded read from an open regular file. The returned buffer is the only install input. */
export async function readPackageSnapshot(path: string): Promise<Buffer> {
  const initial = await lstat(path)
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error('Escolha um arquivo de pacote regular.')
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size < 84 || stat.size > PACKAGE_LIMITS.bytes) throw new Error('Arquivo de pacote inválido ou maior que 3 MiB.')
    const bytes = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length !== stat.size) throw new Error('Pacote mudou durante a leitura.')
    return bytes.subarray(0, length)
  } finally { await file.close() }
}

/** Authenticate framing and raw metadata/payload before parsing any payload entries. */
export function verifyPluginPackage(input: Uint8Array, roots: readonly Readonly<PluginTrustEntry>[] = PLUGIN_TRUST): Package & { publisher: string; keyId: string } {
  const bytes = Buffer.from(input)
  if (bytes.length < 84 || bytes.length > PACKAGE_LIMITS.bytes || !bytes.subarray(0, 8).equals(PACKAGE_MAGIC) || bytes.readUInt32BE(8) !== 1) throw new Error('Formato ou versão do pacote inválido.')
  const metadataLength = bytes.readUInt32BE(12), payloadLength = bytes.readUInt32BE(16), end = 20 + metadataLength + payloadLength
  if (!metadataLength || metadataLength > PACKAGE_LIMITS.metadataBytes || end + 64 !== bytes.length) throw new Error('Enquadramento do pacote inválido.')
  const metadata: unknown = JSON.parse(decoder.decode(bytes.subarray(20, 20 + metadataLength)))
  if (!isRecord(metadata) || !exact(metadata, ['keyId', 'pluginId']) || typeof metadata.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.keyId) || metadata.pluginId !== 'geppio.workspace-essentials') throw new Error('Identidade do pacote inválida.')
  const root = roots.find(root => root.keyId === metadata.keyId && root.pluginId === metadata.pluginId && !root.revoked)
  if (!root) throw new Error('Publicador desconhecido, revogado ou fora do escopo autorizado.')
  const key = createPublicKey(root.publicKey)
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.concat([PACKAGE_DOMAIN, bytes.subarray(0, end)]), key, bytes.subarray(end))) throw new Error('Assinatura do pacote inválida.')
  const entries: unknown = JSON.parse(decoder.decode(bytes.subarray(20 + metadataLength, end)))
  if (!Array.isArray(entries) || entries.length > PLUGIN_LIMITS.files) throw new Error('Entradas do pacote inválidas.')
  const files = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (!isRecord(entry) || !exact(entry, ['path', 'type', 'content']) || !packagePath(entry.path) || entry.type !== 'file' || typeof entry.content !== 'string' || entry.content.length > 4 * Math.ceil(PLUGIN_LIMITS.fileBytes / 3) || files.has(entry.path)) throw new Error('Entrada de pacote inválida ou duplicada.')
    const content = Buffer.from(entry.content, 'base64')
    if (content.toString('base64') !== entry.content) throw new Error('Conteúdo de pacote inválido.')
    files.set(entry.path, content)
  }
  const pkg = validatePackageFiles(files)
  if (pkg.manifest.id !== root.pluginId) throw new Error('Plugin fora do escopo da chave.')
  return { ...pkg, publisher: root.publisher, keyId: root.keyId }
}
