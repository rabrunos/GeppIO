---
name: geppio-modules
description: Trace GeppIO workspace and crate ownership, public consumers, shared editor models and plugin activation.
---

Trace the public entry, owner and callers before moving code. Keep policy and native services in the host. Follow document revisions through shared editor models and independent view state. Distinguish plugin installation, accepted generation, activation, grants and views. Check teardown, stale calls, denial and rejection of candidate updates. Verify reusable packages with a disposable external consumer and Standalone with a reduced composition.

In `native/`, follow the crate directions enforced by `tools/check-modules.ts`: `geppio-core` stays pure Rust without GPUI or platform services, `geppui` stays consumable without GeppIO crates, and the `geppio` app composes them. Build `geppui` from the external consumer before changing its public API.
