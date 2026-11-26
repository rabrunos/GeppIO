# GeppIO native host

The Rust + upstream GPUI host that replaces the Electron application screen by screen. The Electron application stays runnable as the behavioral reference. Decisions are in [Stage A](https://github.com/rabrunos/GeppIO/issues/73) and delivery in [Stage B](https://github.com/rabrunos/GeppIO/issues/74).

## Crates

| Crate | Responsibility | May depend on |
| --- | --- | --- |
| `crates/geppui` | Independent component library: both theme token tables, device-pixel snapping, CSS→GPUI conversions, per-glyph letter spacing, icons, interruptible CSS-style motion, reduced motion, button, icon button, popover, menu item, dialog and scroll area. Knows nothing about GeppIO. | `gpui` |
| `crates/geppio-core` | Pure Rust model, testable headless: shell geometry and region limits today; placement, transactions and the `geppio:workbench:v1` envelope in B2. No GPUI, no window. | `std`, `serde`, `serde_json` |
| `crates/geppio` | The desktop app: frameless window, main screen composition, region state, preferences and the single read-only OS query (reduced motion). | `geppui`, `geppio-core`, `gpui`, `gpui_platform`, `serde`, `serde_json` |
| `examples/geppui-consumer` | External consumer with its own lockfile, using only GeppUI's public API. | `geppui` (path), `gpui`, `gpui_platform` |

`tools/check-modules.ts` enforces these directions, a single git source (`zed-industries/zed` at `610ea4b8de1c6e887f03563f067278002f41256e`, Zed v1.30.2), exact registry pins, no `[patch]` and committed lockfiles. `tools/check-repo.ts` checks that `[workspace.package].version` equals `package.json`.

## Toolchain and commands

Install Visual Studio Build Tools with the C++ workload and the Windows SDK (`rc.exe`; `fxc.exe` for release shaders) and rustup. `rust-toolchain.toml` selects Rust 1.98.1 MSVC. Set `CARGO_NET_GIT_FETCH_WITH_CLI=true` if the first GPUI fetch (about 1.2 GB of Zed history) fails through libgit2.

From `native/`:

```powershell
cargo test --locked --workspace
cargo deny --locked check -W unmaintained   # cargo-deny 0.20.2
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo build --locked --release -p geppio
cargo run --locked -p geppio
```

The external consumer builds from `examples/geppui-consumer` with `cargo build --locked --target-dir ../../target`.

## Data

The app keeps its own profile in `%APPDATA%\geppio-native\preferences.json` (theme, region visibility and sizes). It never reads or writes the Electron profile (`%APPDATA%\geppio`). Corrupt or unknown preferences fall back to defaults.

## Automated comparison hooks

Normal use reads none of these. `GEPPIO_NATIVE_TEST_PROFILE` is accepted only for a `geppio-native-test-*` directory directly under the system temp folder.

| Variable | Effect |
| --- | --- |
| `GEPPIO_NATIVE_TEST_THEME` | `light` or `dark` |
| `GEPPIO_NATIVE_TEST_ZOOM` | Emulated page zoom, e.g. `1.25` on a 100% display |
| `GEPPIO_NATIVE_TEST_SIZE` | Content size in CSS pixels, e.g. `1280x800` |
| `GEPPIO_NATIVE_TEST_REDUCED_MOTION` | `1` or `0`, overriding the Windows animation setting |
| `GEPPIO_NATIVE_TEST_START` | `collapsed` or `peek` |
| `GEPPIO_NATIVE_TEST_FREEZE` | `collapse@0.5`, `expand@…`, `peek@…`, `bottom@…`: frozen clock inside a motion |
| `GEPPIO_NATIVE_TEST_SCRIPT` | `collapse-interrupt`, `collapse-full`, `peek`, `peek-interrupt`, `bottom`, `theme` |
| `GEPPIO_NATIVE_TEST_TRACE` | File name of a per-frame JSON-lines trace inside the test profile |
