import { useLayoutEffect, useRef, useState } from 'react'
import type { Measurement } from '../freeform/useSurfaces.ts'

export interface MaximizeState { id: string; serial: number; phase: 'expanding' | 'expanded' | 'restoring' }
/** Presentation only: no saved geometry, history intention or duplicate surface. */
export function useMaximizePresentation() {
  const [state, setState] = useState<MaximizeState | null>(null), sequence = useRef(0)
  return { state,
    toggle(id: string) { const serial = ++sequence.current; setState(current => ({ id, serial, phase: current?.id === id && current.phase !== 'restoring' ? 'restoring' : 'expanding' })) },
    clear() { setState(null) },
    finish(serial: number) { setState(current => current?.serial !== serial || current.phase === 'expanded' ? current : current.phase === 'restoring' ? null : { ...current, phase: 'expanded' }) }
  }
}
export function frameMotionTiming(element: Element) {
  const style = getComputedStyle(element), token = style.getPropertyValue('--region-motion').trim()
  return { duration: parseFloat(token) * (token.endsWith('ms') ? 1 : 1000), easing: style.getPropertyValue('--region-easing').trim() }
}
export function MaximizeBackdrop({ state, measurement: m }: { state: MaximizeState; measurement: Measurement }) {
  const element = useRef<HTMLDivElement>(null), flight = useRef<Animation | null>(null)
  const left = m.ownerLeft ?? m.left, top = m.ownerTop ?? m.top, width = m.ownerWidth ?? m.width, height = m.ownerHeight ?? m.height
  useLayoutEffect(() => {
    const node = element.current!
    const running = flight.current?.playState === 'running', current = getComputedStyle(node).backdropFilter
    flight.current?.cancel()
    if (state.phase === 'expanded' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const from = running ? current : state.phase === 'restoring' ? 'blur(2px)' : 'blur(0px)'
    flight.current = node.animate([{ backdropFilter: from }, { backdropFilter: state.phase === 'restoring' ? 'blur(0px)' : 'blur(2px)' }], frameMotionTiming(node))
  }, [state.serial, state.phase, left, top, width, height])
  useLayoutEffect(() => () => flight.current?.cancel(), [])
  return <div ref={element} className="maximize-backdrop" data-maximize-backdrop="" aria-hidden="true" style={{ left, top, width, height }} onPointerDown={event => event.preventDefault()} />
}
