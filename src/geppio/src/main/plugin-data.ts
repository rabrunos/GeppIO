import { lstat, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_LIMITS, dataRevision, exactKeys, parseDataDocument } from '../shared/plugin-data.ts'
import type { DataDocument, DataSnapshot } from '../shared/plugin-data.ts'
import { isRecord } from '../shared/plugins.ts'

/** Called only by PluginStore's serialized, identity-bound channel. No author paths. */
export class PluginDataStore {
  private readonly root: string
  private readonly replace: typeof rename
  constructor(root: string, replace: typeof rename = rename) { this.root = root; this.replace = replace }
  private async directory(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const stat = await lstat(this.root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Diretório de dados inválido. Dados preservados.')
  }
  async read(id: string, installation: string): Promise<DataSnapshot> {
    await this.directory()
    const path = join(this.root, installation + '.json')
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > DATA_LIMITS.bytes + 1024) throw new Error('Dados inválidos.')
      const bytes = await readFile(path)
      if (bytes.length > DATA_LIMITS.bytes + 1024) throw new Error('Dados muito grandes.')
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (!isRecord(value) || !exactKeys(value, ['schemaVersion', 'pluginId', 'installation', 'revision', 'document']) || value.schemaVersion !== 1 || value.pluginId !== id || value.installation !== installation || !dataRevision(value.revision) || value.revision < 1) throw new Error('Versão ou identidade inválida.')
      return { revision: value.revision, document: parseDataDocument(value.document) }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { revision: 0, document: null }
      throw new Error('Dados ilegíveis ou incompatíveis. Bytes preservados para recuperação; gravação bloqueada.', { cause: error })
    }
  }
  async write(id: string, installation: string, expectedRevision: number, document: DataDocument, valid: () => void): Promise<DataSnapshot> {
    const current = await this.read(id, installation)
    if (current.revision !== expectedRevision) throw new Error('Dados mudaram em outra gravação. Rascunho preservado; reabra após recuperar o texto.')
    const next = { revision: current.revision + 1, document }
    const temporary = join(this.root, 'write-' + randomUUID() + '.tmp')
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, pluginId: id, installation, ...next }), { flag: 'wx' })
      valid()
      await this.replace(temporary, join(this.root, installation + '.json'))
      return structuredClone(next)
    } finally {
      // A cleanup error must never turn a committed rename into a reported failed save.
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}
