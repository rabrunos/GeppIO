# [0.1.0-alpha.1] Validate the new local foundation

The owner extracted the already materialized semnome source package. Do not restart intake, import the
old application or install the BootCrate app. The current repository has no real plugins and no login.

Read PROJECT_GUIDE.md, AGENTS.md and docs/development/testing.md. Verify the actual directory, Git
branch/HEAD/status/diff and package version. Do not create a remote repository or guess its name.
If an origin and relevant live Issue exist, use the foundation marker described in docs/development/github.md.
If metadata setup is missing, show the github:prepare dry-run; request authorization before --apply.
If the repository/Issue does not exist yet, report the pre-repository setup boundary. Read-only doctor,
installation authorized by the owner and local checks can proceed; new feature work waits for a real Issue.

Goal: resolve dependencies on the owner's Windows machine, generate the real lockfile, validate the
source foundation and produce the evidence needed to accept it. This continues the same unaccepted
0.1.0-alpha.1 target. Missing registry access in the source-generation environment was reported, not waived.

Run pnpm doctor. Verify Node 24.x and pnpm 11.25.0. With approval for the network operation, run pnpm install.
Inspect the resulting pnpm-lock.yaml and native install scripts. Keep explicit top-level versions unless a
real resolver error requires a narrow compatibility repair; explain it and keep the active target.
Run pnpm check, pnpm test:desktop, then open pnpm dev for the necessary owner visual smoke. Verify the
actual Codex config/roles/effort/sandbox in the installed client; do not infer enforcement from TOML parsing.

Only repair blockers in this foundation after the Issue is available and the owner authorizes tracked edits.
Do not add plugins, terminal, SQLite, a vault, backend or new design requirements. Do not alter the owner's
other repositories, global credentials or editor settings. Do not commit, push, close an Issue or publish
unless separately requested. Return observed results, exact failures and the remaining owner smoke in pt-BR.
