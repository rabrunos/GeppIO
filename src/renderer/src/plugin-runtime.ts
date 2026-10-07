import { PLUGIN_LIMITS, isRecord, boundedText, parseWidgetView } from '../../shared/plugins.ts'
import type { InstalledPlugin, WidgetView } from '../../shared/plugins.ts'

export interface RuntimePlugin {
  plugin: InstalledPlugin
  status: 'starting' | 'active' | 'stopping' | 'disabled' | 'error'
  detail: string
  events: string[]
  widgets: Record<string, WidgetView>
}
export interface PluginWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(value: unknown): void
  terminate(): void
}
interface Running {
  worker: PluginWorker
  view: RuntimePlugin
  pending?: { id: number; resolve(): void; timer: ReturnType<typeof setTimeout> }
  messages: number
  windowStart: number
}
/** Identity is bound to each Worker callback, never accepted from a plugin payload. */
export class PluginRuntime {
  private entries = new Map<string, Running>()
  private requestId = 0
  private closed = false
  private readonly createWorker: () => PluginWorker
  private readonly changed: (views: RuntimePlugin[]) => void
  private readonly timeout: number
  constructor(createWorker: () => PluginWorker, changed: (views: RuntimePlugin[]) => void, timeout: number = PLUGIN_LIMITS.timeoutMs) { this.createWorker = createWorker; this.changed = changed; this.timeout = timeout }
  private emit(): void { if (!this.closed) this.changed([...this.entries.values()].map(entry => ({ ...entry.view, events: [...entry.view.events], widgets: { ...entry.view.widgets } }))) }
  private event(entry: Running, message: string): void { entry.view.events = [...entry.view.events.slice(-7), message]; entry.view.detail = message }
  private finish(entry: Running): void { if (entry.pending) { clearTimeout(entry.pending.timer); entry.pending.resolve(); delete entry.pending } }
  private isFailed(entry: Running): boolean { return entry.view.status === 'error' }
  private fail(entry: Running, message: string): void {
    entry.worker.terminate(); entry.view.status = 'error'; entry.view.widgets = {}; this.event(entry, message); this.finish(entry); this.emit()
  }
  private receive(entry: Running, value: unknown): void {
    if (entry.view.status === 'error' || entry.view.status === 'disabled') return
    try {
      if (Date.now() - entry.windowStart >= 1000) { entry.messages = 0; entry.windowStart = Date.now() }
      if (++entry.messages > 60) throw new Error('Plugin excedeu o limite de mensagens.')
      if (!isRecord(value)) throw new Error('Mensagem de plugin inválida.')
      if (value.type === 'done') {
        if (!entry.pending || value.requestId !== entry.pending.id) throw new Error('Resposta de lifecycle inesperada.')
        this.finish(entry)
      } else if (value.type === 'failed' && boundedText(value.message)) this.fail(entry, 'Falha: ' + value.message)
      else if (value.type === 'status' && boundedText(value.message)) this.event(entry, value.message)
      else if (value.type === 'widget' && typeof value.widgetId === 'string' && entry.view.plugin.manifest.widgets.some(widget => widget.id === value.widgetId)) {
        const view = parseWidgetView(value.view)
        if (entry.view.status !== 'stopping') entry.view.widgets = { ...entry.view.widgets, [value.widgetId]: view }
      } else throw new Error('Mensagem ou contribuição não declarada no manifesto.')
      this.emit()
    } catch (error) { this.fail(entry, error instanceof Error ? error.message : 'Resposta inválida.') }
  }
  private request(entry: Running, type: string, data: Record<string, string> = {}): Promise<void> {
    if (entry.pending) return Promise.resolve()
    return new Promise(resolve => {
      const id = ++this.requestId
      entry.pending = { id, resolve, timer: setTimeout(() => this.fail(entry, 'Tempo limite no lifecycle: ' + type + '.'), this.timeout) }
      try { entry.worker.postMessage({ type, requestId: id, ...data }) }
      catch { this.fail(entry, 'Não foi possível comunicar com o plugin.') }
    })
  }
  async sync(plugins: InstalledPlugin[]): Promise<void> {
    for (const [id, entry] of this.entries) {
      const plugin = plugins.find(item => item.manifest.id === id)
      if (!plugin || plugin.revision !== entry.view.plugin.revision) { await this.stop(id); this.entries.delete(id) }
      else if (!plugin.enabled) { await this.stop(id); entry.view.plugin = plugin }
    }
    for (const plugin of plugins) {
      if (this.closed) return
      const id = plugin.manifest.id, existing = this.entries.get(id)
      if (existing && (existing.view.status !== 'disabled' || !plugin.enabled)) { existing.view.plugin = plugin; continue }
      if (!plugin.enabled) {
        const worker: PluginWorker = { onmessage: null, onerror: null, onmessageerror: null, postMessage() {}, terminate() {} }
        this.entries.set(id, { worker, view: { plugin, status: 'disabled', detail: 'Instalado; não executado.', events: [], widgets: {} }, messages: 0, windowStart: Date.now() }); continue
      }
      let worker: PluginWorker
      try { worker = this.createWorker() }
      catch { worker = { onmessage: null, onerror: null, onmessageerror: null, postMessage() { throw new Error('Worker indisponível.') }, terminate() {} } }
      const entry: Running = { worker, view: { plugin, status: 'starting', detail: 'Carregando módulo local…', events: existing?.view.events ?? [], widgets: {} }, messages: 0, windowStart: Date.now() }
      this.entries.set(id, entry)
      worker.onmessage = event => this.receive(entry, event.data)
      worker.onerror = event => { event.preventDefault(); this.fail(entry, 'Exceção ou módulo inválido no plugin.') }
      worker.onmessageerror = () => this.fail(entry, 'Resposta não serializável do plugin.')
      this.emit()
      await this.request(entry, 'activate', { entry: `semnome://app/plugins/${id}/${plugin.revision}/${plugin.manifest.entry}`, pluginId: id })
      if (entry.view.status === 'starting') { entry.view.status = 'active'; this.event(entry, 'activate concluído.') }
      this.emit()
    }
    this.emit()
  }
  async stop(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || entry.view.status === 'disabled') return
    const failed = entry.view.status === 'error'
    if (!failed) {
      if (entry.pending) { entry.worker.terminate(); this.finish(entry); this.event(entry, 'Operação interrompida; Worker encerrado.') }
      else { entry.view.status = 'stopping'; entry.view.widgets = {}; this.emit(); await this.request(entry, 'dispose'); if (!this.isFailed(entry)) this.event(entry, 'dispose concluído; Worker encerrado.') }
    }
    entry.worker.terminate(); entry.view.widgets = {}; entry.view.status = 'disabled'; this.emit()
  }
  async action(id: string, widgetId: string, actionId: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry?.view.status !== 'active' || entry.pending || entry.view.widgets[widgetId]?.action?.id !== actionId) return
    await this.request(entry, 'action', { widgetId, actionId })
  }
  shutdown(): void {
    this.closed = true
    for (const entry of this.entries.values()) { entry.worker.terminate(); this.finish(entry) }
    this.entries.clear()
  }
}
