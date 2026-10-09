# ChatGPT orchestration

Normal chain: owner → ChatGPT → current GitHub/Issues + required research → bounded versioned
contract → local Codex → checks + authorized Git/Issue evidence → ChatGPT/owner acceptance.

Read the current repository and relevant Issue rather than assuming chat memory is current.
Inspect the canonical version. Separate explicit owner requirements, provisional engineering
choices and unresolved product questions. Route only relevant context. Do not replay the intake.

## Implementation handoff sequence

1. Retrieve current PROJECT_GUIDE.md, the relevant Issue, package.json and repository-basis SHA;
   use [CONTEXT_INDEX](CONTEXT_INDEX.md) for targeted context and [TASK_POLICY](TASK_POLICY.md)
   for version, execution settings and authority. Chat memory and a remote SHA are not local preflight.
2. Confirm the owner's intent from the active request. Approval to implement triggers this sequence
   without a reminder to follow the method. A discussion-only or record-only request stops at that
   scope: recording an Issue does not authorize implementation or an executor launch.
3. Select and **load the applicable template before preparing the handoff**. Use
   [EXECUTION](prompts/EXECUTION.md) for ordinary implementation. [FIRST_LOCAL_RUN](prompts/FIRST_LOCAL_RUN.md)
   is historical foundation context, applicable only to an explicitly requested foundation continuation;
   it is not a reason to restart intake or setup for a materialized project.
4. Populate the template with task-specific facts, actions, acceptance, validation and authority.
   Use one independently identifiable root contract per Target Version, with the exact version in
   its H1 and its Issue/basis. Separate independent versions into distinct contracts and state their
   order/dependencies; repairs keep their unaccepted target. Do not blend versions into one root.
5. Perform the template's pre-delivery completeness review. Keep detail proportional to the task:
   a narrow documentation change needs less detail than a trust-boundary change. Inherit canonical
   policies by repository path instead of copying the policy library. Missing required evidence or
   unresolved blocking scope is reported explicitly, not filled with guesses.
6. If an authorized direct executor call is available, send the complete contract to it. Otherwise,
   **automatically deliver the full copy-ready contract to the owner in a single fenced text block
   per root contract**. Do not merely offer to generate it later. An Issue link, recorded task,
   summary or abbreviated instructions cannot substitute for the executor handoff.

Repository guidance and ChatGPT website Project Instructions are separate surfaces. Editing these
files specifies the repository method; it does not change site settings or prove model compliance.

## Fresh-conversation acceptance scenario (specification)

This is a behavioral acceptance specification, not a genuinely executed model-behavior test.
Record any actual run and its observed response separately in the active Issue.

| Owner action in a fresh project conversation | Expected assistant behavior |
| --- | --- |
| Resumes with “continue” | Retrieves current repository/Issue/version context; does not assume chat memory or approval to implement. |
| Approves “implement” without mentioning the method | Loads the applicable current template, fills and reviews the contract, then invokes the authorized executor or automatically delivers the full copy-ready contract. An Issue alone is insufficient. |
| Requests discussion only or recording only | Keeps that scope; does not launch implementation. |
| Approves two independent implementation versions | Produces two distinguishable root contracts, each with its own Target Version and Issue/basis, sequencing dependent work. |

Static document/schema checks establish consistency only. They do not execute this scenario,
prove real ChatGPT behavior, physical Windows UX or effective Codex model effort.

## Executor and integration boundaries

Assign a target to a new tracked mutation; retain an unaccepted target for its repairs. Select
effort, risk and local discovery independently using TASK_POLICY. Add negative tests whenever
untrusted inputs, native access, plugin authority or persistence boundaries change.

The executor checks its actual checkout, branch, HEAD, status and diff before edits. It must not
discard local work to match your repository-basis SHA. Request the smallest supported tests and
manual smoke necessary; neither a screenshot nor a generic template check proves the full app.

For approved GeppIO Issues, inherit the owner's standing commit/push authorization from TASK_POLICY
unless the active owner/task instruction explicitly prohibits it. After in-scope checks pass,
review the intended stage and secrets, verify `rabrunos/GeppIO` origin fetch/push URLs, local `main`
and the remote base plus stable GitHub repository ID `1409287329` (same repository authorized in Issue #22), then commit and push normally without a new task-level permission question.
Sandbox/path/network approvals remain separate technical requirements. Keep workspace-write,
on-request automatic review and sandbox network enabled; do not modify global settings or other repos.
Record the actual Git and CI outcomes in the Issue when authorized. Pending manual acceptance stays
pending; integration never authorizes Issue closure, publication or deployment.

Keep technical instructions in English and explain results to the owner in pt-BR. The final
report is a response after authorized Git actions; Issues carry durable evidence and acceptance.
If remote access is blocked, say so rather than writing local task state. Do not close work whose
required Windows validation is still unobserved.

No automatic AI API calls, scheduled background agent,
MCP setup or GitHub-hosted model workflow is part of this project.
