# Machine-local workspace

Track requirements, resolver rules and test procedures, never this machine's absolute paths.
Use ignored `.local/config/` for non-secret machine settings, `.local/diagnostics/` for requested
smoke evidence, and `.local/artifacts/` for local build exports. Do not create checkpoints,
work-state snapshots or last-report files there as a replacement for Issues.

Dependencies are node_modules and the real pnpm cache. Tools must fail with actionable messages
for absent Node/pnpm/Git rather than downloading or choosing a different environment silently.
An invalid explicit resource override must fail; do not search the entire disk for substitutes.
Tests use their own temporary directories. Do not delete owner drafts to simulate a fresh machine.

Credentials require an appropriate protected mechanism outside the agent workspace; `.local/`
is not a credential store. No .env is needed by this version. Diagnostics must not contain tokens,
private source from other projects or complete process environments. Commit only reusable conclusions.
