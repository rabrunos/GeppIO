/**
 * Regenerates the Heroicons 24/outline SVG copies used by the native GeppUI from the
 * approved `@heroicons/react` dependency (MIT, notice in docs/legal/heroicons-LICENSE.txt).
 * Only icons the Electron reference imports are copied. Every Electron use carries the
 * `.icon` class, whose CSS stroke width (1.8) overrides the components' 1.5, so the
 * copies bake 1.8 in. Run `node --experimental-strip-types tools/native-icons.ts [--check]`.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const STROKE = '1.8'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

export function usedIcons(root: string): string[] {
  const names = new Set<string>()
  for (const file of sourceFiles(join(root, 'src'))) {
    for (const [, list] of readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]+)\}\s*from\s*'@heroicons\/react\/24\/outline'/g))
      for (const name of list!.split(',').map(part => part.trim()).filter(Boolean)) names.add(name)
  }
  return [...names].sort()
}

/** `Squares2X2Icon` → `squares-2x2`, the upstream file name. */
export function kebab(component: string): string {
  return (component.replace(/Icon$/, '').match(/\d+X\d+|[A-Z][a-z]*|\d+/g) ?? []).join('-').toLowerCase()
}

export function svgFromComponent(source: string): string {
  const elements = [...source.matchAll(/React\.createElement\("(path|circle|rect)",\s*\{([^}]*)\}/g)].map(([, tag, body]) => {
    const attrs = [...body!.matchAll(/(\w+):\s*"([^"]*)"/g)].map(([, key, value]) => {
      const name = key!.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())
      return `${name}="${value}"`
    })
    return `<${tag} ${attrs.join(' ')}/>`
  })
  if (!elements.length) throw new Error('No drawable element in Heroicons component')
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="${STROKE}" stroke="currentColor">${elements.join('')}</svg>\n`
}

export function generate(root: string, check: boolean): string[] {
  const require = createRequire(resolve(root, 'package.json'))
  const base = dirname(require.resolve('@heroicons/react/24/outline/index.js'))
  const out = join(root, 'native', 'crates', 'geppui', 'assets', 'icons')
  const problems: string[] = []
  for (const component of usedIcons(root)) {
    const target = join(out, kebab(component) + '.svg')
    const svg = svgFromComponent(readFileSync(join(base, component + '.js'), 'utf8'))
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== svg) problems.push('Stale or missing icon copy: ' + kebab(component))
    } else writeFileSync(target, svg)
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check')
  const problems = generate(process.cwd(), check)
  for (const problem of problems) console.error(problem)
  if (problems.length) process.exitCode = 1
  else console.log(check ? 'PASS  Native Heroicons copies match @heroicons/react' : 'Wrote native Heroicons copies')
}
