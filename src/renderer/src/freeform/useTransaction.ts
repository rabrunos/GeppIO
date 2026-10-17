import { useRef, useState } from 'react'
import { DEFAULT_FREEFORM, FREEFORM_KEY, POLICY } from '../../../shared/freeform/policy.ts'
import { parseFreeform } from '../../../shared/freeform/schema.ts'
import { settleSnapshot } from '../../../shared/freeform/settlement.ts'
import { convertHistorical, importFreeform } from '../../../shared/freeform/migration.ts'
import { readFreeform, writeFreeform } from '../../../shared/freeform/storage.ts'
import type { HistoricalChoice } from '../../../shared/freeform/storage.ts'
import type { Snapshot } from '../../../shared/freeform/types.ts'

export function useTransaction() {
  const [initial] = useState(() => {
    try { const read = readFreeform(localStorage); return { ...read, snapshot: settleSnapshot(read.snapshot) } }
    catch { return readFreeform({ getItem() { throw new Error('Unavailable') }, setItem() {} }) }
  })
  const committed = useRef(initial.snapshot), observed = useRef(initial.raw), epoch = useRef(0)
  const [snapshot, setSnapshot] = useState(initial.snapshot), live = useRef(snapshot)
  const [editing, setEditing] = useState(false), [recovery, setRecovery] = useState(initial.recovery), [message, setMessage] = useState(initial.message)
  function put(next: Snapshot) { epoch.current++; live.current = next; setSnapshot(next) }
  function begin(next: Snapshot) {
    if (recovery && !editing) return
    put(settleSnapshot(structuredClone(next))); setEditing(true)
    setMessage(import.meta.env.DEV ? 'Arraste pelo título ou use as setas (1px; Shift: 10px). Salve ou cancele a prévia.' : 'Arraste pelo título ou pelas bordas. Salve ou cancele a prévia.')
  }
  function cancel() {
    put(structuredClone(committed.current)); setEditing(false); setRecovery(initial.recovery && observed.current === initial.raw)
    setMessage(initial.recovery && observed.current === initial.raw ? initial.message : 'Edição cancelada. A composição salva foi mantida.')
  }
  async function save(next: Snapshot) {
    const ticket = ++epoch.current
    try { next = parseFreeform(JSON.stringify(settleSnapshot(next))) } catch { setMessage('Layout inválido ou sem espaço. Os dados salvos foram preservados.'); return }
    try {
      const result = await navigator.locks.request(FREEFORM_KEY, () => ticket === epoch.current
        ? writeFreeform(localStorage, next, observed.current) : { raw: observed.current, error: 'Gravação cancelada.' })
      if (ticket !== epoch.current) return
      if (result.error) { setMessage(result.error); return }
      observed.current = result.raw; committed.current = structuredClone(next); put(next)
      setRecovery(false); setEditing(false); setMessage('Layout livre salvo. Todos os layouts anteriores continuam preservados.')
    } catch { if (ticket === epoch.current) setMessage('Não foi possível obter acesso seguro ao armazenamento. A prévia foi preservada.') }
  }
  function preview(next: Snapshot, text: string) {
    put(settleSnapshot(next)); setEditing(true); setMessage(text)
  }
  function resetPreview() { preview(structuredClone(DEFAULT_FREEFORM), 'Composição inicial somente na prévia. Salvar confirma; Cancelar preserva os dados anteriores.') }
  function historical(choice: HistoricalChoice) {
    try { preview(convertHistorical(choice.raw, choice.kind), 'Conversão somente na prévia. Confira posições e mínimos em pixels; Salvar adota sem alterar o original.') }
    catch { setMessage('Não foi possível converter este layout com os mínimos atuais. Original preservado; importe uma cópia livre válida ou use outra prévia.') }
  }
  async function importFile(file?: File) {
    if (!file || editing) return
    const ticket = ++epoch.current
    if (file.size > POLICY.maxBytes) { setMessage('O layout deve ter até 64 KiB.'); return }
    try {
      const text = await file.text()
      if (ticket !== epoch.current) return
      preview(importFreeform(text), 'Layout importado somente na prévia. Salve para confirmar ou cancele; os dados anteriores continuam preservados.')
    } catch { if (ticket === epoch.current) setMessage('Arquivo inválido ou incompatível. Sua composição e os dados antigos foram preservados.') }
  }
  return { snapshot, live, editing, recovery, message, setMessage, put, begin, cancel, save, resetPreview, importFile, historical, choices: initial.choices }
}
export type Transaction = ReturnType<typeof useTransaction>
