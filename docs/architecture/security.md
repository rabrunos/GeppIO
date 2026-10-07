# Security control map

This is a selected control map, not a security certification or a list of claimed test outcomes. Read the active Issue for executed evidence. The current product has trusted bundled fixtures, local layout input and a native window; it has no users/login service, remote embeds or untrusted plugin runtime.

| Exposure | Control / implementation | Check and limitation |
| --- | --- | --- |
| Renderer reaches native authority | `nodeIntegration: false`, `contextIsolation: true`, sandbox enabled; metadata-only preload | Source assertions in `tests/security.test.ts`; actual renderer absence of `require`/`process` in `pnpm test:desktop` |
| External page/new window/navigation | Reject window-open, navigation away and attached webviews; production web requests restricted; permissions and downloads denied | Source controls plus actual desktop smoke; a future remote surface requires separate tests |
| Production asset request | Fixed custom origin, GET only, allowlisted MIME and path containment in `src/main/security.ts`; CSP and nosniff | Parser/traversal negative tests; production startup smoke still required |
| Dev server selected by environment | Exact validated `127.0.0.1:5173` origin; no arbitrary host fallback | Unit tests; dev-only CSP has HMR allowances and is not production policy |
| Stored/imported layout | 64 KiB input bound, known schema/IDs, finite sizes, minimums and non-overlap | `tests/layout.test.ts`, invalid-storage preservation in `tests/storage.test.ts` |
| Local disk storage fails/corrupts | Error result and fallback copy; do not overwrite malformed state automatically | Storage tests; no guarantee against every OS/browser failure |
| Test suite touches owner data | Desktop smoke creates a temp `semnome-smoke-*` profile; Main rejects other override roots | Restricted launcher path logic and actual owner-safe smoke; only the created temp root is cleaned |
| GitHub setup alters wrong repository | Explicit validated OWNER/REPO + matching origin + remote identity verification; dry run default | `tests/github-plan.test.ts`; remote writes require explicit `--apply` and actual authenticated verification |
| Dependency / source secret leakage | Exact pins, approved install-script list, ignored credentials/local output; read-only CI secret scan | First install/lock review and CI scanner; ignore rules are not access control |

No script injection, safe-storage credential service, PTY, local file browser or unrestricted IPC handler exists. Future controls described in [Plugin boundaries](plugins.md) are requirements, not implemented protections.

## Production versus development

The production renderer is served from `semnome://app/`, not an arbitrary local file navigation. The renderer's `style-src` permits inline style attributes because continuous layout and animation require them; scripts remain bundled/local. Nothing parses user-supplied HTML. Future custom theme/HTML inputs must not assume this policy alone makes them safe.

Dev runs Vite on loopback with HMR, not on all network interfaces. Do not bind it publicly without a new exposure decision. Do not disable sandbox/CSP/web security to repair a failing test.

## Not production-ready

Packaging/signing, Electron fuses/ASAR integrity, update verification, native plugin isolation, security review of a real plugin bridge and distribution are out of scope. The current `start` command is a built source preview, not a signed installer. Before distributing executable builds, create the corresponding scope/authorization and tests; do not silently add publishing or credentials to CI.

## Primary references

- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Electron safeStorage limitations: https://www.electronjs.org/docs/latest/api/safe-storage
- Chrome content-script worlds: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- OWASP XSS prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

Recheck live documentation when changing these boundaries. A reference describes platform behavior; it does not prove this application exercised every condition correctly.
