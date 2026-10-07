# Requested and effective executor settings

Only Codex is enabled. `.codex/config.toml` carries project-scoped defaults: Main High, on-request
automatic approval review, workspace-write, sandbox network enabled, and at most two simultaneous
subagents. The normalized profile names this combination `protected_auto`. Network access does not
expand writable roots, grant new task authority, or bypass automatic-review denials.
`scout` is Medium/read-only; `worker` is Low/bounded workspace execution. Each file inherits the
signed-in client's available model rather than embedding an unverified model or API key.
This does not guarantee lower-cost models: only the requested effort differs.

Verify that the installed Codex loads the project config and standalone `.codex/agents/*.toml` files.
A trusted workspace/config consent may be necessary. Verify effective sandbox/network/approval/effort
in the actual client. Valid TOML proves syntax, not enforcement. Do not edit the user's global config
or enable full access automatically. If an installed client cannot honor a setting, report the exact
blocker and use an explicitly approved compatible setting, never an invented option.
The active client can retain a different network restriction until it reloads the project defaults;
report that discrepancy and request only the necessary technical exception instead of claiming the
TOML changed enforcement. Keep `on-request`, never Full Access/`never`, for this workflow.

Main is one role at Medium/High/XHigh as eligible in TASK_POLICY. `standard` / `economy` are
consumption policies, not model effort levels. Task/local/project/default precedence is evaluated
by the executor; no additional BootCrate app is required to select it.

Sources verified 2026-10-07: [configuration reference](https://developers.openai.com/codex/config-reference)
and [custom subagents](https://developers.openai.com/codex/subagents). The project files request these
settings; actual Windows-client recognition remains a first-run verification step.
