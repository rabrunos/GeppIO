# Local development

## Existing checkout and supported environment

Use Node.js 24.x, pnpm 11.25.0 and Git. Windows is the first validated desktop target.
The owner direction includes Windows and Linux; Linux application validation and distribution
remain separate work. The Ubuntu secret-scan job does not exercise the Linux desktop app.
GitHub CLI is needed only for authorized GitHub operations, not for the local UI.
The current dependency set has no PTY, SQLite or native-plugin addon requirement.

The repository, Issues and real `pnpm-lock.yaml` already exist. On another machine, use the
existing checkout and locked graph; do not repeat intake, GitHub binding or foundation bootstrap.
From the repository root in PowerShell:

```powershell
node --version
npm install --global pnpm@11.25.0
node --experimental-strip-types tools/doctor.ts
pnpm install --frozen-lockfile
pnpm run doctor
pnpm check
pnpm test:desktop
pnpm dev
```

Skip the global installation when the selected pnpm version is already available. It is an
explicit owner/setup operation, not a project lifecycle script. Before installation, the doctor
may report missing dependencies; run it again afterward. Explicit `pnpm run doctor` avoids the
package manager's own doctor command. Direct Node invocation avoids pnpm's dependency preflight,
which may install before running scripts. On Windows, `pnpm.cmd` can avoid a blocked PowerShell
script shim without weakening ExecutionPolicy. Do not elevate merely to suppress a project error.

Installation needs registry access and the Electron binary download. The current Electron package
downloads its binary on first use. This is not an offline source bundle; after setup, the bounded
local app does not require service credentials. `pnpm-workspace.yaml` permits lifecycle builds only
for the reviewed esbuild versions and retains strict engine/peer/build policies and exact saving.
Do not regenerate the lockfile, weaken those controls or change dependency pins to make setup pass.
An actual mismatch needs a scoped task, observed evidence and the external-adoption gate where applicable.

## Commands and their scope

The canonical command definitions are in [package.json](../../package.json).

| Command | Effect and prerequisite |
| --- | --- |
| `node --experimental-strip-types tools/doctor.ts` | Read prerequisite availability before dependency setup |
| `pnpm run doctor` | Project doctor after setup; does not prove effective client/model settings |
| `pnpm install --frozen-lockfile` | Install the existing locked graph; network/native downloads may be needed |
| `pnpm dev` | Vite development renderer and Electron; separate development data origin |
| `pnpm build` | Compile Main/preload/renderer to `out/`; no installer or publication |
| `pnpm start` | Preview built code using the production protocol; prepare the matching build first |
| `pnpm check:repo` | Dependency-free structure, selected policy and local Markdown-link checks |
| `pnpm typecheck` / `pnpm lint` | Full configured semantic type/lint checks after dependency setup |
| `pnpm test` | Run all top-level TS core/control tests through Node type stripping; not a semantic typecheck |
| `pnpm plugins:build` | Compile independent trusted examples into ignored `.local/plugin-packages/` |
| `pnpm check` | Structure, types, lint, core tests, plugin examples and application build |
| `pnpm test:desktop` | Identity smoke, desktop smoke and the four built workbench smokes; prepare the build/examples first |
| `pnpm test:workbench` | Built workbench, organization, plugin and corrections smokes in disposable profiles |
| `pnpm test:desktop:dev` | Identity/desktop paths with built Main/preload and a Vite renderer; not the same chain as `test:workbench` |
| `pnpm github:prepare` | Historical metadata helper; no need to rerun it for a materialized project; `--apply` requires explicit metadata authority |

For read-only inspection or bounded documentation work, choose the checks required by the active
contract. Direct Node can run `tools/check-repo.ts` or relevant dependency-free policy tests without
installing the full graph. Do not run installation, build or desktop merely to fill a checklist.
For runtime changes use the relevant gates in [testing](testing.md) and the active Issue.
Never describe documented commands as executed until their actual result has been observed.

The VS Code tasks invoke Dev with `--watch`, preview, plugin build and check. Stop Dev/Start before
another command writes the same `out/`; each task permits one instance per workspace window.
The fixed loopback port can be occupied by an unrelated process. Diagnose ownership and obtain
appropriate authority rather than silently terminating it or changing shared configuration.

## Data and plugin boundaries

Production assets use `geppio://app/`; development uses the exact configured loopback Vite origin.
They can have independent renderer storage. The current workbench envelope is
`geppio:workbench:v1`; fractional v1, responsive grid v2, horizontal v1 and earlier freeform keys
remain preserved recovery sources. Explicit adoption writes the current envelope, not those originals.
A historical preview or JSON import is not permission to overwrite the original. Save editing
advances the Cancel checkpoint; Conclude
validates and confirms the slot-free document. Normal paired resize and organization operations
also have their own confirmed transactions. Viewport projection alone does not save geometry.

Undo/redo holds up to 256 whole intentions in the editing session, not a durable event history.
Theme, locale, snap and project display metadata retain separate preferences; there is no atomic
multi-key database. A displayed project name is not a native project path. The initial seven
bundled widget types are demonstrations, with four Main, two Sidebar and one Bottom placement.

Main stores managed trusted plugin copies and installation/enabled preferences under
`userData/plugins`. Install generated examples via the header Plugins manager or the Development
and recovery settings; do not add core imports. Manifest v1 contributions normalize to Main-only,
single-view cards. Moving/removing a presence does not dispose its Worker; disabling does, and an
existing placement can remain as a paused placeholder. Counter state resets on activation.
Layout persistence does not provide plugin-owned storage. API 2 Workspace Essentials uses a
separate installation-bound profile store; see [data retention/recovery](../architecture/plugin-data.md).
Build it with `pnpm plugins:build`, install `.local/plugin-packages/workspace-essentials`, enable,
then place each selected widget explicitly in Main or, for notes/checklist/prompts,
Sidebar or Bottom. Bottom provides compact reading/selection and checklist toggles;
create/edit text in Main or Sidebar. Existing installations need no reinstall.
Scratch stays Main-only. `pnpm test:essentials` and `pnpm test:sidebar` use disposable profiles.
The plugin SDK exposes no filesystem,
process, PTY, remote-network, secret or cross-plugin authority. Workers share origin/storage authority;
they are not an untrusted community sandbox. See [plugin boundaries](../architecture/plugins.md).

Issue #6's bounded migration copies eligible old profile data only when the new destination is
absent, preserves original/backup bytes and refuses to merge an existing destination. Close the
old app and follow [identity recovery](renaming.md); do not delete either profile. Windows defaults
are `%APPDATA%\semnome` and `%APPDATA%\geppio`. No automatic updater, credential vault, app account,
installer or synchronization service is configured.

Keep disposable diagnostics/configuration under ignored `.local/` when needed. Never commit
machine paths, credentials, personal files or production data. No tracked status/checkpoint/report
file is required; active evidence belongs in the GitHub Issue.

## Executor entry and historical provenance

Read [PROJECT_GUIDE](../../PROJECT_GUIDE.md), [AGENTS](../../AGENTS.md), the active Issue and
[TASK_POLICY](../.ai/TASK_POLICY.md). Approved implementation uses the populated
[EXECUTION](../.ai/prompts/EXECUTION.md) contract. Verify actual branch/HEAD/status/diff and preserve
unrelated work. A remote SHA is not a substitute for inspecting the checkout.
Project TOML expresses requested settings; verify effective trust, effort, sandbox, reviewer and
network settings in the running client. Any technical elevation remains bounded by its authority;
do not switch to Full Access or edit global settings as a workaround.

[FIRST_LOCAL_RUN](../.ai/prompts/FIRST_LOCAL_RUN.md) is historical foundation context, applicable
only to an explicitly requested continuation of that foundation. It is not the default route for
a new conversation or another machine. BootCrate intake/materialization are complete.

The initial pre-repository ZIP had no resolved lockfile or bundled dependencies because its
generation environment could not access npm. The real graph and desktop were subsequently
validated and integrated under Issue #1. Those old limitations describe that handoff only, not
the current checkout or a requirement to recreate its first commit. Source/build history remains
in [CHANGELOG](../../CHANGELOG.md); actual task and acceptance evidence remains in Issues.
