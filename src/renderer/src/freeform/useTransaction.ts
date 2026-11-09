import { useRef, useState } from 'react'
import { POLICY } from '../../../shared/freeform/policy.ts'
import { settleSnapshot } from '../../../shared/freeform/settlement.ts'
import { convertHistorical, importFreeform } from '../../../shared/freeform/migration.ts'
import type { HistoricalChoice } from '../../../shared/freeform/storage.ts'
import type { Snapshot } from '../../../shared/freeform/types.ts'
import { adoptLayout, widgetRegistry, WORKBENCH_KEY } from '../../../shared/workbench/model.ts'
import type { Composition, LocalSessionState, Registry, SessionDraft, SessionSlot, WorkbenchSnapshot } from '../../../shared/workbench/model.ts'
import { parseWorkbench, serializeWorkbench } from '../../../shared/workbench/codec.ts'
import { resetWorkbench, retireDemoViews } from '../../../shared/workbench/retirement.ts'
import { readWorkbench, writeWorkbench } from '../../../shared/workbench/storage.ts'
import { EditHistory, formatSignature } from '../../../shared/workbench/history.ts'
import { compositionScene, systemCompositions } from '../../../shared/workbench/compositions.ts'
import { configureBar, resizePair } from '../../../shared/workbench/commands.ts'
import type { ResizePair } from '../../../shared/workbench/commands.ts'
import type { UserBar } from '../../../shared/workbench/model.ts'
import type { Surface } from '../../../shared/freeform/types.ts'
import { changePresentation, presentationFor, returnToNormal, validatePresentationEdges } from '../../../shared/workbench/presentations.ts'
import type { PresentationPatch } from '../../../shared/workbench/presentations.ts'
import type { Size } from '../../../shared/freeform/types.ts'

export function useTransaction(registry: Registry = widgetRegistry(), localState?: { read(): LocalSessionState; apply(value: LocalSessionState): void }) {
  const localOwner = useRef(localState); localOwner.current = localState
  const [initial] = useState(() => {
    try { const read = readWorkbench(localStorage, registry); return { ...read, snapshot: settleSnapshot(read.snapshot), normalizationPending: read.snapshot.placements.some(p => p.width !== p.preferred.width || p.height !== p.preferred.height) } }
    catch { return { ...readWorkbench({ getItem() { throw new Error('Unavailable') }, setItem() {} }, registry), normalizationPending: false } }
  })
  const committed = useRef(initial.snapshot), observed = useRef(initial.raw), epoch = useRef(0)
  const [snapshot, setSnapshot] = useState(initial.snapshot), live = useRef(snapshot)
  const [editing, setEditing] = useState(false), editingRef = useRef(false)
  const [recovery, setRecovery] = useState(initial.recovery), [message, setMessage] = useState(initial.message)
  const [slots, setSlotState] = useState<SessionSlot[]>([]), slotsRef = useRef(slots), formatId = useRef<string | null>(null)
  const formatSource = useRef<SessionDraft['formatSource']>(null)
  const formatMode = useRef<SessionDraft['formatMode']>(null)
  const checkpoint = useRef<SessionDraft>({ snapshot: initial.snapshot, slots: [], formatId: null })
  const history = useRef(new EditHistory()), [, notify] = useState(0), saving = useRef(false)
  const motionRevision = useRef(0)
  const motion = useRef({ duration: 240, entering: false })
  const normalizationPending = useRef(initial.normalizationPending), formatBaseline = useRef(formatSignature(initial.snapshot))
  function current(): SessionDraft { return { snapshot: live.current, slots: slotsRef.current, formatId: formatId.current, formatMode: formatMode.current, formatSource: formatSource.current, ...(localOwner.current ? { localState: structuredClone(localOwner.current.read()) } : {}) } }
  function refresh() { notify(value => value + 1) }
  function put(next: Snapshot | WorkbenchSnapshot) {
    const value: WorkbenchSnapshot = 'organization' in next ? next as WorkbenchSnapshot : { ...next, retiredDemos: live.current.retiredDemos, organization: live.current.organization }
    try { validatePresentationEdges(value) } catch { setMessage('Borda de apresentação ocupada. Mova o outro painel antes de restaurar esta presença.'); return }
    epoch.current++; live.current = value; setSnapshot(value)
  }
  function apply(draft: SessionDraft) { if (draft.localState) localOwner.current?.apply(structuredClone(draft.localState)); put(draft.snapshot); slotsRef.current = draft.slots; setSlotState(draft.slots); formatId.current = draft.formatId; formatMode.current = draft.formatMode ?? null; formatSource.current = draft.formatSource ?? null; refresh() }
  function action(next: WorkbenchSnapshot, nextSlots = slotsRef.current, nextFormat = formatId.current, nextSource = formatSource.current, animation = { duration: 240, entering: false }, nextMode = formatMode.current) {
    try { validatePresentationEdges(next) } catch { setMessage('Borda de apresentação ocupada. Mova o outro painel antes de restaurar esta presença.'); return }
    const before = current(), after = { snapshot: next, slots: nextSlots, formatId: nextFormat, formatMode: nextMode, formatSource: nextSource, localState: before.localState }
    if (editingRef.current && !history.current.active) history.current.record(before, after)
    motionRevision.current++; motion.current = animation
    apply(after)
  }
  function begin(next: Snapshot) {
    if (recovery && !editingRef.current) return
    if (!editingRef.current) {
      history.current.clear(); checkpoint.current = { ...current(), snapshot: structuredClone(committed.current), slots: [], formatId: null }
      formatBaseline.current = formatSignature(settleSnapshot('organization' in next ? next as WorkbenchSnapshot : { ...next, organization: live.current.organization }))
      editingRef.current = true; setEditing(true)
    }
    put(settleSnapshot(structuredClone(next))); setMessage('Edite a composição. Salvar edição confirma um checkpoint; Concluir encerra a sessão.')
  }
  function cancel() {
    epoch.current++; history.current.clear(); apply({ ...structuredClone(checkpoint.current), slots: [], formatId: null, formatSource: null })
    editingRef.current = false; setEditing(false); setRecovery(initial.recovery && observed.current === initial.raw)
    setMessage(initial.recovery && observed.current === initial.raw ? initial.message : 'Edição cancelada. Último checkpoint confirmado restaurado.')
  }
  async function commit(next: WorkbenchSnapshot, conclude: boolean, retainSlots: boolean, successMessage?: string) {
    if (saving.current || history.current.active) return false
    const ticket = ++epoch.current
    let validated: WorkbenchSnapshot
    try { validated = parseWorkbench(serializeWorkbench({ ...next, ...settleSnapshot(next) }, registry), registry) }
    catch { setMessage('Composição inválida ou sem espaço. A prévia e os dados salvos foram preservados.'); return false }
    saving.current = true; refresh()
    try {
      const result = await navigator.locks.request(WORKBENCH_KEY, () => ticket === epoch.current
        ? writeWorkbench(localStorage, validated, registry, observed.current, observed.current === null ? initial.previous : undefined)
        : { raw: observed.current, error: 'Gravação cancelada.' })
      if (ticket !== epoch.current) return false
      if (result.error) { setMessage(result.error); return false }
      observed.current = result.raw; committed.current = structuredClone(validated)
      normalizationPending.current = false
      checkpoint.current = { ...current(), snapshot: structuredClone(validated), slots: structuredClone(slotsRef.current), formatId: formatId.current, formatMode: formatMode.current, formatSource: structuredClone(formatSource.current) }
      formatBaseline.current = formatSignature(validated, retainSlots ? slotsRef.current : [])
      put(validated); setRecovery(false)
      if (!retainSlots) { slotsRef.current = []; setSlotState([]); formatId.current = null; formatMode.current = null; formatSource.current = null }
      if (conclude) { editingRef.current = false; setEditing(false); history.current.clear() }
      setMessage(successMessage ?? (conclude ? 'Composição salva. Edição concluída.' : 'Edição salva. O checkpoint de Cancelar foi atualizado.')); return true
    } catch { if (ticket === epoch.current) setMessage('Não foi possível obter acesso seguro ao armazenamento. Sua prévia foi preservada.'); return false }
    finally { saving.current = false; refresh() }
  }
  function preview(next: Snapshot, text: string) {
    history.current.clear(); checkpoint.current = { ...current(), snapshot: structuredClone(committed.current), slots: [], formatId: null }
    formatBaseline.current = formatSignature(committed.current)
    put(settleSnapshot(retireDemoViews('organization' in next ? next as WorkbenchSnapshot : adoptLayout(next), registry))); editingRef.current = true; setEditing(true); setMessage(text)
  }
  async function importFile(file?: File) {
    if (!file || editingRef.current) return
    const ticket = ++epoch.current
    if (file.size > POLICY.maxBytes) { setMessage('A composição deve ter até 64 KiB.'); return }
    try {
      const text = await file.text(); if (ticket !== epoch.current) return
      let next: WorkbenchSnapshot
      try { next = parseWorkbench(text, registry) } catch { next = retireDemoViews(adoptLayout(importFreeform(text)), registry) }
      preview(next, 'Composição importada na prévia. Salvar adota sem alterar originais.')
    } catch { if (ticket === epoch.current) setMessage('Arquivo incompatível. Dados anteriores preservados.') }
  }
  function withOrganization(next: Snapshot): WorkbenchSnapshot {
    const value = { retiredDemos: live.current.retiredDemos, ...next, organization: ('organization' in next ? next as WorkbenchSnapshot : live.current).organization }
    const composition = [...systemCompositions(window.geppio?.demoFixtures), ...live.current.organization.compositions].find(item => item.id === formatId.current)
    return composition ? compositionScene({ ...live.current, organization: value.organization }, value, composition.scopes) : value
  }
  return { snapshot, live, editing, recovery, message, setMessage, put, begin, cancel, action, slots, currentSlots: () => slotsRef.current,
    changeLocal(patch: Partial<LocalSessionState>) {
      const before = current(); if (!before.localState) return
      const after = { ...before, localState: { ...before.localState, ...patch } }
      if (editingRef.current && !history.current.active) history.current.record(before, after)
      apply(after)
    },
    saving: saving.current, formatId: formatId.current, formatMode: formatMode.current, formatSource: formatSource.current, canUndo: history.current.canUndo, canRedo: history.current.canRedo, gestureActive: history.current.active, motionRevision: motionRevision.current, motion: motion.current,
    undo() { const next = history.current.undo(current()); if (next) { motionRevision.current++; motion.current = { duration: 240, entering: false }; apply(next) } },
    redo() { const next = history.current.redo(current()); if (next) { motionRevision.current++; motion.current = { duration: 240, entering: false }; apply(next) } },
    beginGesture() { epoch.current++; history.current.begin(current()); refresh() },
    finishGesture() { history.current.finish(current()); refresh() },
    cancelGesture() { const before = history.current.abort(); if (before) apply(before); refresh() },
    save: (next: Snapshot) => commit(withOrganization(next), true, false),
    saveEditing: (next: Snapshot = live.current) => commit(withOrganization(next), false, true),
    conclude: (next: Snapshot = live.current) => commit(withOrganization(next), true, false),
    hasPending() { return formatSignature(live.current, slotsRef.current) !== formatBaseline.current },
    async saveComposition(record: Composition) {
      if (!editingRef.current) return false
      const before = structuredClone(current()), next = { ...live.current, organization: { ...live.current.organization, compositions: [...live.current.organization.compositions, record] } }
      const ok = await commit(next, false, true, 'Composição salva.')
      if (ok) { history.current.record(before, current()); refresh() }
      return ok
    },
    async commitOrganization(next: WorkbenchSnapshot) {
      if (editingRef.current) { action(next); return true }
      if (normalizationPending.current) { setMessage('Confirme a composição em Editar antes de alterar as barras. Os dados anteriores foram preservados.'); return false }
      if (recovery) { setMessage('Escolha e confirme uma prévia explícita antes de alterar as barras.'); return false }
      if (JSON.stringify(next.placements) !== JSON.stringify(committed.current.placements)) return false
      return commit(next, false, true, 'Preferência salva.')
    },
    async present(patch: PresentationPatch, id = 'properties', bounds?: { size: Size; expanded: boolean; scrollbar: number }) {
      if (saving.current || history.current.active) return false
      if (patch.presentation && !editingRef.current) return false
      let next: WorkbenchSnapshot
      try {
        if (patch.presentation === 'normal' && presentationFor(live.current, id, registry).presentation !== 'normal') {
          const converted = bounds && returnToNormal(live.current, id, bounds.size, registry, bounds.expanded, bounds.scrollbar)
          if (!converted) { setMessage('Libere o local ou reduza o painel antes de voltar a Normal. Dados anteriores preservados.'); return false }
          next = converted
        } else next = changePresentation(live.current, patch, registry, id)
      } catch { setMessage('Apresentação incompatível ou borda ocupada. Dados anteriores preservados.'); return false }
      if (editingRef.current) { action(next); return true }
      if (recovery || normalizationPending.current || JSON.stringify(live.current) !== JSON.stringify(committed.current)) {
        setMessage('Confirme ou recupere a composição em Editar antes de alterar a apresentação.'); return false
      }
      return commit(next, false, true, 'Apresentação salva.')
    },
    async commitPair(intent: ResizePair) {
      if (editingRef.current || intent.delta === 0) return false
      if (normalizationPending.current) { setMessage('Confirme a composição em Editar antes de redimensionar pares. Os dados anteriores foram preservados.'); return false }
      if (recovery || JSON.stringify(live.current) !== JSON.stringify(committed.current)) return false
      const next = resizePair(committed.current, registry, intent)
      if (!next) return false
      return commit(next, false, true, 'Redimensionamento salvo.')
    },
    async saveBar(bar: UserBar, surface: Surface, disabled?: ReadonlySet<string>) {
      if (normalizationPending.current) { setMessage('Confirme a composição em Editar antes de alterar as barras. Os dados anteriores foram preservados.'); return false }
      if (editingRef.current || recovery || JSON.stringify(live.current) !== JSON.stringify(committed.current)) return false
      const next = configureBar(committed.current, registry, bar, surface, disabled)
      if (!next) { setMessage('Barra incompatível ou sem espaço. Os dados anteriores foram preservados.'); return false }
      return commit(next, false, true, 'Barra salva.')
    },
    resetPreview() { preview(resetWorkbench(live.current, window.geppio?.demoFixtures), 'Composição inicial na prévia. Salvar confirma; Cancelar preserva os dados anteriores.') },
    adoptPrevious() { try { preview(adoptLayout(importFreeform(initial.previous!)), 'Composição livre anterior na prévia; Salvar adota sem alterar o original.') } catch { setMessage('Composição anterior inválida; bytes preservados.') } },
    previous: initial.previous, importFile,
    historical(choice: HistoricalChoice) {
      try { preview(adoptLayout(convertHistorical(choice.raw, choice.kind)), 'Conversão somente na prévia. Salvar adota sem alterar o original.') }
      catch { setMessage('Não foi possível converter este layout com os mínimos atuais. Original preservado; importe uma cópia livre válida ou use outra prévia.') }
    }, choices: initial.choices
  }
}
export type Transaction = ReturnType<typeof useTransaction>
