import type { AlignmentGuide } from '../../../shared/freeform/alignment.ts'
import type { Measurement } from './useSurfaces.ts'
export function AlignmentGuides({ guides, measurement: m }: { guides: readonly AlignmentGuide[]; measurement: Measurement }) {
  return <>{guides.map(guide => {
    const vertical = guide.axis === 'x', line = (vertical ? m.left : m.top) + guide.line - (vertical ? m.scrollLeft : m.scrollTop)
    const start = Math.max(vertical ? m.top : m.left, (vertical ? m.top : m.left) + guide.from - (vertical ? m.scrollTop : m.scrollLeft))
    const end = Math.min(vertical ? m.top + m.height : m.left + m.width, (vertical ? m.top : m.left) + guide.to - (vertical ? m.scrollTop : m.scrollLeft))
    if (end <= start || line < (vertical ? m.left : m.top) || line > (vertical ? m.left + m.width : m.top + m.height)) return null
    return <div key={guide.axis} className="main-alignment-guide" data-alignment-axis={guide.axis} aria-hidden="true" style={vertical ? { left: line, top: start, width: 1, height: end - start } : { left: start, top: line, width: end - start, height: 1 }} />
  })}</>
}
