# Renaming the provisional identity

The only provisional product word is `semnome`. Choose a final name in a separate scoped Issue. The upstream BootCrate name appears only as method/source attribution, not product identity.

## Identity surfaces

| Surface | Location / implication |
| --- | --- |
| Package/product name | `package.json` name/description; canonical version remains unchanged unless the new task assigns a target |
| Runtime title, custom protocol, local layout key | `src/shared/identity.ts` |
| Typed static renderer bridge | `src/preload/index.ts`, `src/renderer/env.d.ts`, renderer/smoke usages |
| Temp test profile/environment override | `src/main/index.ts`, `tools/desktop-smoke.ts`, tests |
| Stable product profile and owner-facing documentation | `docs/.ai/project-profile.json`, README, guides and headings |
| UI text, CSS labels and tests | Search source/tests for `semnome`/`SEMNOME` |
| Actual remote | Owner-controlled GitHub identity and local Git origin; not inferred from package name |

No installer appId, update channel, publisher account or signing identity has been chosen yet. Add them only when distribution is in scope, not as fake placeholders now.

## Procedure

Inspect actual Git state and all old-name occurrences. Classify runtime contract vs display-only text before editing. Update imports/types/tests together, generate a real updated lockfile after changing package identity, validate the new custom scheme/asset paths and perform desktop smoke. Keep historical changelog/version evidence truthful.

Changing the Electron app name, custom origin or storage key can make existing layouts appear missing. Before a rename with real user data, add an explicit tested migration or backup/import strategy. Do not blindly find-and-replace names in persisted data or promise automatic recovery. This first source foundation has no shipped installer compatibility contract, but local user experiments can still matter.
