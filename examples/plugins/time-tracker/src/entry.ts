import type { PluginContextV2, PluginInstanceV2, DataDocument } from '../../../../sdk/plugin-v2.d.ts'
import { emptyTracker, parseTracker, startTimer, pauseTimer, elapsed, duration, dailyTotals, trackerDocument, MAX_SESSIONS } from './model.ts'
import type { Tracker } from './model.ts'

export async function activate(context: PluginContextV2): Promise<PluginInstanceV2> {
  let confirmed = emptyTracker(), confirmedDocument: DataDocument | null = null, pending: Tracker | null = null
  let writable = true, state = 'Salvo.', active = true, page = 0
  try { const saved = await context.data.read(); confirmedDocument = saved.document; if (saved.document) confirmed = parseTracker(saved.document.value) }
  catch { writable = false; state = 'Falha ao ler histórico. Originais preservados; edição bloqueada.' }
  function publish() {
    if (!active) return
    const model = pending ?? confirmed, now = Date.now(), days = dailyTotals(model, now)
    const running = model.running ? elapsed(model.running.start, now) : 0
    const total = model.sessions.reduce((sum, item) => sum + elapsed(item.start, item.end), running)
    context.publishWidget('timer', { text: `${duration(running)} · ${model.running ? 'Em andamento' : 'Pausado'}\n${state}\n\nConta até Pausar, mesmo com o app fechado. ${model.sessions.length >= MAX_SESSIONS ? 'Limite de 200 sessões atingido; histórico preservado.' : 'Inicie para contar. Aguarde Salvo antes de fechar.'}`, actions: writable ? pending ? [{ id: 'retry', label: 'Tentar salvar novamente' }] : model.running ? [{ id: 'pause', label: 'Pausar' }] : model.sessions.length < MAX_SESSIONS ? [{ id: 'start', label: 'Iniciar' }] : [] : [] })
    const sessions = [...model.sessions].reverse(), offset = page * 12
    context.publishWidget('reports', { text: `Hoje: ${duration(days[0]!.ms)} · Total: ${duration(total)} · ${model.sessions.length} sessões\n${state}\n\nTotais diários (últimos 7 dias)\n${days.map(day => `${day.day}: ${duration(day.ms)}`).join('\n')}\n\nSessões · página ${page + 1}\n${sessions.slice(offset, offset + 12).map(item => `${new Date(item.start).toLocaleString('pt-BR')} — ${duration(elapsed(item.start, item.end))}`).join('\n') || 'Nenhuma sessão concluída.'}`, actions: writable ? [...(pending ? [{ id: 'retry', label: 'Tentar salvar novamente' }] : []), ...(page > 0 ? [{ id: 'newer', label: 'Sessões mais recentes' }] : []), ...(offset + 12 < sessions.length ? [{ id: 'older', label: 'Sessões anteriores' }] : [])] : [] })
  }
  async function persist() {
    if (!pending) return
    const next = pending, desired = trackerDocument(next)
    state = 'Salvando…'; publish()
    try {
      // Reconcile a lost acknowledgement without replaying Start/Pause or
      // manufacturing another interval. Never overwrite a divergent document.
      const current = await context.data.read()
      if (JSON.stringify(current.document) !== JSON.stringify(desired)) {
        if (JSON.stringify(current.document) !== JSON.stringify(confirmedDocument)) throw new Error('Histórico alterado. Recupere antes de substituir.')
        await context.data.write(current.revision, desired)
      }
      confirmed = next; confirmedDocument = desired; pending = null; state = 'Salvo.'
    } catch { state = 'Falha ao salvar. Alteração pendente nesta ativação; tente novamente antes de fechar.' }
    publish()
  }
  publish(); const interval = setInterval(publish, 1000)
  context.reportStatus('Time Tracker: histórico local; timestamps persistidos; conta até Pausar.')
  return {
    async onEvent(widgetId, event) {
      if (!active || !writable || event.kind !== 'action') return
      if (event.controlId === 'retry') { await persist(); return }
      if (widgetId === 'reports') { const last = Math.max(0, Math.ceil((pending ?? confirmed).sessions.length / 12) - 1); page = Math.max(0, Math.min(last, page + (event.controlId === 'older' ? 1 : event.controlId === 'newer' ? -1 : 0))); publish(); return }
      if (widgetId !== 'timer' || pending) return
      const next = event.controlId === 'start' ? startTimer(confirmed, Date.now(), 'session.' + crypto.randomUUID()) : event.controlId === 'pause' ? pauseTimer(confirmed, Date.now()) : confirmed
      if (next === confirmed) return
      pending = next; await persist()
    },
    dispose() { active = false; clearInterval(interval) }
  }
}
