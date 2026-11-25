# Requested and effective executor settings

Only Codex is enabled. `.codex/config.toml` carries project-scoped defaults: Main High, on-request
automatic approval review, workspace-write, sandbox network enabled, and at most two simultaneous
subagents. The normalized profile names this combination `protected_auto`. Network access does not
expand writable roots, grant new task authority, or bypass automatic-review denials.
Choose an auxiliary role for a specific question. `code-scout` traces source ownership,
`boundary-reviewer` reviews authority or lifecycle changes, `ui-reviewer` examines specified
interactions, and `validation-runner` executes the assigned checks. Review roles have a
behavioral read-only assignment. Each role inherits the parent permission boundary.
Select effort for the task and prefer Astra 6.2 where available. Role definitions omit model
and effort overrides. Serialize shared source edits, clipboard, desktop and native dialogs.

Verify that the installed Codex loads the project config and standalone `.codex/agents/*.toml` files.
A trusted workspace/config consent may be necessary. Verify effective sandbox/network/approval/effort
in the actual client. Valid TOML proves syntax, not enforcement. Do not edit the user's global config
or enable full access automatically. If an installed client cannot honor a setting, report the exact
blocker and use an explicitly approved compatible setting, never an invented option.
The active client can retain a different network restriction until it reloads the project defaults;
report that discrepancy and request only the necessary technical exception instead of claiming the
TOML changed enforcement. Keep `on-request`, never Full Access/`never`, for this workflow.

| Project workflow | Use for |
| --- | --- |
| [geppio-docs](../../.agents/skills/geppio-docs/SKILL.md) | Guidance, references and consumers |
| [geppio-modules](../../.agents/skills/geppio-modules/SKILL.md) | Packages, ports, capability selection and standalone |
| [geppio-editor](../../.agents/skills/geppio-editor/SKILL.md) | Monaco, draft fidelity and presentation lifetime |
| [geppio-ui](../../.agents/skills/geppio-ui/SKILL.md) | Styling, gestures, focus and accessibility |
| [geppio-plugins](../../.agents/skills/geppio-plugins/SKILL.md) | Author contracts, isolation, packages and reload |
| [geppio-verify](../../.agents/skills/geppio-verify/SKILL.md) | Scoped validation and acceptance evidence |

In a fresh trusted project session, inspect the exposed skills and role inventory. Exercise
a bounded role if dispatch is available. Record the observed discovery and behavior in the
active Issue separately from syntax, source checks and unobserved client settings.

Sources verified 2026-10-07: [configuration reference](https://developers.openai.com/codex/config-reference)
and [custom subagents](https://developers.openai.com/codex/subagents). The project files request these
settings; actual Windows-client recognition remains a first-run verification step.
