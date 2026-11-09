# Trusted-local data and text surfaces — API 2

Alpha.21 / Issues #23, #12 and #5 adds an opt-in pilot contract, not a general SDK or community
sandbox. The independently built first-party Workspace Essentials package uses the existing native
directory installation, enablement and Worker contribution path. Anotações, Rascunho, Checklist and
Prompts salvos require explicit placement. Since alpha.22 / Issue #41, the shared host registry
allows Anotações, Checklist and Prompts salvos in Main and Sidebar; Rascunho stays Main-only.
Their Sidebar useful minimum is 150px, following the inner panel width with wrapped controls.
Existing installation UUIDs, runtime identity and data stay unchanged through placement and
restart; no reinstall or manifest migration is required. Fresh profiles remain empty; each type
is single-view. Shared Sidebar membership still prevents a move that would strand another bar.

## Author and renderer boundary

`schemaVersion:1, apiVersion:2` opts in using the existing manifest keys/widget declarations.
`sdk/plugin.d.ts` and the exact API 1 text/action validator remain unchanged. API 2 uses
`sdk/plugin-v2.d.ts`: literal status text, at most eight text fields, four lists (100 items each),
eight actions and one host copy declaration bound to a published text field. Control IDs are unique.
Text fields are bounded to 32,768 UTF-16 code units, with optional smaller maxima; pilot titles/items
use 512. Publications are at most 256 KiB UTF-8. No HTML, Markdown evaluation, custom CSS or
renderer-loaded plugin code is added.

Input/select/toggle/action events have exact shapes. The host checks owning widget, current
publication/control/item, field length and active lifecycle, with ten events/second and at most
eight queued events/activation. Queued events are revalidated before delivery. Worker messages are
bounded to 120/second for API 2 (60 for unchanged API 1), including publications and data requests.
Input coalesces for 500 ms and flushes on blur. Failed delivery retains local text with retry;
failed storage retains the plugin model with failure feedback. Wait for **Salvo.** before disabling
or exiting. Pending drafts are activation-local, not crash recovery. View removal keeps the Worker.
An API 2 lifecycle failure/timeout retains the last host surface and local input drafts for copying,
with an explicit failure message and read-only controls. Retry/disable/restart is deliberate and
can discard these pending drafts; API 1 retains its original failure-clears-publication policy.

The host calls `navigator.clipboard.writeText` directly from the user's copy click using the current
draft of the declared text field, including edits still awaiting autosave. No clipboard method enters
the Worker facade or preload. Text stays selectable; denial/unavailability offers manual-copy
feedback. Blanket Electron permission denial remains unchanged. Platform references:
[Electron permissions](https://www.electronjs.org/docs/latest/api/session),
[Clipboard writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

## Identity and lifecycle

The installation's host-generated UUID (`revision` in package preferences) is its durable identity,
distinct from manifest ID. No in-place update exists; future updates require an explicit identity/
migration decision. A new install gets a new UUID even when its manifest ID and bytes match.

Main opens a random activation token only for an enabled, inspected API 2 installation. It binds
the token to that installation and owning webContents; the Worker never receives it. Worker data
requests route through their callback-bound runtime entry, never a claimed namespace. Main checks
exact main-frame URL/identity, enabled installation and channel inside the serialized operation and
immediately before replacement. Unknown fields and namespace claims are rejected.

Stop/failure/shutdown releases the channel before disposal. Main revokes on disable/uninstall,
main-frame navigation/reload, render-process loss and destruction. A document-generation counter
invalidates pending opens across navigation; a repeated owner/installation open replaces its token.
Queued stale operations fail. Shared-origin Workers retain browser storage authority: these API
checks do not establish isolation from hostile code or same-user disk attacks. No Worker native
filesystem, process, remote service, credentials or arbitrary IPC is introduced.

## Data and replacement

Data is separate from layout/compositions and `plugins/state.json`:
`userData/plugin-data/<installation UUID>.json`. Only Main supplies paths. Its envelope is
`{schemaVersion:1, pluginId, installation, revision, document}`. Authors read/write one document
`{schemaVersion:1, value: JSON}`, supplying an expected revision through the bound facade.

Limits: 128 KiB UTF-8/document, 12 nested levels, 4,096 values, finite numbers, dense arrays,
bounded keys, 20 requests/second/channel and at most 16 queued data operations/store. Validate/copy
before enqueueing. The pilot also validates `value.version:1`, selected IDs, up to 30 notes,
30 prompts and 100 ordered checklist items. Unsupported pilot data blocks editing rather than
substituting and saving an empty document.

Management/data operations share Main's serial queue. Revision comparison rejects lost updates.
Every write validates current disk data, writes a unique same-directory `wx` temporary file and
renames it over the destination. Only completed replacement is acknowledged. Cleanup cannot turn
a committed replacement into reported failure. This is atomic application replacement, without
an fsync/power-loss durability guarantee. Managed roots/files reject links and wrong file types.

## Retention and recovery

View removal, disable, restart and uninstall retain confirmed data. The same installation restores
it after re-enable/restart. Uninstall removes package/preferences but leaves its UUID file for
manual recovery; reinstalling the same manifest ID cannot read it. Deletion, automatic transfer,
migration and a recovery UI are outside this slice.

Malformed/unsupported/oversized bytes are preserved and replacement is blocked. Close the app,
back up the profile including `plugins/state.json` and `plugin-data`, and inspect copies for recovery.
A known-good copy for the **same installation** can restore reading after restart. Never rename an
old UUID file to silently transfer ownership to a replacement installation. On save failure, retry
after fixing storage or copy pending text before closing; activation-local drafts are not durable.

Coverage: `tests/plugin-data.test.ts`, `tests/plugin-runtime.test.ts`, `pnpm test:essentials`.
The disposable-profile smoke installs/enables, explicitly places, edits/copies, restarts, compares,
disables/re-enables, removes/reopens a view, exercises native failure/draft/retry and checks API 1
Counter/Pulse. It runs first in `pnpm test:desktop`; archived-bar assertions remain unchanged.
