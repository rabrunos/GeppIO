import type { AlignmentGuide } from '../../../shared/freeform/alignment.ts'
import type { Measurement } from './useSurfaces.ts'
export function AlignmentGuides({ guides, measurement: m }: { guides: readonly AlignmentGuide[]; measurement: Measurement }) {
  return <>{guides.map(guide => {
    const vertical = guide.axis === 'x', line = (vertical ? m.left : m.top) + guide.line - (vertical ? m.scrollLeft : m.scrollTop)
    const start = Math.max(vertical ? m.top : m.left, (vertical ? m.top : m.left) + guide.from - (vertical ? m.scrollTop : m.scrollLeft))
    const end = Math.min(vertical ? m.top + m.height : m.left + m.width, (vertical ? m.top : m.left) + guide.to - (vertical ? m.scrollTop : m.scrollLeft))
    if (end <= start || line < (vertical ? m.left : m.top) || line > (vertical ? m.left + m.width : m.top + m.height)) return null
    const spacing = guide.kind === 'spacing', peer = line + guide.peerLine - guide.line
    return <div key={guide.axis} className="main-alignment-guide" data-alignment-axis={guide.axis} data-alignment-kind={guide.kind} data-alignment-gap={guide.gap} data-alignment-line={guide.line} data-alignment-peer-line={guide.peerLine} aria-hidden="true" style={vertical ? { left: spacing ? Math.min(line, peer) : line, top: start, width: spacing ? guide.gap : 1, height: end - start } : { left: start, top: spacing ? Math.min(line, peer) : line, width: end - start, height: spacing ? guide.gap : 1 }}>{spacing && <span>{guide.gap}px</span>}</div>
  })}</>
}
