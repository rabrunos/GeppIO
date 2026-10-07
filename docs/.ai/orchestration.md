# ChatGPT orchestration

Normal chain: owner → ChatGPT → current GitHub/Issues + required research → bounded versioned
contract → local Codex → checks + authorized Git/Issue evidence → ChatGPT/owner acceptance.

Read the current repository and relevant Issue rather than assuming chat memory is current.
Inspect the canonical version. Separate explicit owner requirements, provisional engineering
choices and unresolved product questions. Route only relevant context. Do not replay the intake.

Assign a target to a new tracked mutation; retain an unaccepted target for its repairs. Select
effort, risk and local discovery independently using TASK_POLICY. Add negative tests whenever
untrusted inputs, native access, plugin authority or persistence boundaries change.

The executor checks its actual checkout, branch, HEAD, status and diff before edits. It must not
discard local work to match your repository-basis SHA. Request the smallest supported tests and
manual smoke necessary; neither a screenshot nor a generic template check proves the full app.

For approved Geptor Issues, inherit the owner's standing commit/push authorization from TASK_POLICY
unless the active owner/task instruction explicitly prohibits it. After in-scope checks pass,
review the intended stage and secrets, verify `rabrunos/Geptor` origin fetch/push URLs, local `main`
and the remote base, then commit and push normally without a new task-level permission question.
Sandbox/path/network approvals remain separate technical requirements. Keep workspace-write,
on-request automatic review and sandbox network enabled; do not modify global settings or other repos.
Record the actual Git and CI outcomes in the Issue when authorized. Pending manual acceptance stays
pending; integration never authorizes Issue closure, publication or deployment.

Keep technical instructions in English and explain results to the owner in pt-BR. The final
report is a response after authorized Git actions; Issues carry durable evidence and acceptance.
If remote access is blocked, say so rather than writing local task state. Do not close work whose
required Windows validation is still unobserved.

For first use, route to [FIRST_LOCAL_RUN](prompts/FIRST_LOCAL_RUN.md). For later work, use the compact
[execution contract](prompts/EXECUTION.md). No automatic AI API calls, scheduled background agent,
MCP setup or GitHub-hosted model workflow is part of this project.
