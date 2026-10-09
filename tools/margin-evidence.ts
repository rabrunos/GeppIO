/** Sanitized coverage evidence; run --before only on the baseline projector. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { projectGrid } from '../src/shared/grid/projection.ts'
import type { GridProjection } from '../src/shared/grid/projection.ts'
import { COMPOSITIONS } from '../tests/fixtures/grid-compositions.ts'
import { assertContinuous, assertNoSpike, assertSafe, changes, rectangles, spatialViolations } from '../tests/helpers/projection-oracle.ts'

const phase = process.argv.includes('--before') ? 'before' : 'after', records = []
for (const [name, source] of Object.entries(COMPOSITIONS)) for (const [width, height] of [[1100, 650], [1480, 740], [1700, 850], [1562, 576], [740, 1480], [10000, 100]]) {
  const p = projectGrid(source, width!, height!), m = p.metrics, gutter = Math.min(10, width! / 48, height! / 48)
  if (phase === 'after') assertSafe(source, { width: width!, height: height!, ...p })
  const record = { name, sourceHash: createHash('sha256').update(JSON.stringify(source)).digest('hex'), source, width, height,
    columns: p.snapshot.columns, rows: p.snapshot.rows,
    requestedPitch: 'requestedPitch' in p ? p.requestedPitch : Math.max(Math.sqrt((width! + gutter) * (height! + gutter) / 192), (width! + gutter) / 24, (height! + gutter) / 24),
    renderedPitch: m.pitch, gridWidth: m.width, gridHeight: m.height,
    margins: { left: m.left, right: width! - m.width - m.left, top: m.top, bottom: height! - m.height - m.top },
    warning: p.warning, logical: p.snapshot.placements, pixels: rectangles({ width: width!, height: height!, ...p }) }
  records.push(record)
  if (width === 1480 && height === 740) console.log(JSON.stringify({ name, width, height, columns: record.columns, rows: record.rows,
    requestedPitch: record.requestedPitch, renderedPitch: record.renderedPitch, margins: record.margins }))
}
mkdirSync('.local/diagnostics', { recursive: true })
writeFileSync(`.local/diagnostics/margins-${phase}.json`, JSON.stringify(records, null, 2))
if (phase === 'after') {
  const sweeps = []
  for (const [name, fixture] of Object.entries(COMPOSITIONS)) for (const edit of [false, true]) {
    const initial = projectGrid(fixture, 1100, 650), source = edit ? initial.snapshot : fixture
    const reference = edit ? { width: 1100, height: 650, pitch: initial.metrics.pitch } : null
    for (const horizontal of [true, false]) {
      const samples: (GridProjection & { width: number; height: number })[] = [], transitionIndices: number[] = []
      const maximum = { edge: 0, area: 0, relativeArea: 0, normalizedEdge: 0, pitchChange: 0 }
      for (let n = horizontal ? 800 : 400; n <= (horizontal ? 2200 : 1100); n++) {
        const width = horizontal ? n : 1480, height = horizontal ? 740 : n
        const p = projectGrid(source, width, height, reference), current = { width, height, ...p }
        assertSafe(source, current)
        const previous = samples.at(-1), before = samples.at(-2)
        if (previous) {
          assertContinuous(previous, current)
          if (before) assertNoSpike(before, previous, current)
          const c = changes(previous, current)
          for (const k of Object.keys(maximum) as (keyof typeof maximum)[]) maximum[k] = Math.max(maximum[k], c[k])
          if (previous.snapshot.columns !== p.snapshot.columns || previous.snapshot.rows !== p.snapshot.rows) transitionIndices.push(samples.length)
        }
        samples.push(current)
      }
      const nearby = new Set(transitionIndices.flatMap(i => [i - 2, i - 1, i, i + 1, i + 2]))
      const result = { name, edit, sourceHash: createHash('sha256').update(JSON.stringify(source)).digest('hex'), source, reference,
        axis: horizontal ? 'width' : 'height', samples: samples.length, transitions: transitionIndices.length, maximum,
        violations: samples.flatMap(s => spatialViolations(source, s.snapshot)),
        transitionSamples: samples.filter((_, i) => nearby.has(i)).map(s => ({ ...s, pixels: rectangles(s),
          margins: { left: s.metrics.left, right: s.width - s.metrics.width - s.metrics.left, top: s.metrics.top, bottom: s.height - s.metrics.height - s.metrics.top } })) }
      sweeps.push(result)
      console.log(JSON.stringify({ name, edit, axis: result.axis, samples: result.samples, transitions: result.transitions, maximum, violations: result.violations.length }))
    }
  }
  writeFileSync('.local/diagnostics/margins-continuity.json', JSON.stringify(sweeps, null, 2))
}
