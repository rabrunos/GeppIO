import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { GPUI_SOURCE, checkModules, checkNative } from '../tools/check-modules.ts'

test('package graph, public entries, platform imports and pure ambient types fail independently', t => {
  const root = mkdtempSync(join(tmpdir(), 'geppio-package-boundaries-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file: string, source: string) => {
    const path = join(root, 'src', file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
  function manifest(name: string, dependencies: Record<string, string> = {}) {
    write(name + '/package.json', JSON.stringify({
      name: '@geppio/' + name, type: 'module', exports: { '.': './src/index.ts' }, dependencies
    }))
  }
  for (const name of ['application', 'standalone', 'ui', 'editor', 'plugin-sdk', 'runtime']) {
    manifest(name)
    write(name + '/src/index.ts', 'export const kind = "fixture"\n')
  }
  assert.deepEqual(checkModules(root), [])
  manifest('ui', { '@geppio/application': 'workspace:*' })
  manifest('application', { '@geppio/ui': 'workspace:*' })
  write('ui/src/view.ts', "import type { Internal } from '@geppio/application/private'\n")
  write('runtime/src/pure.ts', "export const title = document.title\n")
  write('application/src/renderer/view.ts', "import type { Stats } from 'node:fs'\nimport type { Port } from '../main/ports.ts'\n")
  write('editor/src/view.ts', "export * from '../../application/src/index.ts'\n")
  const failures = checkModules(root).join('\n')
  assert.match(failures, /Disallowed workspace direction: @geppio\/ui -> @geppio\/application/)
  assert.match(failures, /Workspace dependency cycle/)
  assert.match(failures, /Non-public workspace import/)
  assert.match(failures, /Pure API: .*document/)
  assert.match(failures, /Native dependency in @geppio\/application\/src\/renderer\/view.ts/)
  assert.match(failures, /Platform boundary: .*src\/main\/ports.ts/)
  assert.match(failures, /Relative import leaves workspace/)
})

test('native crate directions, sources, pins, lockfiles and unsafe placement fail closed', t => {
  const root = mkdtempSync(join(tmpdir(), 'geppio-native-boundaries-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const write = (file: string, source: string) => {
    const path = join(root, 'native', file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
  const gpui = `{ git = "${GPUI_SOURCE.git}", rev = "${GPUI_SOURCE.rev}" }`
  const lock = `[[package]]\nname = "gpui"\nsource = "git+${GPUI_SOURCE.git}?rev=${GPUI_SOURCE.rev}#${GPUI_SOURCE.rev}"\n\n[[package]]\nname = "serde"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`
  const crate = (name: string, deps: string, extra = '') => `[package]\nname = "${name}"\nversion.workspace = true # inherited\n\n[dependencies]\n${deps}\n\n[lints]\nworkspace = true\n${extra}`
  const valid = () => {
    write('Cargo.toml', `[workspace]\nmembers = [\n  "crates/geppui",\n  "crates/geppio-core",\n]\n\n[workspace.dependencies]\ngpui = ${gpui}\ngpui_platform = ${gpui}\nserde_json = "=1.0.154"\ngeppui = { path = "crates/geppui" }\n`)
    write('Cargo.lock', lock)
    write('crates/geppui/Cargo.toml', crate('geppui', 'gpui.workspace = true'))
    write('crates/geppui/src/lib.rs', '#![forbid(unsafe_code)]\npub fn ok() {}\n')
    write('crates/geppio-core/Cargo.toml', crate('geppio-core', 'serde_json = { workspace = true }'))
    write('crates/geppio/Cargo.toml', crate('geppio', 'geppui.workspace = true\ngeppio-core.workspace = true\ngpui.workspace = true'))
    write('crates/geppio/src/platform.rs', '#[allow(unsafe_code)]\nmod windows { unsafe extern "system" {} }\n')
    write('examples/geppui-consumer/Cargo.toml', `[package]\nname = "geppui-consumer"\n\n[workspace]\n\n[dependencies]\ngeppui = { path = "../../crates/geppui" }\ngpui = ${gpui}\n`)
    write('examples/geppui-consumer/Cargo.lock', lock)
  }
  valid()
  assert.deepEqual(checkNative(root), [])
  // Each rejected form below is valid TOML that Cargo accepts.
  write('crates/geppio-core/Cargo.toml', crate('geppio-core', 'geppui.workspace = true', '\n[dependencies.gpui]\nworkspace = true\n'))
  write('crates/geppui/Cargo.toml', crate('geppui', 'gpui.workspace = true\ngeppio-core.workspace = true', '\n[patch.crates-io]\nfoo = "1"\n'))
  write('Cargo.toml', `patch.crates-io.serde = { path = "x" }\n[workspace]#comment\n\n[workspace.dependencies]\ngpui = { git = "${GPUI_SOURCE.git}", branch = "main" }\nserde_json = "1"\n"quoted" = "=1.0.0"\nrenamed = { package = "evil", version = "=1.0.0" }\ndecoy = { version = "1", note = "workspace = true" }\nlocal = { path = "../../outside" }\n`)
  write('crates/geppio/Cargo.toml', crate('geppio', 'rand = "=0.9.0"'))
  write('crates/geppio/src/main.rs', 'fn main() { unsafe { std::hint::unreachable_unchecked() } }\n')
  write('examples/geppui-consumer/Cargo.toml', `[package]\nname = "geppui-consumer"\n\n[dependencies]\ngeppui = { path = "../../crates/geppui" }\n`)
  write('.cargo/config.toml', '[patch.crates-io]\n')
  write('Cargo.lock', lock + '\n[[package]]\nname = "x"\nsource = "git+https://example.com/x?rev=1#1"\n')
  const failures = checkNative(root).join('\n')
  for (const expected of [
    /Disallowed native dependency: geppio-core -> geppui/,
    /Native manifest table \[dependencies\.gpui\] is not allowed/,
    /geppui depends on GeppIO crate geppio-core/,
    /Native manifest table \[patch\.crates-io\] is not allowed/,
    /Native manifest keys before the first table: native\/Cargo\.toml/,
    // `[workspace]#comment` is recognized, so the entries after it are still checked:
    /Native git source must be/,
    /Native dependency key "branch" is not allowed/,
    /must be pinned with =x\.y\.z: native\/Cargo\.toml -> serde_json/,
    /Unrecognized native manifest line native\/Cargo\.toml:7/,
    /Native dependency key "package" is not allowed/,
    /Native dependency key "note" is not allowed/,
    /Native path dependency must stay inside native\/: native\/Cargo\.toml -> local/,
    /Disallowed native dependency: geppio -> rand/,
    /Native dependency must come from \[workspace\.dependencies\]: native\/crates\/geppio\/Cargo\.toml -> rand/,
    /unsafe code or FFI outside native\/crates\/geppio\/src\/platform\.rs: native\/crates\/geppio\/src\/main\.rs/,
    /The external consumer must be its own workspace/,
    /Native Cargo configuration directories are not allowed: native\/\.cargo/,
    /Unexpected source in native\/Cargo\.lock: git\+https:\/\/example\.com/
  ]) assert.match(failures, expected)
})
