import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactNode, Ref } from 'react'
import { ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { IconButton } from '../workbench/Primitives.tsx'
import { floatingBounds } from './definition.ts'
import { moveWithArrow } from './movement.ts'
import type { FloatingPresentation, Point, Size } from './definition.ts'
import './floating-view.css'

interface Drag {
  pointer: number
  origin: Point
  start: Point
  previous: Point | null
  handle: HTMLElement
}

export function FloatingView({ instance, title, size, children, close, closeButton, canDismissWithEscape, active, stackIndex, raise }: {
  instance: FloatingPresentation
  title: string
  size: Size
  children: ReactNode
  close(): void
  closeButton: Ref<HTMLButtonElement>
  canDismissWithEscape(): boolean
  active: boolean
  stackIndex: number
  raise(): void
}) {
  const heading = useId(), instructions = useId(), layer = useRef<HTMLDivElement>(null), frame = useRef<HTMLElement>(null)
  const [area, setArea] = useState<Size | null>(null), [position, setPosition] = useState<Point | null>(null)
  const [moveOrigin, setMoveOrigin] = useState<Point | null>(null)
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

  const initial = area && floatingBounds(area, size, null)
  const stagger = instance.viewId === 'workspace-tools' ? 2 : instance.viewId === 'project-search' ? 1 : 0
  const startPosition = initial && { x: initial.x - 70 * stagger, y: initial.y + 54 * stagger }
  const bounds = area && floatingBounds(area, size, position ?? startPosition)
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

  return <div className="internal-view-layer" data-floating-active={active} style={{ zIndex: 100 + stackIndex }} ref={layer}>
    <section ref={frame} tabIndex={-1} role="dialog" aria-modal={false} aria-labelledby={heading}
      data-floating-view={instance.viewId} className="internal-view"
      style={bounds ? { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height } : undefined}
      onFocusCapture={raise} onPointerDownCapture={event => {
        // Clicking Close on a background presentation must leave the current
        // editor, field or sibling window focused.
        if (!active && (event.target as Element).closest('[data-internal-close]') && !frame.current?.contains(document.activeElement)) {
          event.preventDefault()
          return
        }
        raise()
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return
        if (!moveOrigin && !drag.current && !canDismissWithEscape()) return
        event.preventDefault(); event.stopPropagation()
        if (moveOrigin) { setPosition(moveOrigin); setMoveOrigin(null) }
        else if (drag.current) finish(drag.current.pointer, true)
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
        <IconButton ref={closeButton} label="Fechar" data-internal-close className="internal-view-close" onClick={close}><XMarkIcon className="icon" /></IconButton>
        <IconButton label="Mover janela" literalLabel aria-pressed={!!moveOrigin} aria-describedby={instructions}
          onClick={() => { if (bounds && !drag.current) setMoveOrigin(moveOrigin ? null : { x: bounds.x, y: bounds.y }) }}
          onBlur={() => setMoveOrigin(null)} onKeyDown={event => {
            if (!moveOrigin || !bounds || !area || event.ctrlKey || event.altKey || event.metaKey) return
            if (event.key === 'Enter') { event.preventDefault(); setMoveOrigin(null); return }
            const next = moveWithArrow(event.key, event.shiftKey, bounds, area, size)
            if (next) { event.preventDefault(); event.stopPropagation(); setPosition(next) }
          }}><ArrowsPointingOutIcon className="icon" /></IconButton>
        <span className="sr-only" id={instructions}>Use as setas para mover um pixel, ou dez com Shift. Enter confirma e Escape restaura a posição.</span>
      </header>
      <div className="internal-view-content ui-scrollbar">{children}</div>
    </section>
  </div>
}
