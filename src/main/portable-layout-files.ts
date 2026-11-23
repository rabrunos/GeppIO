import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { POLICY } from '../shared/freeform/policy.ts'
import type { PortableExport, PortableImport } from '../shared/portable-layout-bridge.ts'
import { parsePortableText, serializePortableLayout } from '../shared/workbench/portable.ts'
import { inspectSearchDocument } from './documents.ts'
import { inspectExplorerPath, safeExplorerName } from './explorer.ts'

export const portableExtension = 'geppio-layout.json'
const expired = 'A janela mudou durante a operação. Abra o seletor novamente.'
function selectedPath(path: string) {
  return isAbsolute(path) && resolve(path) === path && safeExplorerName(basename(path)) &&
    basename(path).toLowerCase().endsWith('.' + portableExtension)
}
function checkOwner(current: () => boolean) {
  if (!current()) throw new Error(expired)
}
async function readSelection(path: string, current: () => boolean) {
  const result = await inspectSearchDocument(path, {
    authorize: async () => checkOwner(current),
    check(size) {
      checkOwner(current)
      if (size > POLICY.maxBytes) throw new RangeError('Layout exceeds 64 KiB')
    },
    consume() { checkOwner(current) }
  })
  checkOwner(current)
  return result
}
export async function importLayoutFile(path: string, current: () => boolean): Promise<PortableImport> {
  if (!selectedPath(path)) return { ok: false, error: 'Selecione um arquivo .geppio-layout.json.' }
  try {
    checkOwner(current)
    return { ok: true, recipe: parsePortableText((await readSelection(path, current)).text) }
  } catch {
    return { ok: false, error: current() ? 'Composição ilegível ou incompatível. Verifique o formato e o limite de 64 KiB.' : expired }
  }
}

type CreateNew = (path: string) => Promise<Pick<FileHandle, 'stat' | 'writeFile' | 'sync' | 'close'>>
export async function exportLayoutFile(path: string, recipeText: string, current: () => boolean,
  create: CreateNew = path => open(path, 'wx', 0o600)): Promise<PortableExport> {
  if (!selectedPath(path)) return { ok: false, error: 'Escolha um nome terminado em .geppio-layout.json.' }
  let created = false
  try {
    const content = serializePortableLayout(parsePortableText(recipeText))
    checkOwner(current)
    const parent = dirname(path), directory = await inspectExplorerPath(parent, 'directory')
    checkOwner(current)
    const file = await create(path)
    created = true
    const verify = async (identity: BigIntStats) => {
      const observed = await lstat(path, { bigint: true })
      if (!observed.isFile() || observed.isSymbolicLink() || observed.nlink !== 1n ||
        observed.dev !== identity.dev || observed.ino !== identity.ino || observed.birthtimeNs !== identity.birthtimeNs ||
        (await inspectExplorerPath(parent, 'directory')).chain !== directory.chain) throw new Error('Selection changed')
      checkOwner(current)
    }
    let identity: BigIntStats
    try {
      identity = await file.stat({ bigint: true })
      await verify(identity)
      await file.writeFile(content, 'utf8')
      await file.sync()
    } finally { await file.close() }
    await verify(identity)
    const { witness } = await readSelection(path, current)
    if (witness.fingerprint !== createHash('sha256').update(content, 'utf8').digest('hex')) throw new Error('Unconfirmed output')
    await verify(identity)
    checkOwner(current)
    return { ok: true, canceled: false }
  } catch (error) {
    if (created) return { ok: false, unconfirmed: true, error: 'A saída pode estar vazia, parcial ou já gravada. Confira o arquivo antes de exportar novamente.' }
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return { ok: false, error: 'Esse arquivo já existe. Escolha um novo nome para a composição.' }
    return { ok: false, error: current() ? 'Não foi possível criar a composição no destino escolhido.' : expired }
  }
}
