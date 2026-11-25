import type { RecoveryBridge, RecoveryStatus } from '../../../shared/draft-recovery.ts'
import type { DocumentDraft } from '@geppio/runtime/documents'
import type { EditorSession } from './session.ts'

const lost = 'Não foi possível confirmar a cópia local. Confira o estado antes de tentar novamente.'
type Phase = 'loading' | 'ready' | 'pending' | 'confirmed' | 'failed'
interface View { status: RecoveryStatus | null; phase: Phase; message: string | null; busy: boolean }

/** Subscribed to the Core editor even when no editor presentation is mounted. */
export class EditorRecovery {
  private editor: EditorSession
  private bridge: RecoveryBridge
  private state: View = { status: null, phase: 'loading', message: null, busy: false }
  private listeners = new Set<() => void>()
  private seen = new Map<string, DocumentDraft>()
  private pending = new Map<string, DocumentDraft>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private first: number | null = null
  private sequence = 0
  private active = 0
  private writing = false
  private diskVersion = -1
  constructor(editor: EditorSession, bridge: RecoveryBridge) { this.editor = editor; this.bridge = bridge }
  view = () => this.state
  subscribe = (listen: () => void) => { this.listeners.add(listen); return () => { this.listeners.delete(listen) } }
  private update(patch: Partial<View>) { this.state = { ...this.state, ...patch }; for (const listen of this.listeners) listen() }
  private observe = () => {
    const state = this.editor.snapshot(), live = new Set(state.tabs.map(tab => tab.document.id))
    for (const id of this.seen.keys()) if (!live.has(id)) { this.seen.delete(id); this.pending.delete(id) }
    let changed = false
    for (const tab of state.tabs) {
      const { id, revision, untitled } = tab.document, old = this.seen.get(id)
      if (old?.text === tab.text && old.revision === revision) continue
      const draft = { id, revision, text: tab.text }
      this.seen.set(id, draft)
      if (tab.detached || tab.text === tab.document.text && !untitled && (!old || old.revision !== revision)) {
        this.pending.delete(id); continue
      }
      this.pending.set(id, draft); changed = true
    }
    if (changed && this.state.status?.enabled && !this.state.busy && this.state.phase !== 'failed') this.schedule()
    if (this.diskVersion !== state.diskVersion) {
      this.diskVersion = state.diskVersion
      if (this.state.status && !this.state.busy) void this.refresh()
    }
  }
  private schedule() {
    if (!this.pending.size) return
    this.first ??= Date.now()
    this.update({ phase: 'pending' }); clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.flush() }, Math.max(0, Math.min(500, this.first + 2000 - Date.now())))
  }
  private async flush() {
    if (this.writing || this.state.busy || !this.state.status?.enabled || this.state.phase === 'failed') return
    const changes = [...this.pending.values()], epoch = this.state.status.epoch, lifecycle = this.active
    if (!changes.length) { this.first = null; this.update({ phase: 'ready' }); return }
    this.writing = true; this.pending.clear(); this.first = null
    try {
      const status = await this.bridge.snapshot(epoch, ++this.sequence, changes)
      if (lifecycle !== this.active || this.state.status?.epoch !== epoch) return
      if (status.staleIds?.length && status.epoch === epoch && !status.error) {
        for (const d of changes) {
          const live = this.editor.documentState(d.id)
          if (!status.staleIds.includes(d.id) && live && !live.detached && live.document.revision === d.revision && !this.pending.has(d.id)) this.pending.set(d.id, { ...d, text: live.text })
        }
        this.update({ phase: this.pending.size ? 'pending' : 'ready' }); return
      }
      if (status.staleIds) throw new Error(lost)
      if (!status.epoch || status.error) {
        // A save/rename may supersede this in-flight native revision. Its older receipt has no authority over new edits.
        const superseded = changes.every(d => this.editor.documentState(d.id)?.document.revision !== d.revision)
        if (!status.epoch && superseded) { this.update({ phase: 'ready' }); return }
        throw new Error(status.error ?? lost)
      }
      this.update({ status, phase: this.pending.size ? 'pending' : 'confirmed', message: null })
    } catch (error) {
      if (lifecycle === this.active && this.state.status?.epoch === epoch)
        this.update({ phase: 'failed', message: error instanceof Error && error.message !== '' && error.message === this.state.status?.error ? error.message : lost })
      if (lifecycle === this.active) await this.refresh()
    } finally {
      this.writing = false
      if (lifecycle === this.active && this.pending.size && !this.state.busy && this.view().phase !== 'failed') this.schedule()
    }
  }
  async refresh() {
    const lifecycle = this.active, previous = this.state.status?.epoch
    try {
      const status = await this.bridge.read()
      if (lifecycle !== this.active || previous !== this.state.status?.epoch) return
      if (!status.epoch) throw new Error()
      this.update({ status, ...(status.error ? { phase: 'failed' as const, message: status.error } : {}) })
    } catch { if (lifecycle === this.active) this.update({ phase: 'failed', message: lost }) }
  }
  connect() {
    const lifecycle = ++this.active, unsubscribe = this.editor.subscribe(this.observe)
    void this.refresh().then(() => {
      if (lifecycle !== this.active) return
      if (this.state.phase === 'loading') this.update({ phase: 'ready' })
      this.observe(); if (this.state.status?.enabled && this.state.phase !== 'failed') this.schedule()
    })
    return () => { this.active++; unsubscribe(); clearTimeout(this.timer) }
  }
  private canAct() { return !this.state.busy && !this.editor.locked && !this.editor.snapshot().busy && !!this.state.status }
  async configure(action: 'clear' | 'toggle') {
    if (!this.canAct()) return
    const status = this.state.status!
    this.update({ busy: true }); clearTimeout(this.timer)
    try {
      const next = action === 'clear' ? await this.bridge.clear(status.epoch) : await this.bridge.configure(status.epoch, !status.enabled)
      if (!next.epoch) throw new Error()
      if (next.epoch !== status.epoch) {
        this.pending.clear(); this.first = null
        if (!status.enabled && next.enabled) this.seen.clear()
      }
      this.update({ status: next, message: next.error, phase: next.error ? 'failed' : 'ready' })
    } catch { this.update({ phase: 'failed', message: lost }) }
    finally { this.update({ busy: false }); this.observe(); if (this.state.status?.enabled && this.state.phase !== 'failed') this.schedule() }
  }
  async retry() {
    if (this.state.busy || this.editor.locked || this.editor.snapshot().busy || this.writing) return
    const previous = this.state.status?.epoch
    await this.refresh()
    if (!this.state.status) return
    const status = await this.bridge.configure(this.state.status.epoch, this.state.status.enabled).catch(() => null)
    if (!status?.epoch) { this.update({ phase: 'failed', message: lost }); return }
    if (status.error) { this.update({ status, phase: 'failed', message: status.error }); return }
    this.pending.clear()
    if (previous === status.epoch && status.enabled) this.seen.clear()
    this.update({ status, phase: 'ready', message: null }); this.observe()
  }
  async restore(key: string) {
    if (!this.canAct()) return
    const epoch = this.state.status!.epoch
    this.update({ busy: true })
    let recovered: DocumentDraft | undefined
    try {
      const opened = await this.editor.openAuthorized(async () => {
        const reply = await this.bridge.restore(epoch, key)
        if (reply.result.ok && reply.result.document && typeof reply.text === 'string') recovered = { id: reply.result.document.id, revision: reply.result.document.revision, text: reply.text }
        return reply.result
      })
      if (!opened || !recovered || !this.editor.adoptRecoveredText(recovered.id, recovered.revision, recovered.text)) throw new Error()
      this.pending.delete(recovered.id)
      const adopted = await this.bridge.snapshot(epoch, ++this.sequence, [recovered])
      if (adopted.epoch !== epoch || adopted.staleIds) throw new Error()
      this.update({ status: adopted, phase: adopted.error ? 'failed' : 'confirmed', message: adopted.error })
      this.editor.feedback('Rascunho recuperado. Use Salvar como para escolher o destino.')
    } catch { this.update({ phase: 'failed', message: 'Não foi possível abrir a cópia. Confira as abas e as cópias locais.' }) }
    finally { this.update({ busy: false }); this.observe(); if (this.state.phase !== 'failed') this.schedule() }
  }
}
