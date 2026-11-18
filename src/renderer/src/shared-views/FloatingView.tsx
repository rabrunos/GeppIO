import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode, Ref } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { IconButton } from '../workbench/Primitives.tsx'
import { floatingBounds } from './definition.ts'
import type { FloatingPresentation, Point, Size } from './definition.ts'
import './floating-view.css'

interface Drag {
  pointer: number
  origin: Point
  start: Point
  previous: Point | null
  handle: HTMLElement
}

export function FloatingView({ instance, title, size, children, close, closeButton, canDismissWithEscape }: {
  instance: FloatingPresentation
  title: string
  size: Size
  children: ReactNode
  close(): void
  closeButton: Ref<HTMLButtonElement>
  canDismissWithEscape(): boolean
}) {
  const heading = useId(), layer = useRef<HTMLDivElement>(null), frame = useRef<HTMLElement>(null)
  const [area, setArea] = useState<Size | null>(null), [position, setPosition] = useState<Point | null>(null)
  const drag = useRef<Drag | null>(null)
  useLayoutEffect(() => {
    const element = layer.current!
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      setArea(current => current?.width === width && current.height === height ? current : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bounds = area && floatingBounds(area, size, position)
  function start(event: PointerEvent<HTMLElement>) {
    if (!bounds || drag.current || !event.isPrimary || event.button !== 0) return
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, origin: { x: bounds.x, y: bounds.y }, start: { x: event.clientX, y: event.clientY }, previous: position, handle }
    event.preventDefault()
    if (!frame.current?.contains(document.activeElement)) frame.current?.focus({ preventScroll: true })
  }
  function finish(pointer: number, cancel: boolean) {
    const active = drag.current
    if (active?.pointer !== pointer) return
    drag.current = null
    if (cancel) setPosition(active.previous)
    if (active.handle.hasPointerCapture(pointer)) active.handle.releasePointerCapture(pointer)
  }

  return <div className="internal-view-layer" ref={layer}>
    <section ref={frame} tabIndex={-1} role="dialog" aria-modal={false} aria-labelledby={heading}
      data-floating-view={instance.viewId} className="internal-view"
      style={bounds ? { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height } : undefined}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        if (!drag.current && (!canDismissWithEscape() || event.repeat)) return
        event.preventDefault(); event.stopPropagation()
        if (drag.current) finish(drag.current.pointer, true)
        else close()
      }}>
      <header className="internal-view-titlebar">
        <div className="internal-view-grip" onPointerDown={start} onPointerMove={event => {
          const active = drag.current
          if (!area || active?.pointer !== event.pointerId) return
          const next = floatingBounds(area, size, { x: active.origin.x + event.clientX - active.start.x, y: active.origin.y + event.clientY - active.start.y })
          setPosition({ x: next.x, y: next.y })
        }} onPointerUp={event => finish(event.pointerId, false)} onPointerCancel={event => finish(event.pointerId, true)}
          onLostPointerCapture={event => finish(event.pointerId, true)}><h2 id={heading}>{title}</h2></div>
        <IconButton ref={closeButton} label="Fechar" onClick={close}><XMarkIcon className="icon" /></IconButton>
      </header>
      <div className="internal-view-content ui-scrollbar">{children}</div>
    </section>
  </div>
}
