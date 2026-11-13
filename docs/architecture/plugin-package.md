# First-party signed package pilot — envelope 1

Issue #43 / alpha.34 adds local file installation only for `geppio.workspace-essentials`.
Manifest schema 1 and APIs 1/2 retain their existing meanings. No library, archive extractor,
marketplace, third-party execution, native capability, general update or author SDK is added.
Signing authenticates publisher/content; it does not isolate shared-origin trusted Workers.

## Wire format and validation

The `.gpp` file is uncompressed and at most **3 MiB**. All integers are unsigned big-endian.
No trailing bytes or alternative signature algorithms are allowed.

| Offset | Contents |
| --- | --- |
| 0–7 | ASCII `GEPPIOPK` |
| 8–11 | Envelope version, exactly `1` |
| 12–15 | Metadata byte length, 1–1,024 |
| 16–19 | Payload byte length |
| 20 onward | Metadata UTF-8 JSON, then payload UTF-8 JSON |
| Final 64 bytes | Raw Ed25519 signature |

The signed sequence is the ASCII domain `GeppIO signed plugin package\0Ed25519\0v1\0`
(each `\0` is one NUL byte), followed by **every file byte preceding the signature**.
Thus magic, envelope version, lengths, metadata, entry paths/types and every payload byte,
including the exact `plugin.json`, are authenticated together. The parser bounds and validates
framing/metadata first, verifies the raw signed sequence, and only then parses payload entries.

Metadata has exactly `{keyId, pluginId}`. `keyId` is lowercase SHA-256 hex of the public key's
SPKI DER representation. `pluginId` must equal `geppio.workspace-essentials`. Neither an embedded
key nor a publisher/name in untrusted input establishes trust. Publisher display text comes from
the trusted entry. Unknown, revoked or differently scoped roots fail closed.

Payload is an array of exactly shaped `{path, type:"file", content}` entries; `content` is canonical
padded base64. The packager emits entries sorted by relative path using ASCII comparison and compact
JSON in the property orders shown above, with no timestamp. Identical built bytes/key produce
identical output. UTF-8 decoding is fatal. Signature verification does not waive validation:

- Existing limits: 512 KiB/file, 2 MiB decoded total, 16 KiB manifest, 64 files plus implicit
  directories, and at most nine path components. Only `.js` and `.json` files are accepted.
- Only regular files are represented. Directories are implicit; symlinks, devices, archive entry
  attributes and executable metadata have no representation. Other entry types are rejected.
- Existing bounded path rules reject absolute/traversal/empty components, backslashes, ADS,
  reserved Windows names and trailing dots. Case-folded aliases (also directories), duplicate
  entries and file/directory prefix conflicts are rejected on every platform.
- The manifest and declared `.js` entry must both exist, pass the existing parser and match the
  key's plugin scope. Manifest schema 1/API 1 or 2 remain compatible.

## Production trust and owner custody

`src/main/plugin-trust.ts` is the only production trust source. On 2026-11-13 the owner explicitly
authorized the Ed25519 public key below for `geppio.workspace-essentials`. Its SPKI DER fingerprint
was independently recomputed and its public bytes compared with the owner's external public file.
The trusted publisher label is `GeppIO (rabrunos)`.

```text
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAbEH4B4TkgXmPHnZtCFSvtIZUr8wERHciEKOnaxaGdBY=
-----END PUBLIC KEY-----
SHA-256 (SPKI DER): afce9e671489882fa41e1dbed7b1c7280b96d06fbe1f6635f3c62c4ceff7bb04
```

A root records its fingerprint, exact plugin scope, trusted publisher
label, SPKI PEM public key and revocation flag. A revoked entry is not accepted. Key rotation and
key-management UX are separate work. Never infer authorization from an Issue attachment or package.

The following owner-run PowerShell command generates a new Ed25519 key **outside the checkout**.
The current owner key has already been generated; do not regenerate it to package this pilot.
The parent must already exist and be owner-controlled; the new directory must not exist.
Private material is written only there, with restrictive modes where supported. On Windows,
custody depends on the parent directory's owner-only ACL; verify that ACL before generation.

```powershell
pnpm.cmd plugins:key "$env:USERPROFILE\GeppIO-signing"
```

Only the public PEM and SHA-256 fingerprint are printed. Independently compare the public file's
fingerprint with this output through an owner-controlled channel, then share **only** the public
key/fingerprint and explicit authorization for this plugin scope. Keep the private PEM outside
the checkout, app, CI, logs, chat and Issue. No automatic key creation, upload or root activation
occurs. The tools derive the actual checkout boundary from their source location, regardless of cwd.

Offline packaging uses the existing independently compiled plugin:

```powershell
pnpm.cmd plugins:build
pnpm.cmd plugins:package .local/plugin-packages/workspace-essentials .local/workspace-essentials-1.0.0.gpp --key-file "$env:USERPROFILE\GeppIO-signing\workspace-essentials-private.pem"
```

The private key is accepted from a bounded regular external file, never a command-line key value or
environment variable. Output uses exclusive creation; choose a new output path to repeat. The tool
self-verifies its output but cannot authorize its own key for the application. A generated key
remains untrusted until independent owner authorization and a reviewed production-root change.

## Confirmation, commit and recovery

The fixed argument-free `plugins.installFile()` action opens a native Main-owned picker. Main
opens a regular file, bounds its size and reads at most that size plus one byte from one handle.
The verified buffer and parsed file map stay within the serialized operation; replacing the input
path during confirmation cannot replace the confirmed contents. Native confirmation shows the
trusted publisher, manifest name/ID/version, fresh install versus adoption and no new access.
Window/frame/document-generation checks expire confirmation on navigation/teardown. Cancellation
or denial does not write an installation. Folder install remains explicit trusted development.

Fresh install gets a new installation UUID, is disabled and places no widgets. Adoption requires
a valid actual legacy folder with the exact complete relative file set and bytes, inspected again
after confirmation and before commit. Same-ID signed/replacement conflicts or changed folder/state
bytes fail without replacing valid state. The existing UUID, enabled preference and all data paths,
widget/layout/model IDs, placements and historical recovery references remain unchanged. No host
layout/composition file or confirmed plugin data is rewritten by installation.

The signed envelope is staged with `wx`, renamed to `plugins/signed/<snapshot UUID>.gpp`, then
`plugins/state.json` is atomically replaced through its existing serialized store. Each signed
preference adds `signed:{snapshot,sha256}` beside existing `enabled` and installation `revision`.
The SHA-256 digest pins the entire confirmed envelope, including its signature; another validly
signed version cannot silently replace it. Both pointer fields are mandatory and exactly validated.
That state rename is the switch. The old folder remains a recovery source and is never served
when a signed reference exists. A precommit exception cleans up the new snapshot; process exit
before the switch leaves the legacy installation usable (an unreferenced snapshot/temp file may
remain). Exit after the switch leaves the complete signed snapshot referenced. This is atomic
application replacement, not an fsync/power-loss durability guarantee or defense against hostile
same-user filesystem races. No package code runs in Main/preload.
The digest does not protect against malicious same-user rewriting of both state and artifact.

Every inventory/startup rereads the persisted signed envelope, compares its pinned digest and
checks the current trusted-key scope before making its inspected JS snapshot available to the first asset request. Missing,
tampered, substituted (even validly signed), invalid or revoked artifacts become recoverable inventory errors, cannot enable/open
data channels or serve code, and never fall back to retained legacy files. Existing immutable
in-memory snapshots are not live disk monitoring. Close the app and back up the whole disposable
or owner profile before manual recovery; restore the known-good signed artifact for its exact
referenced UUID under a currently authorized key. Do not remove `signed` to bypass verification.

Removal commits preference removal before best-effort cleanup of signed/legacy code. Confirmed
data retains its original UUID for manual recovery; a reinstall receives a new UUID and cannot
read it. Cleanup failure or crash can leave orphan code files, which are never discovered as
installations. Worker disposal and installation-bound API 2 data channels retain existing rules.

## Evidence and manual Windows walkthrough

`pnpm test:plugin-package` builds production, exercises independently built payloads and the local
signing command, and runs focused unit/process-interruption and Electron tests. Temporary private
test keys exist only in test memory or disposable external CLI fixtures; production contains no
test root or environment/profile override. The smoke first proves the real production build
rejects the test package, then builds a separate ignored host with only its temporary public root.
It controls native dialog responses through Playwright; this is automated Windows evidence, not
an owner clicking the native dialogs. To exercise an existing owner-signed package against the
normal production build (without trust injection), run after `pnpm build` and `pnpm plugins:build`:

```powershell
node --experimental-strip-types tools/plugin-package-smoke.ts --official-package .local/workspace-essentials-1.0.0.gpp
```

The harness first checks rejection of a disposable key, then performs the same fresh/adoption/
restart scenarios using the official file and pinned production root. It never needs the private
key; CI runs the default temporary-root scenarios without the owner's private material. The exercised access
path is the existing installation-bound API 2 ordinary-data broker: allowed read/write, wrong
owner/installation denial, and revocation on disable/teardown/reload. No filesystem grant is tested.

After production rebuild and local packaging, create a disposable profile from PowerShell:

```powershell
$env:GEPPIO_TEST_USER_DATA = Join-Path $env:TEMP ("geppio-smoke-owner-package-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $env:GEPPIO_TEST_USER_DATA | Out-Null
pnpm.cmd start
```

Keep that terminal/profile path for restart. This restricted profile override is unpackaged only.

1. Click the profile menu → **Abrir configurações** → **Desenvolvimento e recuperação** →
   **Plugins** → **Instalar arquivo assinado**. Select the `.gpp` file. Verify publisher,
   Workspace Essentials/version, **Nova instalação** and no new access; cancel once and confirm
   inventory stays unchanged. Repeat and click **Instalar desativado**.
2. Click **Ativar**, close Settings, click **Editar layout**. Select **Anotações**, **Rascunho**,
   **Checklist** and **Prompts salvos** in the catalog, choosing **Principal** for each. Click
   **Concluir**. Create a note, edit scratch, add/check an item and create/copy a prompt. Wait
   for **Salvo.** before closing. Start again from the same terminal and verify all four, text,
   selection, checkbox and placements. Clipboard denial retains the manual-copy fallback.
3. For adoption, use another disposable profile. Install the exact built folder via **Instalar
   pasta local**, activate, place/edit/save the four widgets, then select its signed equivalent
   through **Instalar arquivo assinado**. Verify **Adotar instalação existente** and confirm.
   Existing widgets and data should remain in place. Restart and verify them again. Repeat
   in another disposable profile with the folder plugin **Desativado** before adoption; it
   must stay disabled until explicit activation, then restore the same data/placements.
4. Close the app before ending the disposable session and run
   `Remove-Item Env:GEPPIO_TEST_USER_DATA`. Keep any profile needed as acceptance evidence;
   do not delete or modify the owner's ordinary profile.

Production must reject files signed by any unpinned test/unknown/revoked key. Automated evidence,
including the owner-signed production smoke, does not substitute for owner mouse acceptance.

## Developer Mode compatibility (alpha.35)

Signed-file installation remains available with Developer Mode off. Only legacy managed copies can
be adopted; already linked/external registrations are same-ID conflicts even when bytes match.
The publisher key scope, wire verification, native confirmation and startup verification are unchanged.
Legacy test profiles are seeded in the actual alpha.34 managed-copy format; development folder
loading now registers an original source and cannot stand in for the signed-adoption fixture.
