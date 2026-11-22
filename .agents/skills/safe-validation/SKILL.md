---
name: safe-validation
description: Validate GeppIO changes with repository checks and disposable Electron journeys on supported local or hosted desktops.
---

Run focused Node tests for changed behavior and failure paths. Build current assets with `pnpm check` before final desktop validation. On Windows, prefer `pnpm.cmd test:isolated <suite>` and the variants listed by `--help`. Run GUI suites sequentially. Inspect the isolation receipt for window attestation, exit status and cleanup.

Full Essentials, Terminal and edit-lock share the desktop clipboard. Use their hosted gates or a task-authorized visible run with a disposable profile. Scope `GEPPIO_TEST_VISIBLE=1` to that invocation and restore the previous value. Follow the [validation guide](../../../docs/development/testing.md) for supported routes and native dialogs.

Record each check as passed, failed, blocked or not run. Identify the command and variant, distinguish simulated scaling from physical display observations and report owner acceptance separately.
