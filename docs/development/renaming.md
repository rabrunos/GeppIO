# GeppIO identity and profile recovery

Issue #6 assigns GeppIO as the exact display name and `geppio` as the lowercase technical
namespace. It fits package, URL-scheme and Windows directory syntax; repository inventory found
no competing active identity/bridge. The package is private. No public package registration,
installer appId, publisher, signing or update-channel contract is introduced.
The current repository is `rabrunos/GeppIO` (GitHub repository ID `1409287329`), after the owner completed the separate rename from Geptor and updated local origin. Active links/policies use the canonical name. Domain operations remain separately authorized.
BootCrate attribution and historical `semnome`/Geptor evidence remain truthful.

| Surface | Current identity | Legacy compatibility |
| --- | --- | --- |
| Package / profile | `geppio` | Original package name `semnome` is historical |
| Display / window / HTML title | GeppIO | No display alias |
| Production origin | `geppio://app` | `semnome://app` only in a dedicated inert recovery session |
| Narrow preload bridge | `window.geppio` | No old bridge alias or expanded operations |
| Native identity recovery key | `geppio:layout:v1` | Read `semnome:layout:v1` only during identity migration; this is not the active workbench envelope |
| Current host workbench | `geppio:workbench:v1` | Independent versioned document; earlier layout keys remain recovery sources |
| Earlier layout keys | `geppio:layout:grid:v2`, `geppio:layout:horizontal:v1`, `geppio:layout:freeform:v1` | Renderer recovery/explicit adoption; native identity migration does not rewrite them |
| Desktop data / session directory | OS appData + `geppio` | OS appData + `semnome` retained untouched |
| Smoke override | `GEPPIO_TEST_USER_DATA` | Only regular OS-temp `geppio-smoke-*` fixture roots |
| Plugin IDs, revisions and preferences | Existing IDs unchanged | `local.counter`, `local.pulse` remain independent |
| Development layout origin | `http://127.0.0.1:5173` | Same origin, old key; separate from production |

## First launch and safety

Close the old application before opening GeppIO. Windows defaults are `%APPDATA%\semnome`
and `%APPDATA%\geppio`. Both userData and sessionData are set before Electron readiness.
Test overrides redirect both directories into disposable fixtures; tests never inspect or mutate
the owner's actual profiles.

An existing destination is never merged, replaced or repaired, even if empty or corrupt. If it is
absent, Main snapshots only `plugins/` and `Local Storage/` into a sibling staging directory,
verifies source bytes again and renames staging to the destination. The old profile is untouched.
Cookies, caches and arbitrary profile files are excluded. Each input tree is limited to 128 MiB,
10,000 entries and depth 16; links/nonregular files are rejected. Oversize, inaccessible or
changing profiles stop copying instead of resetting data. Close the prior app before retrying.

Local-storage bytes are copied verbatim into the new profile and separately into
`geppio/identity-backup-v1/Local Storage/`. A derived `geppio/identity-recovery-v1/` session
reads that backup through a hidden sandboxed window: no preload, Node, plugins, workers,
permissions, downloads, remote documents or arbitrary asset paths. Its handler returns one exact
inert document and is removed afterward. The normal app session never handles the legacy protocol.
Main uses fixed local-storage scripts; stored bytes are data, never executable code.

At the selected production/development origin, only an absent new key can receive the legacy
layout after the existing 64 KiB/schema/widget/minimum/geometry checks. Any destination value,
including empty or corrupt text, is preserved. Schema v1 stays unchanged. This paragraph describes
the alpha.4 identity-migration increment, not the complete current persistence system under #17.
Plugin state retains IDs, revisions and enabled flags;
existing validation blocks corrupt state and invalid packages. Trusted enabled packages keep
their prior activation preference.

Repeat launches keep the new profile and layout. Production/dev recovery occurs separately when
each origin is first opened. Original/backup bytes remain available even when Chromium cannot read
a corrupt database. A failed layout transfer warns; do not save a replacement before recovering
the desired draft. Missing old drafts use the normal default. There is no automatic plugin merge.

## Current workbench adoption and historical layout sources

Issue #29 / alpha.12 left native identity migration unchanged and introduced the separate
`geppio:layout:freeform:v1` renderer key. Alpha.13/alpha.14 added the current host envelope
`geppio:workbench:v1`, with widget identities/views, bars, compositions and confirmed chrome.
The fractional v1, responsive v2, horizontal v1 and earlier freeform keys remain recovery sources;
native identity migration still handles only its bounded legacy v1 contract. Do not erase codecs,
backups or old keys because their placement engine is no longer active.

The renderer offers explicit historical/previous-layout and imported-JSON previews. Loading or
projecting a preview does not overwrite originals; a validated save/conclusion adopts the selected
scene into the current workbench envelope. Save editing advances the Cancel checkpoint without
leaving Edit; Conclude validates the slot-free document before exiting. Normal paired resize and
organization updates have independent confirmed transaction paths once a current document is usable;
they are not permission to silently adopt an unresolved recovery preview. Web Locks/observed-byte
comparison and quota failures retain recoverable data rather than overwrite a competing source.
Preferences remain separate keys; this is not an atomic multi-key database or plugin-owned storage.

The identity/desktop smokes cover explicit choice/adoption and restart together with profile,
backup, plugin and negative-protocol assertions. An incompatible or missing declaration can keep
the workbench in recovery with exact bytes preserved and editing unavailable. The P19 selector
does not remove that incompatible association in this state; no silent repair is promised.

## Backup, rollback and existing destinations

These are owner recovery steps, never automation against personal data. Close all app instances.
Back up **both complete profiles** to separate dated folders in Windows Explorer, outside Git,
and retain the originals. Do not edit LevelDB files, globally replace serialized identity text,
or combine plugin packages and state.json from different snapshots.

- **Rollback:** run the prior build with its untouched `semnome` profile. Edits in `geppio` are
  not reverse-migrated; retain the new profile and its backup for later use.
- **Existing new profile:** its data wins. For fresh recovery, back up both profiles, rename the
  closed `geppio` directory to a unique recovery name and reopen GeppIO. Compare the copied old
  state with the retained new state before deciding which profile to use; neither is deleted.
- **Selective layout recovery:** in the prior build on the matching origin, export the text value
  of `semnome:layout:v1` using trusted developer tooling into JSON. Use GeppIO's Import layout
  preview, inspect it and explicitly confirm the validated scene through the current editing
  save/conclusion flow. Import keeps the current theme; choose it separately. The project-menu
  Export configuration action is a demonstration, not a native export/download mechanism.
- **Corrupt new layout/state:** preserve raw bytes and use the backed-up/fresh-profile procedure.
  Do not delete state.json to unblock management or silently enable packages. Reinstall invalid
  packages only from reviewed original sources.
- **Corrupt derived recovery session:** after full backups and closing all apps, rename
  `identity-recovery-v1` to a unique backup name. Next launch reconstructs it from unchanged
  `identity-backup-v1`. If that backup is corrupt, retain it and recover a valid JSON export or
  known-good whole-profile backup; no byte-level database repair is promised.

## Validation and scoped acceptance

`pnpm check` covers profile/negative/security tests, full TypeScript, lint, examples and bundling.
`pnpm test:desktop` seeds a real legacy Chromium profile and checks layout/theme transfer,
installed/enabled plugin continuity, restart/idempotence, original/backup bytes, existing/corrupt
destination preservation and the new identity/bridge. Then it runs existing plugin/foundation
smoke. `pnpm test:desktop:dev` repeats both layers on loopback. Only generated temp roots are deleted.

Owner acceptance stays in #6, #21 and #1. The [7/7 owner report for identity migration](https://github.com/rabrunos/GeppIO/issues/6#issuecomment-6061616728)
was accepted within the alpha.4 scope; the [alpha.5 repository-reference continuation](https://github.com/rabrunos/GeppIO/issues/6#issuecomment-6063003164)
preserved that acceptance. The conditional start/dev item does not discriminate individual runs.
Do not request the same acceptance again merely because the original checklist remains unedited.
For an actual new migration change or recovery session, select the relevant origin/layout/theme,
installed/enabled restart and keyboard/focus/DPI scenarios, with backups and the old app closed.
Automated smoke and repository rename do not accept unrelated work or authorize Issue closure.
