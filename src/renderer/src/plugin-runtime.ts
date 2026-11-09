import { PLUGIN_LIMITS, isRecord, boundedText, parseWidgetView } from '../../shared/plugins.ts'
import type { InstalledPlugin, WidgetView } from '../../shared/plugins.ts'
import { dataRevision, exactKeys, parseDataDocument } from '../../shared/plugin-data.ts'
import type { PluginDataBridge } from '../../shared/plugin-data.ts'
import { parseWidgetViewV2, parseWidgetEvent, SURFACE_LIMITS } from '../../shared/plugin-surface.ts'
import type { WidgetViewV2, WidgetEvent } from '../../shared/plugin-surface.ts'

export interface RuntimePlugin {
  plugin: InstalledPlugin
  status: 'starting' | 'active' | 'stopping' | 'disabled' | 'error'
  detail: string
  events: string[]
  widgets: Record<string, WidgetView & Partial<WidgetViewV2>>
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
  token?: string
  dataRequests?: Set<number>
  eventQueue?: Promise<void>
  queuedEvents?: number
  inputStart?: number
  inputCount?: number
}
/** Identity is bound to each Worker callback, never accepted from a plugin payload. */
export class PluginRuntime {
  private entries = new Map<string, Running>()
  private requestId = 0
  private closed = false
  private readonly createWorker: () => PluginWorker
  private readonly changed: (views: RuntimePlugin[]) => void
  private readonly timeout: number
  private readonly data?: PluginDataBridge
  constructor(createWorker: () => PluginWorker, changed: (views: RuntimePlugin[]) => void, timeout: number = PLUGIN_LIMITS.timeoutMs, data?: PluginDataBridge) { this.createWorker = createWorker; this.changed = changed; this.timeout = timeout; this.data = data }
  private release(entry: Running): void { const token = entry.token; delete entry.token; if (token) void this.data?.end(token).catch(() => undefined) }
  private current(entry: Running): boolean { return !this.closed && this.entries.get(entry.view.plugin.manifest.id) === entry && ['starting', 'active'].includes(entry.view.status) }
  private emit(): void { if (!this.closed) this.changed([...this.entries.values()].map(entry => ({ ...entry.view, events: [...entry.view.events], widgets: { ...entry.view.widgets } }))) }
  private event(entry: Running, message: string): void { entry.view.events = [...entry.view.events.slice(-7), message]; entry.view.detail = message }
  private finish(entry: Running): void { if (entry.pending) { clearTimeout(entry.pending.timer); entry.pending.resolve(); delete entry.pending } }
  private isFailed(entry: Running): boolean { return entry.view.status === 'error' }
  private fail(entry: Running, message: string): void {
    this.release(entry)
    entry.worker.terminate(); entry.view.status = 'error'
    entry.view.widgets = entry.view.plugin.manifest.apiVersion === 2 ? Object.fromEntries(Object.entries(entry.view.widgets).map(([id, view]) => [id, { ...view, text: 'Falha no plugin. Texto pendente preservado; copie antes de tentar reativar. ' + message }])) : {}
    this.event(entry, message); this.finish(entry); this.emit()
  }
  private receive(entry: Running, value: unknown): void {
    if (entry.view.status === 'error' || entry.view.status === 'disabled') return
    try {
      if (Date.now() - entry.windowStart >= 1000) { entry.messages = 0; entry.windowStart = Date.now() }
      if (++entry.messages > (entry.view.plugin.manifest.apiVersion === 2 ? 120 : 60)) throw new Error('Plugin excedeu o limite de mensagens.')
      if (!isRecord(value)) throw new Error('Mensagem de plugin inválida.')
      if (value.type === 'data') { this.receiveData(entry, value); return }
      if (value.type === 'done') {
        if (!entry.pending || value.requestId !== entry.pending.id) throw new Error('Resposta de lifecycle inesperada.')
        this.finish(entry)
      } else if (value.type === 'failed' && boundedText(value.message)) this.fail(entry, 'Falha: ' + value.message)
      else if (value.type === 'status' && boundedText(value.message)) this.event(entry, value.message)
      else if (value.type === 'widget' && typeof value.widgetId === 'string' && entry.view.plugin.manifest.widgets.some(widget => widget.id === value.widgetId)) {
        const view = entry.view.plugin.manifest.apiVersion === 2 ? parseWidgetViewV2(value.view) : parseWidgetView(value.view)
        if (entry.view.status !== 'stopping') entry.view.widgets = { ...entry.view.widgets, [value.widgetId]: view }
      } else throw new Error('Mensagem ou contribuição não declarada no manifesto.')
      this.emit()
    } catch (error) { this.fail(entry, error instanceof Error ? error.message : 'Resposta inválida.') }
  }
  private receiveData(entry: Running, value: Record<string, unknown>): void {
    if (!this.current(entry) || entry.view.plugin.manifest.apiVersion !== 2 || !entry.token || !this.data || !Number.isSafeInteger(value.id) || (value.id as number) < 1 || !exactKeys(value, value.operation === 'read' ? ['type', 'id', 'operation'] : ['type', 'id', 'operation', 'expectedRevision', 'document'])) throw new Error('Solicitação de dados inválida.')
    const requests = entry.dataRequests ??= new Set<number>(), id = value.id as number
    if (requests.has(id) || requests.size >= 4) throw new Error('Solicitações de dados demais.')
    let pending
    if (value.operation === 'read') pending = this.data.read(entry.token)
    else if (value.operation === 'write' && dataRevision(value.expectedRevision)) {
      try { pending = this.data.write(entry.token, value.expectedRevision, parseDataDocument(value.document)) }
      catch (error) { entry.worker.postMessage({ type: 'data-result', id, result: { ok: false, error: error instanceof Error ? error.message : 'Documento inválido.' } }); return }
    }
    else throw new Error('Operação de dados inválida.')
    requests.add(id)
    void pending.catch(() => ({ ok: false as const, error: 'Armazenamento indisponível. Rascunho preservado.' })).then(result => {
      requests.delete(id)
      if (this.current(entry)) entry.worker.postMessage({ type: 'data-result', id, result })
    }).catch(() => this.fail(entry, 'Resposta de dados indisponível.'))
  }
  private request(entry: Running, type: string, data: Record<string, unknown> = {}): Promise<void> {
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
      if (plugin.manifest.apiVersion === 2) {
        try {
          const result = await this.data?.begin(id, plugin.revision)
          if (!result?.ok) throw new Error(result && !result.ok ? result.error : 'Dados v2 indisponíveis.')
          if (!this.current(entry)) { void this.data?.end(result.value); continue }
          entry.token = result.value
        } catch (error) { this.fail(entry, error instanceof Error ? error.message : 'Dados indisponíveis.'); continue }
      }
      await this.request(entry, 'activate', { entry: `geppio://app/plugins/${id}/${plugin.revision}/${plugin.manifest.entry}`, pluginId: id, apiVersion: plugin.manifest.apiVersion })
      if (entry.view.status === 'starting') { entry.view.status = 'active'; this.event(entry, 'activate concluído.') }
      this.emit()
    }
    this.emit()
  }
  async stop(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || entry.view.status === 'disabled') return
    this.release(entry)
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
  async widgetEvent(id: string, widgetId: string, input: WidgetEvent): Promise<boolean> {
    const entry = this.entries.get(id), view = entry?.view.widgets[widgetId]
    if (!entry || entry.view.status !== 'active' || entry.view.plugin.manifest.apiVersion !== 2 || !view || (entry.queuedEvents ?? 0) >= 8) return false
    let event: WidgetEvent
    try { event = parseWidgetEvent(input, view) } catch { return false }
    if (Date.now() - (entry.inputStart ?? 0) >= 1000) { entry.inputStart = Date.now(); entry.inputCount = 0 }
    if ((entry.inputCount = (entry.inputCount ?? 0) + 1) > SURFACE_LIMITS.events) return false
    entry.queuedEvents = (entry.queuedEvents ?? 0) + 1
    let delivered = false
    const pending = (entry.eventQueue ?? Promise.resolve()).then(async () => {
      if (!this.current(entry) || entry.view.status !== 'active') return
      try { parseWidgetEvent(event, entry.view.widgets[widgetId]!) } catch { return }
      await this.request(entry, 'event', { widgetId, event }); delivered = this.current(entry)
    }).finally(() => { entry.queuedEvents!-- })
    entry.eventQueue = pending.catch(() => undefined)
    await pending; return delivered
  }
  shutdown(): void {
    this.closed = true
    for (const entry of this.entries.values()) { this.release(entry); entry.worker.terminate(); this.finish(entry) }
    this.entries.clear()
  }
}
