import { createRef, useLayoutEffect, useRef, useState } from 'react'
import { closeFloatingPresentation, openFloatingPresentation, raiseFloatingPresentation } from './definition.ts'
import type { FloatingPresentation, SharedViewId } from './definition.ts'

export function focusAvailable(button: HTMLButtonElement | null) {
  if (!button?.isConnected || button.disabled || button.closest('[inert],[hidden]') || !button.checkVisibility({ visibilityProperty: true })) return false
  button.focus({ preventScroll: true })
  return document.activeElement === button
}

/** A transient stack. Functional sessions and saved layout belong to Core. */
export function useFloatingWindows(fallback: (id: SharedViewId) => HTMLButtonElement | null) {
  const [stack, setStack] = useState<readonly FloatingPresentation[]>([])
  const [closeButtons] = useState(() => ({
    'git-changes': createRef<HTMLButtonElement>(), 'project-search': createRef<HTMLButtonElement>(), 'workspace-tools': createRef<HTMLButtonElement>()
  }))
  const openers = useRef(new Map<SharedViewId, HTMLButtonElement>())
  const pendingFocus = useRef<SharedViewId | null>(null)
  useLayoutEffect(() => {
    if (pendingFocus.current) focusAvailable(closeButtons[pendingFocus.current].current)
    pendingFocus.current = null
  }, [stack, closeButtons])

  function open(id: SharedViewId, trigger: HTMLButtonElement | null) {
    if (trigger) openers.current.set(id, trigger)
    else openers.current.delete(id)
    pendingFocus.current = focusAvailable(closeButtons[id].current) ? null : id
    setStack(current => openFloatingPresentation(current, id, 'floating-window'))
  }
  function close(id: SharedViewId) {
    const frame = closeButtons[id].current?.closest('[data-floating-view]')
    const restore = frame?.contains(document.activeElement) && !document.querySelector('dialog:modal')
    const opener = openers.current.get(id)
    openers.current.delete(id)
    setStack(current => closeFloatingPresentation(current, id))
    if (restore && !focusAvailable(opener ?? null)) focusAvailable(fallback(id))
  }
  function raise(id: SharedViewId) { setStack(current => raiseFloatingPresentation(current, id)) }
  return { stack, active: stack.at(-1)?.viewId, closeButtons, open, raise, close }
}
