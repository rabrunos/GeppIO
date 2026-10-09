import { useRef, useState } from 'react'
import { DEFAULT_GRID } from '../../../shared/grid/policy.ts'
import { importGrid, parseGrid } from '../../../shared/grid/schema.ts'
import { readGrid, writeGrid } from '../../../shared/grid/storage.ts'
import type { GridPlacement, GridSnapshot } from '../../../shared/grid/types.ts'

export function useLayoutTransaction() {
  const [initial] = useState(() => { try { return readGrid(window.localStorage) } catch { return readGrid({ getItem() { throw new Error('Unavailable') }, setItem() {} }) } })
  const committed = useRef(initial.snapshot), observed = useRef(initial.raw), writable = useRef(initial.writable)
  const [snapshot, setSnapshot] = useState(initial.snapshot), live = useRef(snapshot)
  const [editing, setEditing] = useState(false), [recovery, setRecovery] = useState(initial.recovery)
  const [message, setMessage] = useState(initial.message)
  const importEpoch = useRef(0)
  function put(next: GridSnapshot) { live.current = next; setSnapshot(next) }
  function persist(next: GridSnapshot) {
    try { return writeGrid(window.localStorage, next, observed.current) }
    catch { return { raw: observed.current, error: 'Armazenamento local indisponível. A prévia foi mantida; tente novamente ou cancele.' } }
  }
  function putPlacements(placements: GridPlacement[]) { put({ ...live.current, placements }) }
  function begin(projected: GridSnapshot = live.current) { if (!recovery) { importEpoch.current++; put(structuredClone(projected)); setEditing(true); setMessage('Arraste pelo título ou use as setas. Bordas e cantos redimensionam em células. Salve ou cancele a prévia.') } }
  function cancel() { importEpoch.current++; put(structuredClone(committed.current)); setEditing(false); setMessage(initial.recovery && !writable.current ? initial.message : 'Edição cancelada. A composição salva foi mantida.') }
  function save(projected: GridSnapshot = live.current) {
    importEpoch.current++
    try { parseGrid(JSON.stringify(projected)) } catch { setMessage('Layout inválido. Os dados salvos foram preservados.'); return }
    const result = persist(projected)
    if (result.error) { setMessage(result.error); return }
    observed.current = result.raw; committed.current = structuredClone(projected); put(structuredClone(projected)); writable.current = true
    setRecovery(false); setEditing(false); setMessage('Layout salvo neste computador. O layout v1 continua preservado.')
  }
  function toggleTheme() {
    const theme = live.current.theme === 'dark' ? 'light' : 'dark'
    put({ ...live.current, theme })
    const next: GridSnapshot = { ...committed.current, theme }
    committed.current = next
    // A theme change must not implicitly approve a pending migration or replace corruption.
    if (!writable.current) return
    const result = persist(next)
    if (result.error) setMessage(result.error); else observed.current = result.raw
  }
  function resetPreview() {
    importEpoch.current++; put({ ...structuredClone(DEFAULT_GRID), theme: live.current.theme }); setEditing(true)
    setMessage('Composição inicial somente na prévia. Salvar confirma a nova composição; Cancelar preserva os dados anteriores.')
  }
  async function importFile(file?: File) {
    if (!file || editing) return
    const epoch = ++importEpoch.current
    if (file.size > 64 * 1024) { setMessage('O layout deve ter até 64 KiB.'); return }
    try {
      const next = importGrid(await file.text())
      if (epoch !== importEpoch.current) return
      put({ ...next, theme: live.current.theme }); setEditing(true); setMessage('Layout importado somente na prévia. Salve para confirmar ou cancele.')
    } catch { if (epoch === importEpoch.current) setMessage('Arquivo inválido, incompatível ou sem espaço na grade. Sua composição e os dados antigos foram preservados.') }
  }
  return { snapshot, live, editing, recovery, message, setMessage, put, putPlacements, begin, cancel, save, toggleTheme, resetPreview, importFile }
}
export type LayoutTransaction = ReturnType<typeof useLayoutTransaction>
