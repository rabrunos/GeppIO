import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog, IconButton } from '@geppio/ui'
import { acquireWorkers, createBasicEditor, createModel, modelCount } from '@geppio/editor'
import { createViteWorker } from '@geppio/editor/vite-workers'
import '@geppio/ui/styles.css'
import '@geppio/editor/styles.css'

function Consumer() {
  const [open, setOpen] = useState(false)
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null)
  const action = useRef<((name: 'undo' | 'redo' | 'close') => void) | null>(null)
  useLayoutEffect(() => {
    const pool = acquireWorkers(label => {
      const worker = createViteWorker(label)
      worker.addEventListener('message', () => { if (label === 'json') document.body.dataset.jsonWorker = 'responded' })
      return worker
    })
    const model = createModel('{"word":"olá 😀"}', 'json')
    const first = createBasicEditor(left.current!, { model, ariaLabel: 'Editor esquerdo' })
    const second = createBasicEditor(right.current!, { model, ariaLabel: 'Editor direito' })
    const read = () => { document.getElementById('draft')!.textContent = model.getValue() }
    read()
    const edits = model.onDidChangeContent(read)
    function close() {
      if (!action.current) return
      action.current = null
      edits.dispose()
      first.dispose()
      second.dispose()
      model.dispose()
      pool.dispose()
      document.body.dataset.disposed = String(modelCount() === 0 && !globalThis.MonacoEnvironment)
    }
    action.current = name => {
      if (name === 'close') close()
      else if (name === 'undo') void model.undo()
      else void model.redo()
    }
    return close
  }, [])
  return <>
    <IconButton label="Ajuda" onClick={() => setOpen(true)}>?</IconButton>
    {open && <Dialog title="Ajuda local" closeLabel="Fechar" close={() => setOpen(false)}><p>Editor independente</p></Dialog>}
    <div ref={left} id="left" style={{ height: 180, width: 480 }} />
    <div ref={right} id="right" style={{ height: 180, width: 480 }} />
    <output id="draft" />
    <button onClick={() => action.current?.('undo')}>Desfazer</button>
    <button onClick={() => action.current?.('redo')}>Refazer</button>
    <button onClick={() => action.current?.('close')}>Encerrar</button>
  </>
}
createRoot(document.getElementById('root')!).render(<Consumer />)
