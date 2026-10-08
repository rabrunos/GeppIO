# GeppIO identity and profile recovery

Issue #6 assigns GeppIO as the exact display name and `geppio` as the lowercase technical
namespace. It fits package, URL-scheme and Windows directory syntax; repository inventory found
no competing active identity/bridge. The package is private. No public package registration,
installer appId, publisher, signing or update-channel contract is introduced.
The repository remains `rabrunos/Geptor`; origin/link rewrites and domain operations are separate.
BootCrate attribution and historical `semnome`/Geptor evidence remain truthful.

| Surface | Current identity | Legacy compatibility |
| --- | --- | --- |
| Package / profile | `geppio` | Original package name `semnome` is historical |
| Display / window / HTML title | GeppIO | No display alias |
| Production origin | `geppio://app` | `semnome://app` only in a dedicated inert recovery session |
| Narrow preload bridge | `window.geppio` | No old bridge alias or expanded operations |
| Layout key | `geppio:layout:v1` | Read `semnome:layout:v1` only during migration |
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
including empty or corrupt text, is preserved. Schema v1 stays unchanged; this does not implement
Issue #17's future persistence work. Plugin state retains IDs, revisions and enabled flags;
existing validation blocks corrupt state and invalid packages. Trusted enabled packages keep
their prior activation preference.

Repeat launches keep the new profile and layout. Production/dev recovery occurs separately when
each origin is first opened. Original/backup bytes remain available even when Chromium cannot read
a corrupt database. A failed layout transfer warns; do not save a replacement before recovering
the desired draft. Missing old drafts use the normal default. There is no automatic plugin merge.

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
  preview, inspect it and explicitly Save. Import keeps the current theme; choose it separately.
- **Corrupt new layout/state:** preserve raw bytes and use the backed-up/fresh-profile procedure.
  Do not delete state.json to unblock management or silently enable packages. Reinstall invalid
  packages only from reviewed original sources.
- **Corrupt derived recovery session:** after full backups and closing all apps, rename
  `identity-recovery-v1` to a unique backup name. Next launch reconstructs it from unchanged
  `identity-backup-v1`. If that backup is corrupt, retain it and recover a valid JSON export or
  known-good whole-profile backup; no byte-level database repair is promised.

## Validation and remaining acceptance

`pnpm check` covers profile/negative/security tests, full TypeScript, lint, examples and bundling.
`pnpm test:desktop` seeds a real legacy Chromium profile and checks layout/theme transfer,
installed/enabled plugin continuity, restart/idempotence, original/backup bytes, existing/corrupt
destination preservation and the new identity/bridge. Then it runs existing plugin/foundation
smoke. `pnpm test:desktop:dev` repeats both layers on loopback. Only generated temp roots are deleted.

Owner acceptance stays in #6, #21 and #1. With backups and the old app closed, verify title/header,
the desired saved layout/theme on each origin used, installed packages and enabled flags after
restart. Check drag/resize, keyboard/focus and both themes at normal Windows DPI. Automated smoke
does not replace owner acceptance or authorize Issue closure.
