import test from 'node:test'
import assert from 'node:assert/strict'
import { generate, kebab, svgFromComponent, usedIcons } from '../tools/native-icons.ts'

test('native Heroicons copies are exactly the icons the Electron reference imports', () => {
  assert.equal(kebab('Squares2X2Icon'), 'squares-2x2')
  assert.equal(kebab('Cog6ToothIcon'), 'cog-6-tooth')
  assert.equal(kebab('ArrowsPointingOutIcon'), 'arrows-pointing-out')
  const svg = svgFromComponent('React.createElement("path", {\n strokeLinecap: "round",\n d: "M1 2"\n })')
  assert.equal(svg, '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" d="M1 2"/></svg>\n')
  assert.throws(() => svgFromComponent('no element'))
  assert.ok(usedIcons('.').includes('BellIcon'))
  assert.deepEqual(generate('.', true), [])
})
