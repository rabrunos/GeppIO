---
name: geppio-verify
description: Select and interpret focused GeppIO unit, Cargo, packaging and Windows desktop checks for the Electron reference and the native host.
---

Map the changed behavior to tests and commands in docs/development/testing.md. Build the assets under test. Serialize desktop, clipboard and native-dialog runs in isolated profiles. Compare actual platform, profile, entry point, arguments and assertions before reusing previous evidence. Investigate the first failing assertion and distinguish product failures from unavailable prerequisites. Keep physical/manual acceptance in the active Issue.

In `native/`, run the owning crate's tests (`cargo test -p <crate>`) before the full native gate, and the pinned cargo-deny check used by CI when a manifest or `Cargo.lock` changes. Serialize window captures with other desktop runs and avoid sharing a Cargo target directory with a concurrent build. Record each command, exit status, cleanup and what the evidence covers; keep raw diagnostics under ignored `.local/`.
