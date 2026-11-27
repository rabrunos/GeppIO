# GeppIO native host

The Rust + upstream GPUI host that replaces the Electron application screen by screen. The Electron application stays runnable as the behavioral reference. Decisions are in [Stage A](https://github.com/rabrunos/GeppIO/issues/73). Delivery is in [Stage B](https://github.com/rabrunos/GeppIO/issues/74) and, toward full parity, [Stage C1](https://github.com/rabrunos/GeppIO/issues/75).

## Crates

| Crate | Responsibility | May depend on |
| --- | --- | --- |
| `crates/geppui` | Independent component library: both theme token tables, device-pixel snapping, CSS→GPUI conversions, per-glyph letter spacing, icons, interruptible CSS-style motion, reduced motion, button and icon button with keyboard focus rings, text action and dialog buttons, text field (caret, selection, clipboard, IME), switch, checkbox, select, popover (below, rail and point placements, arrow-key menus), menu item, dialog, scroll area (with thin and two-axis variants), dashed outline and toast. Knows nothing about GeppIO. | `gpui` |
| `crates/geppio-core` | Pure Rust model, testable headless: shell geometry and region limits; layout reflow, alignment guides and settlement; freeform projection; the workbench model, commands, undo history (256 intentions) and `EditSession` (edit transactions, bar commits, previews and layout import); the `geppio:workbench:v1` codec; the session notification model. No GPUI, no window. | `std` (`serde`, `serde_json` allowed) |
| `crates/geppio` | The desktop app: frameless window, main screen composition, region state, preferences, languages, header panels (profile, Settings, notifications, project, plugins), rail bars and their library, edit mode with the widget catalog and demo widgets, and two read-only OS queries (reduced motion, display language). | `geppui`, `geppio-core`, `gpui`, `gpui_platform`, `serde`, `serde_json` |
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

## Differential tests

`geppio-core` is a port of the TypeScript reference model. `tests/differential.rs` replays fixtures that `tools/native-fixtures.ts` computes with the TypeScript modules (`node --experimental-strip-types tools/native-fixtures.ts` regenerates them; `tests/native-fixtures.test.ts` fails when the committed fixtures drift). The codec uses a project-owned JSON reader and writer so that numbers round-trip and print exactly as `JSON.parse`/`JSON.stringify`. Two native limits differ from JavaScript: unpaired UTF-16 surrogates are rejected and nesting stops at 128 levels.

## Data

The app keeps its own profile in `%APPDATA%\geppio-native`. It never reads or writes the Electron profile (`%APPDATA%\geppio`).

| File | Content | On a corrupt or unknown file |
| --- | --- | --- |
| `preferences.json` | Theme, region visibility and sizes, language (`auto`, `pt-BR`, `en`), center guide, horizontal expansion and the layout name (at most 60 characters) | Defaults |
| `workbench.json` | The `geppio:workbench:v1` composition: written by Save edition, Conclude and bar changes (temporary file, flush, rename; 512 KiB cap). A save first re-reads the file and stops if it changed since it was opened | Recovery, also for an oversized, non-UTF-8 or unreadable file: the file is kept untouched and edit mode stays closed until Settings → "Desenvolvimento e recuperação" opens a preview and Save adopts it |

If `geppio-native` exists as a link or junction, or resolves inside the Electron folder, the app runs without persistence.

## Languages

pt-BR strings are the keys. `assets/i18n/en.json` holds the English catalogue that `tools/native-i18n.ts` generates from the Electron reference (`messages.ts`, `app-messages.ts`); `tests/native-i18n.test.ts` fails when it drifts. "Idioma do navegador" follows the Windows display language. Text without a reference translation stays in Portuguese, as in Electron.

## Bars

The rail lists the active custom bars under Home. Bar changes outside Edit are saved at once; inside Edit they are undoable intentions (`EditSession::commit_organization`). The bar form saves through `EditSession::save_bar` outside Edit only. The library ("Barras salvas") archives, restores and deletes; in Edit, bars reorder by pointer or Alt+↑/↓ and archived bars can be dragged back to the rail. Limits are 14 active custom bars and 100 saved.

## Edit mode

The edit button opens the session and the 480 px catalog. Widgets move by their heading and resize from edges and corners, with live reflow, spacing guides, drop zones and a flight back on cancel. Undo/redo (buttons, `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`) restores whole intentions. Save edition confirms a checkpoint, Conclude saves and leaves, Cancel discards and `Esc` steps back one level (gesture, dialog, catalog search, catalog, session). Focus returns to the edit button on leave. The widgets are demo fixtures; plugins are out of scope.

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
