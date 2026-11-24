import { validSearchQuery } from '../../../shared/search.ts'
import type { SearchBridge, SearchMatch, SearchPage, SearchResult } from '../../../shared/search.ts'
import type { ExplorerSession } from '../files-editor/explorer-session.ts'
import { emptySearchFilters, validReplacement, validSearchFilters } from '../../../shared/search-replacement.ts'
import type { ReplacementPreview, SearchFilters } from '../../../shared/search-replacement.ts'

type SearchStatus = SearchPage['status'] | 'idle' | 'starting' | 'canceling'
interface State {
  root: string | null; query: string; matchCase: boolean; submitted: string
  status: SearchStatus; page: SearchPage | null; matches: readonly SearchMatch[]
  feedback: string | null
  filters: SearchFilters; submittedFilters: SearchFilters; submittedCase: boolean; replacement: string
  selected: ReadonlySet<string>; preview: ReplacementPreview | null; preparing: boolean; applying: boolean
  outcomes: ReadonlyMap<string, string>
}
const idle = { status: 'idle' as const, submitted: '', page: null, matches: [], feedback: null,
  selected: new Set<string>(), preview: null, preparing: false, applying: false, outcomes: new Map<string, string>() }

/** Owns the native job and its pages across Search panel and App switches. */
export class SearchSession {
  private readonly bridge: SearchBridge
  private readonly explorer: ExplorerSession
  private readonly reveal: (document: string, match: SearchMatch) => boolean
  private state: State = { root: null, query: '', matchCase: false, filters: emptySearchFilters, submittedFilters: emptySearchFilters,
    submittedCase: false, replacement: '', ...idle }
  private reviewVersion = 0
  private stopRequested = false
  private listeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private invalidRoot: string | null = null
  locked = false
  constructor(bridge: SearchBridge, explorer: ExplorerSession, reveal: (document: string, match: SearchMatch) => boolean) {
    this.bridge = bridge; this.explorer = explorer; this.reveal = reveal
  }
  snapshot = () => this.state
  get canCancel() {
    return this.state.status === 'starting' || this.state.status === 'running' ||
      this.state.status === 'failed' && this.state.page?.status === 'running'
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
  }
  private invalidate() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    return ++this.generation
  }
  private release(job: string) { void this.bridge.cancel(job).catch(() => {}) }
  connect() {
    if (this.unsubscribe) return
    let version = this.explorer.snapshot().mutationVersion
    const sync = () => {
      const explorer = this.explorer.snapshot(), selected = explorer.root?.id ?? null
      const changed = version !== explorer.mutationVersion; version = explorer.mutationVersion
      if (this.invalidRoot !== selected) this.invalidRoot = null
      if (selected && this.explorer.editor.snapshot().invalidRoot === selected) this.invalidRoot = selected
      // A later document operation can clear its notice without reauthorizing
      // this root. Search resumes only after Explorer obtains a fresh token.
      const root = this.invalidRoot ? null : selected
      if (root === this.state.root && !changed) return
      this.invalidate()
      if (this.state.page?.status === 'running') this.release(this.state.page.job)
      this.update({ root, ...idle, feedback: this.invalidRoot ? 'A pasta do projeto mudou. Abra a pasta novamente no Explorador.' :
        changed && this.state.page ? 'A árvore do projeto mudou. Busque novamente.' : null })
    }
    const stopExplorer = this.explorer.subscribe(sync), stopEditor = this.explorer.editor.subscribe(sync)
    this.unsubscribe = () => { stopExplorer(); stopEditor() }
    sync()
  }
  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null
    this.invalidate()
    if (this.state.page?.status === 'running') this.release(this.state.page.job)
    this.update({ root: null, ...idle })
  }
  private changeReview(patch: Partial<State>) {
    if (this.state.applying) return
    this.reviewVersion++
    if ((this.state.preview || this.state.preparing) && this.state.page) this.release(this.state.page.job)
    this.update({ preview: null, preparing: false, outcomes: new Map(), ...patch })
  }
  setQuery(query: string) { this.changeReview({ query }) }
  setMatchCase(matchCase: boolean) { this.changeReview({ matchCase }) }
  setFilters(filters: SearchFilters) { this.changeReview({ filters }) }
  setReplacement(replacement: string) { this.changeReview({ replacement }) }
  selectMatch(id: string, checked: boolean) {
    const selected = new Set(this.state.selected)
    if (checked) selected.add(id); else selected.delete(id)
    this.changeReview({ selected })
  }
  selectAll(checked: boolean) { this.changeReview({ selected: new Set(checked ? this.state.matches.map(match => match.id) : []) }) }
  get previewUnavailable() {
    const s = this.state
    if (this.locked || s.preparing || s.applying) return 'Aguarde a operação em andamento.'
    if (!s.page || !['complete','partial','canceled'].includes(s.status) || s.matches.length < s.page.found) return 'Conclua a busca para revisar os resultados.'
    if (s.query !== s.submitted || s.matchCase !== s.submittedCase || s.filters.path !== s.submittedFilters.path || s.filters.extensions !== s.submittedFilters.extensions) return 'Execute a busca com os filtros atuais.'
    if (!s.selected.size) return 'Selecione as ocorrências a substituir.'
    if (!validReplacement(s.replacement)) return 'Use até 1.024 caracteres UTF-16 em uma linha.'
    return null
  }
  async prepare() {
    if (this.previewUnavailable) return
    const s = this.state, review = ++this.reviewVersion, generation = this.generation
    this.update({ preparing: true, preview: null, outcomes: new Map(), feedback: null })
    try {
      const result = await this.bridge.preview(s.page!.job, [...s.selected], s.replacement, this.explorer.editor.replacementMarks())
      if (generation !== this.generation || review !== this.reviewVersion) return
      this.update(result.ok ? { preview: result.preview } : { feedback: result.error })
    } catch {
      if (generation === this.generation && review === this.reviewVersion) this.update({ feedback: 'Falha ao obter a prévia. Gere outra prévia.' })
    } finally { if (generation === this.generation && review === this.reviewVersion) this.update({ preparing: false }) }
  }
  cancelReplacement() {
    if (this.state.applying) { this.stopRequested = true; this.update({ feedback: 'Interrompendo após o arquivo em andamento.' }) }
    else this.changeReview({ feedback: 'Prévia cancelada.' })
  }
  async apply() {
    const { page, preview } = this.state
    if (!page || !preview || this.previewUnavailable || this.state.outcomes.size) return
    const pending = preview.files.filter(file => !file.excluded), generation = this.generation
    if (!pending.length) return
    this.stopRequested = false
    const outcomes = new Map(pending.map(file => [file.id, 'Não executado']))
    this.update({ applying: true, outcomes: new Map(outcomes), feedback: null })
    let refresh = false
    try {
      for (const file of pending) {
        if (this.stopRequested || generation !== this.generation || this.locked) break
        const result = await this.explorer.editor.applyReplacement(file.open, marks => this.bridge.applyFile(page.job, preview.id, file.id, marks))
        refresh ||= result.ok || result.uncertain === true
        outcomes.set(file.id, result.ok ? ['Confirmado', result.notice].filter(Boolean).join('. ') : (result.uncertain ? 'Incerto. ' : 'Recusado. ') + result.error)
        if (generation !== this.generation) break
        this.update({ outcomes: new Map(outcomes) })
        if (!result.ok) break
      }
    } finally {
      if (generation === this.generation) {
        this.release(page.job)
        this.update({ applying: false, feedback: 'Confira o resultado por arquivo. Para outra substituição, revise uma nova prévia.' })
        if (refresh) await this.explorer.refresh()
      }
    }
  }
  async start() {
    const { root, query, matchCase, filters, applying } = this.state
    if (!root || this.locked || applying || !validSearchQuery(query) || !validSearchFilters(filters)) return
    const generation = this.invalidate()
    this.update({ ...idle, status: 'starting', submitted: query, submittedCase: matchCase, submittedFilters: { ...filters } })
    try {
      const result = filters.path || filters.extensions ? await this.bridge.start(root, query, matchCase, filters) : await this.bridge.start(root, query, matchCase)
      if (generation !== this.generation) {
        if (result.ok && result.value.status === 'running') this.release(result.value.job)
        return
      }
      if (this.state.status === 'canceling' && result.ok) {
        this.update({ page: result.value, matches: result.value.items })
        await this.cancelJob(result.value.job, generation)
      } else this.accept(result, generation)
    } catch { this.fail(generation) }
  }
  private fail(generation: number, message = 'A comunicação com a busca falhou. Os resultados exibidos podem estar incompletos.') {
    if (generation === this.generation) this.update({ status: 'failed', feedback: message })
  }
  private expired(generation: number, feedback: string) {
    if (generation !== this.generation) return
    this.invalidate()
    this.update({ ...idle, feedback })
  }
  private accept(result: SearchResult, generation: number) {
    if (generation !== this.generation) return
    if (!result.ok) {
      if (result.expired) this.expired(generation, result.error)
      else this.fail(generation, result.error)
      return
    }
    const page = result.value
    this.update({ status: page.status, page, matches: page.items.length ? [...this.state.matches, ...page.items] : this.state.matches })
    if (page.more || page.status === 'running') this.timer = setTimeout(() => {
      this.timer = null
      void this.bridge.read(page.job, page.next).then(next => this.accept(next, generation)).catch(() => this.fail(generation))
    }, page.more ? 0 : 80)
  }
  async cancel() {
    if (!this.canCancel) return
    this.update({ status: 'canceling', feedback: null })
    if (this.state.page) await this.cancelJob(this.state.page.job, this.invalidate())
  }
  private async cancelJob(job: string, generation: number) {
    try {
      const result = await this.bridge.cancel(job)
      if (generation !== this.generation) return
      if (!result.ok) { this.accept(result, generation); return }
      // Cancel returns page zero. Retain already displayed matches and continue
      // paging from the end of the known prefix, even if it spans many pages.
      const page = result.value, known = this.state.matches.length, next = Math.max(known, page.next)
      this.accept({ ok: true, value: { ...page, items: page.items.slice(known), next, more: next < page.found } }, generation)
    } catch { this.fail(generation) }
  }
  async open(id: string) {
    const { page, matches } = this.state, editor = this.explorer.editor
    const match = matches.find(item => item.id === id)
    if (!page || !match || this.locked || editor.snapshot().busy || this.explorer.snapshot().busy) return
    const generation = this.generation
    let verified: string | null = null
    const opened = await editor.openAuthorized(async () => {
      const result = await this.bridge.open(page.job, id)
      if (generation !== this.generation) {
        // Keep a grant already committed by Main in the registry without
        // changing the active tab or selecting text for a superseded search.
        return { ok: true, canceled: true, document: null, invalidRoot: result.invalidRoot,
          documents: result.ok && result.document ? result.documents ?? [result.document] : undefined }
      }
      if (!result.ok && result.expired) this.expired(generation, result.error)
      if (result.ok && result.matchesSnapshot && result.document) verified = result.document.id
      return result
    })
    if (generation !== this.generation) return
    const state = editor.snapshot()
    if (!opened) { this.update({ feedback: state.notice ?? 'Não foi possível abrir o resultado da busca.' }); return }
    if (!verified || !state.document || state.document.id !== verified || editor.documentState(verified)?.unresolved || state.text !== state.document.text || !this.reveal(verified, match)) {
      this.update({ feedback: 'A ocorrência se refere ao arquivo salvo no disco. O conteúdo da aba foi preservado.' })
    } else this.update({ feedback: null })
  }
}
