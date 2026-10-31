/** Approved vector corners and long-dash pattern, shared by region/rail targets.
 * Owners supply their measured CSS-pixel rectangle; this component never reads DOM.
 */
export function EditOutline({ width, height }: { width: number; height: number }) {
  const pattern = (length: number) => { const count = Math.max(0, Math.floor((length - 15) / 32)); return { count, end: Math.max(0, (length - count * 17 - (count + 1) * 15) / 2) } }
  const x = .5, y = .5, right = width - .5, bottom = height - .5, r = Math.max(0, Math.min(11.5, (width - 1) / 2, (height - 1) / 2))
  const horizontal = pattern(Math.max(0, width - 1 - 2 * r)), vertical = pattern(Math.max(0, height - 1 - 2 * r)), h = horizontal.end, v = vertical.end
  const corners = [`M ${x + r + h} ${y} H ${x + r} A ${r} ${r} 0 0 0 ${x} ${y + r} V ${y + r + v}`,
    `M ${right - r - h} ${y} H ${right - r} A ${r} ${r} 0 0 1 ${right} ${y + r} V ${y + r + v}`,
    `M ${right} ${bottom - r - v} V ${bottom - r} A ${r} ${r} 0 0 1 ${right - r} ${bottom} H ${right - r - h}`,
    `M ${x + r + h} ${bottom} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${bottom - r} V ${bottom - r - v}`].join(' ')
  const hs = x + r + h + 15, vs = y + r + v + 15, hl = Math.max(0, horizontal.count * 17 + (horizontal.count - 1) * 15), vl = Math.max(0, vertical.count * 17 + (vertical.count - 1) * 15)
  const lines = [[hs, y, hs + hl, y, horizontal.count], [right, vs, right, vs + vl, vertical.count], [hs, bottom, hs + hl, bottom, horizontal.count], [x, vs, x, vs + vl, vertical.count]]
  return <svg aria-hidden="true" focusable="false" fill="none" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d={corners} />{lines.map(([x1, y1, x2, y2, count], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray="17 15" visibility={count ? 'visible' : 'hidden'} />)}</svg>
}
