/** Fine-step sanitized evidence, saved only under ignored .local/. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { projectGrid } from '../src/shared/grid/projection.ts'
import { COMPOSITIONS } from '../tests/fixtures/grid-compositions.ts'
import { assertContinuous, assertSafe, changes, rectangles, spatialViolations } from '../tests/helpers/projection-oracle.ts'
import type { ProjectionSample } from '../tests/helpers/projection-oracle.ts'

const label = process.argv.includes('--before') ? 'before' : 'after', results: unknown[] = []
for (const [name, source] of Object.entries(COMPOSITIONS)) {
  const transitions: unknown[] = [], violations: unknown[] = []
  let maximum = { edge: 0, area: 0, relativeArea: 0, pitchChange: 0, libraryRelativeArea: 0, probes: 0 }, samples = 0
  for (const axis of ['width', 'height'] as const) {
    let previous: ProjectionSample | undefined
    for (let n = axis === 'width' ? 650 : 400; n <= (axis === 'width' ? 1700 : 1000); n++) {
      const width = axis === 'width' ? n : 1100, height = axis === 'height' ? n : 650
      const projected = projectGrid(source, width, height)
      const sample = { width, height, snapshot: projected.snapshot, metrics: projected.metrics }
      maximum.probes = Math.max(maximum.probes, projected.probes)
      samples++
      if (label === 'after') assertSafe(source, sample)
      const errors = spatialViolations(source, sample.snapshot)
      if (errors.length && violations.length < 8) violations.push({ width, height, errors, logical: sample.snapshot.placements })
      if (previous) {
        const c = changes(previous, sample)
        if (label === 'after') assertContinuous(previous, sample)
        const oldLibrary = rectangles(previous).find(p => p.id === 'library')!, library = rectangles(sample).find(p => p.id === 'library')!
        maximum = { ...maximum, edge: Math.max(maximum.edge, c.edge), area: Math.max(maximum.area, c.area), relativeArea: Math.max(maximum.relativeArea, c.relativeArea), pitchChange: Math.max(maximum.pitchChange, c.pitchChange),
          libraryRelativeArea: Math.max(maximum.libraryRelativeArea, Math.abs(library.width * library.height / (oldLibrary.width * oldLibrary.height) - 1)) }
        if (previous.snapshot.columns !== sample.snapshot.columns || previous.snapshot.rows !== sample.snapshot.rows || c.edge > c.pitch) transitions.push({ axis, ...c,
          before: { ...previous, pixels: rectangles(previous) }, after: { ...sample, pixels: rectangles(sample) } })
      }
      previous = sample
    }
  }
  const result = { name, sourceHash: createHash('sha256').update(JSON.stringify(source)).digest('hex'), source, samples, maximum, violations, transitions }
  results.push(result)
  console.log(JSON.stringify({ label, name, samples, maximum, violations: violations.length, transitions: transitions.length }))
}
mkdirSync('.local/diagnostics', { recursive: true })
writeFileSync(`.local/diagnostics/projection-${label}.json`, JSON.stringify(results, null, 2))
