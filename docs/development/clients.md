# Project-local client discovery

Claude Code can import the general rules through the root CLAUDE.md. Project skills live under `.claude/skills/<name>/SKILL.md` and the independent security reviewer under `.claude/agents/security-reviewer.md`. Keep these procedures on demand. Claude Code is the only configured client; the adapter defines neither product behavior nor task authority, and AGENTS.md stays client-neutral.

On first use in Claude Code, inspect loaded instructions and skills in a fresh session. Select a small read-only task, then check that the reviewer can inspect the designated source and cannot invoke shell, write, network or delegation tools. Use disposable non-secret fixtures for denied-access checks. Verify effective permissions and OS sandboxing separately, particularly on native Windows. Keep credentials outside readable scope. Record actual client version, discovery, denials and any unavailable isolation in the Issue.

Project settings request file-tool read restrictions for external working paths, Git internals, `.local/private/`, environment files and key material. The rest of `.local/` holds development builds, packages and diagnostics and stays readable. Supply sanitized evidence directly to the reviewer. Verify these rules with the installed version before relying on them. Personal approval preferences belong in the untracked `.claude/settings.local.json`; the shared settings keep only restrictions.

[Instruction imports](https://code.claude.com/docs/en/memory) · [Project skills](https://code.claude.com/docs/en/skills) · [Subagent tool limits](https://code.claude.com/docs/en/sub-agents) · [File permission rules](https://code.claude.com/docs/en/permissions)
