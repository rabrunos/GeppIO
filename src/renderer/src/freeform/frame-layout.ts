import type { Placement } from '../../../shared/freeform/types.ts'
import type { Measurement } from './useSurfaces.ts'

export type FrameSpace = 'content' | 'viewport'
/** One region measurement and one coordinate/clip path for every mounted widget.
 * Viewport constraints fix an anchored widget to its region, rather than scrolling
 * its rectangle with content. Insets and paint coordinates remain shared.
 */
export function projectFrame(p: Placement, m: Measurement, space: FrameSpace = 'content') {
  const owner = p.region === 'main' ? { left: m.ownerLeft ?? m.left, top: m.ownerTop ?? m.top,
    width: m.ownerWidth ?? m.width, height: m.ownerHeight ?? m.height }
    : { left: m.left, top: m.top, width: m.clipWidth ?? m.width, height: m.clipHeight ?? m.height }
  const viewport = space === 'viewport' ? owner : { left: m.left, top: m.top, width: m.clipWidth ?? m.width, height: m.clipHeight ?? m.height }
  const offset = { x: viewport.left - owner.left, y: viewport.top - owner.top }
  const scroll = space === 'viewport' ? { x: 0, y: 0 } : { x: m.scrollLeft, y: m.scrollTop }
  const left = owner.left + offset.x + p.x - scroll.x, top = owner.top + offset.y + p.y - scroll.y
  const outside = left + p.width <= viewport.left || left >= viewport.left + viewport.width
    || top + p.height <= viewport.top || top >= viewport.top + viewport.height
  const clipPath = `inset(${Math.max(0, viewport.top - top)}px ${Math.max(0, left + p.width - viewport.left - viewport.width)}px ${Math.max(0, top + p.height - viewport.top - viewport.height)}px ${Math.max(0, viewport.left - left)}px round var(--card-radius))`
  // A clipped Sidebar remains mounted/paintable for its existing reveal motion.
  // Clip visibility controls inertness; it must not become display:none here.
  const extent = space === 'viewport' ? owner : m
  return { left, top, outside, clipPath, available: extent.width > 0 && extent.height > 0 }
}
