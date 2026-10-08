# Local Windows development

## Requirements and installation

Use Node.js 24.x, pnpm 11.25.0 and Git. GitHub CLI is required only to apply GitHub metadata. No Python, Docker, Rust, Visual Studio native build tools or paid model API is needed by the intended foundation. This dependency set has no node-pty/sqlite/native-plugin addon.

From the extracted repository root, in PowerShell:

```powershell
node --version
npm install --global pnpm@11.25.0
node --experimental-strip-types tools/doctor.ts
pnpm install
pnpm run doctor
pnpm check
pnpm test:desktop
pnpm dev
```

The global pnpm installation is an explicit owner step, not performed by project scripts. The project doctor reports a missing dependency directory/lockfile before the first installation; install, then rerun it with `pnpm run doctor`. Explicit `run` avoids selecting pnpm's native doctor command. Before installation, invoke the script directly with Node because pnpm 11 verifies dependencies before scripts and can install automatically. Do not use administrator privileges merely to suppress project errors. Use a user-managed Node installation where appropriate.

`pnpm install` downloads packages; Electron 44.6.0 downloads its binary when first used. Extracting the source ZIP alone is not a completely offline installation. After dependency and binary setup, the prototype does not need a service/API connection. `pnpm-workspace.yaml` permits install scripts only for the reviewed esbuild versions 0.25.12 and 0.28.2. Electron 44.6.0 has no lifecycle install script to approve. Strict engine/peer/build policies and exact dependency saving are configured in this YAML file because pnpm 11 no longer reads non-authentication settings from `.npmrc`.

## Dependency and validation disclosure

The source archive intentionally has no fabricated lockfile or bundled `node_modules`. The source-generation environment could not resolve npm hosts, so the declared dependency graph, TS6 full semantic check, bundling and desktop behavior were not observed there. Package pins start from the owner's earlier toolchain, with Electron 44.6.0 and Motion 14.0.0 checked against primary release/source information. They are candidate pins, not a claim that a registry-resolved graph passed every peer rule.

The first real `pnpm install` generates `pnpm-lock.yaml`. Inspect and commit the real lockfile as part of the still-unaccepted `0.1.0-alpha.1` baseline. All subsequent installs/CI use `pnpm install --frozen-lockfile`. Do not replace the missing file with hand-written integrity values, `latest`, or a guessed lock.

If install/typecheck/build finds a dependency mismatch, repair the smallest incompatible pin/import in the same foundation validation Issue and rerun the full gate. Do not weaken strict peer, type or security checks to force success. Record the actual installed/runtime versions and command output; do not claim the ZIP's source checks proved the Electron runtime.

## Commands

| Command | Effect |
| --- | --- |
| `pnpm dev` | Local Vite HMR + Electron window; development data origin |
| `pnpm build` | Compile the source to `out/`; no installer or publication |
| `pnpm start` | Preview built code through the local production protocol |
| `pnpm run doctor` | Run the project prerequisite checks; use direct Node before installation |
| `pnpm check:repo` | Materialized structure, configuration and local-link checks |
| `pnpm test` | Dependency-free TS core/control tests using Node |
| `pnpm typecheck` / `pnpm lint` | Full configured toolchain checks after installation |
| `pnpm check` | Structure + types + lint + tests + build |
| `pnpm test:desktop` | Built Electron smoke in a disposable profile |

## Data and another machine

The prototype stores a small layout/theme snapshot in renderer localStorage and trusted plugin
copies/preferences under application userData. Development and built-preview origins can have
independent layout drafts; plugin installation preferences share the same desktop profile.
Issue #6's bounded migration is documented in [identity recovery](renaming.md); close the prior
app and keep both profiles backed up. Other profile moves require explicit recovery. There is no automatic updater,
native credential store or application login. `pnpm plugins:build` generates independent sample
packages under `.local/plugin-packages`; install those through Settings, never by changing core imports.

Keep diagnostics, temporary configuration and local artifacts under ignored `.local/` only when needed. Never commit machine-specific absolute paths, tokens, raw personal documents or production data. No tracked checkpoint/last-report is required.

## First Codex session

Read [FIRST_LOCAL_RUN](../.ai/prompts/FIRST_LOCAL_RUN.md) after binding the real repository/Issue. The root `AGENTS.md`, `.codex/` and `.agents/skills/` are the selected harness. Verify client trust and effective settings locally; a TOML file in the ZIP cannot activate a model/permission profile remotely. If package installation requires network escalation, request that limited operation rather than full-access mode.
