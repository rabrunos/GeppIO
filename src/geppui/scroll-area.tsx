import { createElement, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, Ref, RefObject } from 'react'

/** Observe only this scroll owner's box/content, never the workspace tree or a
 * polling loop. Attribute writes are excluded from the mutation observation. */
export function useScrollState(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const owner = ref.current; if (!owner) return
    let frame = 0
    const update = () => {
      frame = 0
      const values = { up: owner.scrollTop > .5, down: owner.scrollTop + owner.clientHeight < owner.scrollHeight - .5,
        left: owner.scrollLeft > .5, right: owner.scrollLeft + owner.clientWidth < owner.scrollWidth - .5 }
      for (const [direction, available] of Object.entries(values)) {
        const name = `data-scroll-can-${direction}`
        if (owner.hasAttribute(name) !== available) owner.toggleAttribute(name, available)
      }
    }
    const queue = () => { if (!frame) frame = requestAnimationFrame(update) }
    const resize = new ResizeObserver(queue)
    const observe = () => { resize.disconnect(); resize.observe(owner); for (const child of owner.children) resize.observe(child); queue() }
    const content = new MutationObserver(observe)
    content.observe(owner, { childList: true, subtree: true, characterData: true })
    owner.addEventListener('scroll', queue, { passive: true }); observe()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); content.disconnect(); owner.removeEventListener('scroll', queue) }
  }, [ref])
}

export function ScrollArea({ as = 'div', ref, children, ...props }: HTMLAttributes<HTMLDivElement> & { as?: 'div' | 'aside'; ref?: Ref<HTMLDivElement> }) {
  const owner = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => owner.current!, [])
  useScrollState(owner)
  return createElement(as, { ...props, ref: owner }, children)
}
