import { randomUUID } from 'node:crypto'
import type { DocumentDraft } from '@geppio/runtime/documents'
import type { RecoveryStatus } from '../shared/draft-recovery.ts'
import { validExplorerBasename } from '../shared/explorer.ts'
import { DraftStorage, RecoveryQuota, RecoveryStale, encodeGeneration } from './draft-storage.ts'
import type { DraftGeneration } from './draft-storage.ts'
import { DocumentStore } from './documents.ts'

const diskError = 'Falha ao confirmar a cópia local. Confira as cópias disponíveis. Se o arquivo do perfil estiver danificado, recupere o texto antes de limpar as cópias.'
const quotaError = 'Cópias pausadas. O limite é de oito rascunhos e 8 MiB. Restaure e salve os rascunhos disponíveis para liberar espaço.'
interface Binding { key: string; sequence: number; revision: string }
/** The persisted key identifies plaintext only. A live document grant never survives frame revocation. */
export class DraftRecovery {
  private storage: DraftStorage
  private documents: DocumentStore
  private data: DraftGeneration = { enabled: true, records: [] }
  private bindings = new Map<string, Binding>()
  private submitted = new Map<string, number>()
  private offered = new Map<string, string>()
  private ready: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private epoch: string = randomUUID()
  private sequence = 0
  private error: string | null = null
  private attempted: { data: DraftGeneration; commit: () => void; epoch: string; bindings?: Map<string, Binding> } | null = null
  private pendingRemoval = new Set<string>()
  constructor(root: string, documents: DocumentStore, storage = new DraftStorage(root)) {
    this.documents = documents; this.storage = storage
    this.ready = this.storage.load().then(value => { this.data = value; if (this.storage.interrupted) this.error = diskError }).catch(() => { this.error = diskError })
  }
  revoke() { this.bindings.clear(); this.offered.clear(); this.submitted.clear(); this.epoch = randomUUID(); this.sequence = 0 }
  status(): RecoveryStatus {
    const live = new Set([...this.bindings.values()].map(binding => binding.key))
    return { enabled: this.data.enabled, epoch: this.epoch, error: this.error,
      choices: this.data.records.filter(record => !live.has(record.key)).map(({ key, name, bom }) => ({ key, name, bom })) }
  }
  async read() { await this.ready; await this.queue; return this.status() }
  private serial<T>(action: () => Promise<T>) {
    const result = this.queue.then(async () => { await this.ready; return action() })
    this.queue = result.catch(() => undefined)
    return result
  }
  private async write(candidate: DraftGeneration, current: () => boolean, commit: () => void, reset = false, bindings?: Map<string, Binding>) {
    if (!current()) throw new RecoveryStale()
    if (this.error === diskError && !reset) return false
    const epoch = this.epoch
    try {
      await this.storage.write(candidate, current, reset)
      this.data = candidate; this.attempted = null; this.error = null
      if (this.epoch === epoch) commit()
      return true
    } catch (error) {
      if (error instanceof RecoveryStale) throw error
      this.error = error instanceof RecoveryQuota ? quotaError : diskError
      if (this.error === diskError) this.attempted = { data: candidate, commit, epoch, bindings }
      return false
    }
  }
  snapshot(epoch: string, sequence: number, drafts: DocumentDraft[], caller: () => boolean) {
    if (this.epoch !== epoch || sequence <= this.sequence || !caller()) throw new RecoveryStale()
    this.sequence = sequence
    const docs = this.documents.snapshots
    const changes = drafts.map(draft => {
      const doc = docs.find(doc => doc.id === draft.id && doc.revision === draft.revision)
      if (!doc) throw new RecoveryStale()
      return { draft, doc }
    })
    for (const { doc } of changes) this.submitted.set(doc.id, sequence)
    const current = () => this.epoch === epoch && caller() && changes.every(({ doc }) =>
      this.submitted.get(doc.id) === sequence && this.documents.snapshots.some(native => native.id === doc.id && native.revision === doc.revision))
    return this.serial(async () => {
      if (!current()) throw new RecoveryStale()
      if (!this.data.enabled) return this.status()
      const records = new Map(this.data.records.map(record => [record.key, record]))
      let changed = false
      const accepted = new Map<string, Binding>()
      for (const { doc, draft } of changes) {
        const original = records.get(this.offered.get(doc.id) ?? '')
        // Only exact text adopted by the renderer can take ownership of the recovery record.
        const key = this.bindings.get(doc.id)?.key ?? (original && original.text === draft.text ? original.key : randomUUID())
        const name = validExplorerBasename(doc.name) ? doc.name : 'Rascunho', old = records.get(key)
        accepted.set(doc.id, { key, sequence, revision: doc.revision })
        if (!doc.untitled && draft.text === doc.text) { changed = records.delete(key) || changed; continue }
        if (old?.name === name && old.bom === doc.bom && old.text === draft.text) continue
        records.set(key, { key, version: randomUUID(), name, bom: doc.bom, text: draft.text }); changed = true
      }
      const adopt = () => {
        const live = new Set(this.documents.snapshots.map(doc => doc.id))
        for (const [id, binding] of accepted) if (live.has(id)) { this.bindings.set(id, binding); this.offered.delete(id) }
      }
      if (changed) await this.write({ enabled: true, records: [...records.values()] }, current, adopt, false, accepted)
      else adopt()
      return this.status()
    })
  }
  /** Capture the latest submitted generation BEFORE the native decision. Later edits own later sequence numbers. */
  capture() { return new Map(this.submitted) }
  retire(ids: string[], captured: Map<string, number>, caller: () => boolean, resolved: readonly DocumentDraft[] = []) {
    const epoch = this.epoch
    return this.serial(async () => {
      const covered = (id: string, binding: Binding | undefined, generation: DraftGeneration) => {
        if (!binding) return false
        if (binding.sequence <= (captured.get(id) ?? -1)) return true
        const draft = resolved.find(item => item.id === id && item.revision === binding.revision)
        return !!draft && generation.records.some(record => record.key === binding.key && record.text === draft.text)
      }
      const eligible = ids.filter(id => covered(id, this.bindings.get(id), this.data))
      const keys = new Set(eligible.map(id => this.bindings.get(id)!.key))
      const current = () => caller() && this.epoch === epoch
      if (!current()) return
      const rememberRemoval = (generation: DraftGeneration, key: string) => {
        const record = generation.records.find(record => record.key === key)
        if (record) this.pendingRemoval.add(record.key + ':' + record.version)
      }
      if (this.error === diskError) {
        for (const key of keys) rememberRemoval(this.data, key)
        const attempted = this.attempted
        if (attempted?.epoch === epoch) for (const id of ids) {
          const binding = attempted.bindings?.get(id)
          if (binding && covered(id, binding, attempted.data)) rememberRemoval(attempted.data, binding.key)
        }
      }
      const records = this.data.records.filter(record => !keys.has(record.key))
      const forget = () => {
        for (const id of eligible) this.bindings.delete(id)
        for (const id of ids) if (!this.documents.snapshots.some(doc => doc.id === id)) {
          this.submitted.delete(id); this.offered.delete(id)
        }
      }
      if (records.length !== this.data.records.length) {
        if (!await this.write({ ...this.data, records }, current, forget)) for (const key of keys) rememberRemoval(this.data, key)
      }
      else forget()
    }).catch(error => { if (!(error instanceof RecoveryStale)) throw error })
  }
  restore(epoch: string, key: string, caller: () => boolean) {
    return this.serial(async () => {
      if (this.epoch !== epoch || !caller() || !this.status().choices.some(item => item.key === key)) throw new RecoveryStale()
      const record = this.data.records.find(record => record.key === key)!
      const offered = [...this.offered].find(([id, offeredKey]) => offeredKey === key && this.documents.snapshots.some(doc => doc.id === id && doc.untitled))
      const result = offered ? this.documents.activate(offered[0]) : this.documents.create({ name: record.name, bom: record.bom })
      if (!result.ok || !result.document) throw new RecoveryStale()
      for (const [id, previous] of this.offered) if (previous === key) this.offered.delete(id)
      this.offered.set(result.document.id, key)
      return { result, text: record.text }
    })
  }
  configure(epoch: string, enabled: boolean, caller: () => boolean) {
    const current = () => caller() && this.epoch === epoch
    return this.serial(async () => {
      if (!current()) throw new RecoveryStale()
      await this.write({ enabled, records: [] }, current, () => { this.pendingRemoval.clear(); this.revoke() }, true)
      return this.status()
    })
  }
  reconcile(epoch: string, caller: () => boolean) {
    const current = () => caller() && this.epoch === epoch
    return this.serial(async () => {
      if (!current()) throw new RecoveryStale()
      if (this.error === diskError) {
        // The user explicitly inspected a failed write. Preserve every confirmed row; never replay an unknown write.
        const attempted = this.attempted
        this.data = await this.storage.reconcile(this.data, current, attempted?.data)
        if (attempted?.epoch === this.epoch && encodeGeneration(this.data).equals(encodeGeneration(attempted.data))) attempted.commit()
        this.error = null; this.attempted = null
        const removals = new Set(this.pendingRemoval)
        if (removals.size && current()) {
          const matches = this.data.records.filter(record => removals.has(record.key + ':' + record.version))
          const keys = new Set(matches.map(record => record.key))
          const records = this.data.records.filter(record => !keys.has(record.key))
          const finish = () => {
            for (const [id, binding] of this.bindings) if (keys.has(binding.key)) this.bindings.delete(id)
            for (const revision of removals) this.pendingRemoval.delete(revision)
          }
          if (records.length === this.data.records.length) finish()
          else await this.write({ ...this.data, records }, current, finish)
        }
      } else if (this.error === quotaError) this.error = null
      return this.status()
    })
  }
}
