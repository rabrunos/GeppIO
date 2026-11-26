import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { repositoryErrors } from '../tools/check-repo.ts'

test('repository gate validates license, version, pins, scoped authority and links on a small disposable checkout', t => {
  const root = mkdtempSync(join(tmpdir(), 'geppio-repository-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.github/workflows'), { recursive: true })
  mkdirSync(join(root, 'docs/legal'), { recursive: true })
  cpSync('docs/legal', join(root, 'docs/legal'), { recursive: true })
  cpSync('LICENSE', join(root, 'LICENSE'))
  const write = (path: string, text: string) => writeFileSync(join(root, path), text)
  const rules = '[scope](https://github.com/rabrunos/GeppIO/issues/22): `origin/main` of `rabrunos/GeppIO` (ID `1409287329`).\n'
  const pkg = { name: 'geppio', version: '1.0.0', license: 'Apache-2.0', dependencies: { example: '2.0.0' } }
  write('AGENTS.md', rules)
  write('package.json', JSON.stringify(pkg))
  write('CHANGELOG.md', '## [1.0.0]\n')
  write('README.md', '[license](LICENSE)\n')
  write('.github/workflows/checks.yml', '')
  write('pnpm-lock.yaml', '')
  assert.deepEqual(repositoryErrors(root), [])

  for (const target of ['`origin/main`', '`rabrunos/GeppIO`', '`1409287329`']) {
    write('AGENTS.md', rules.replace(target, '`different-target`') + '\nHistorical reference: ' + target)
    assert.match(repositoryErrors(root).join('\n'), /Git authority/)
  }

  write('AGENTS.md', rules.replace('rabrunos/GeppIO', 'elsewhere/GeppIO'))
  write('CHANGELOG.md', '## [0.9.0]\n')
  write('README.md', '[missing](docs/missing.md)\n[outside](../)\n')
  write('package.json', JSON.stringify({ ...pkg, license: 'MIT', dependencies: { example: '^2.0.0' },
    scripts: { example: 'node tools/missing/cli.ts' } }))
  write('LICENSE', 'Apache-2.0')
  const result = repositoryErrors(root).join('\n')
  for (const expected of [/Git authority/, /Root LICENSE/, /version must head the changelog/,
    /Unexpected package license/, /Unpinned or unknown dependency/, /Missing script target/,
    /local link: README.md -> docs\/missing.md/, /local link: README.md -> \.\.\//]) assert.match(result, expected)

  rmSync(join(root, 'LICENSE'))
  rmSync(join(root, 'docs/legal/monaco-ThirdPartyNotices.txt'))
  const missing = repositoryErrors(root)
  assert.ok(missing.includes('Missing required file: LICENSE'))
  assert.ok(missing.includes('Missing required file: docs/legal/monaco-ThirdPartyNotices.txt'))
})
