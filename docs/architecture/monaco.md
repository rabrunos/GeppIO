# Monaco dependency and asset boundary — alpha.42 / Issue #49

The owner individually approved Microsoft Monaco and specifically authorized the exact official
`monaco-editor@0.57.0` package despite the documented DOMPurify advisories:
[risk acceptance](https://github.com/rabrunos/GeppIO/issues/49#issuecomment-6886134045).
This exception is limited to the locally tested, non-distributed prototype. It does not establish
that the vulnerabilities are harmless or unreachable, or waive unrelated new findings.

The official 0.57.0 tarball and lockfile integrity are
`sha512-5BkI9KGoqrNvBGUe15/QlZq3OooZ8WLg1AxTpaqHRCP3HNpzPPZKE2EDz8M7c+VRmCeUw1Brp4cx/PWm3kI/5A==`.
Its ESM bundle includes DOMPurify 3.4.15; separate production dependencies are DOMPurify 3.4.15
and marked 14.0.0, with optional @types/trusted-types 2.0.7. A transitive override does not repair
the bundled sanitizer. No vendor edits, postinstall patch, wrapper or copied VS Code source is used.

Known accepted advisories, checked against the official npm advisory endpoint and GitHub database:

| Advisory | Severity | DOMPurify patched version |
| --- | --- | --- |
| [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p) | low | 3.4.16 |
| [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2) | low | 3.4.16 |
| [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) | critical | 3.4.17 |
| [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr) | high | 3.4.17 |
| [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f) | low | 3.4.17 |

These advisories depend on specific sanitizer configurations/inputs (IN_PLACE and removal hooks,
template/shadow-root evaluation, or XHTML/SMIL). No comprehensive GeppIO exploitability exemption
is claimed. Production audit results must remain visible and distinguished from passed app tests.
The upstream [report](https://github.com/microsoft/monaco-editor/issues/5517) and a future changelog
entry do not prove that a fixed stable npm release exists.

## Assets and runtime

The existing Vite 7.3.6 / Electron 44.6.0 build bundles editor, JSON, TypeScript/JavaScript,
HTML and CSS Workers using public ESM entrypoints and Vite `?worker` imports (ES module output).
All production Worker/script/font assets use the bounded `geppio://app/assets/` protocol.
The only protocol MIME addition is `.ttf: font/ttf` for the bundled codicon font.
Production keeps script-src/worker-src 'self', font-src 'self', connect-src 'none' and the remote
request block. Development uses the existing exact loopback Vite origin. There is no remote
grammar download, eval allowance, blob script allowance or plugin Worker/native grant.
Monaco's included TypeScript services operate on bounded local models, not a full project IDE.
Alpha.46 retains one model per open native grant (up to eight), with one shared editor and
per-model undo/view/language ownership. Exact source and retained history budgets, corrective
refusal handling and disposal are described in [document ownership](documents.md).

The complete upstream MIT license and ThirdPartyNotices are retained in
[legal notices](../legal/monaco-LICENSE.txt) and [third-party notices](../legal/monaco-ThirdPartyNotices.txt).
Bundling can strip upstream source comments; do not rely on an emitted license header.
DOMPurify's full dual-license text is retained [separately](../legal/dompurify-LICENSE.txt), together with
[its MPL license](../legal/dompurify-LICENSE-MPL.txt),
[marked](../legal/marked-LICENSE.txt) and [optional types](../legal/trusted-types-LICENSE.txt).
Future distribution must preserve all applicable notices and reassess this prototype-only exception.

## Update procedure

A fixed stable release (such as 0.57.1 if actually published) requires a separate scoped target.
Verify official npm metadata, exact tarball/hash, bundled sanitizer, production graph/advisories,
licenses and upstream behavior changes before changing the exact pin/lockfile. Run the Windows
Monaco production/development/DPR, document EOL/BOM/save/conflict, Explorer/Status Bar and affected
workbench regressions. Review Worker/CSP assets and notices again. Do not auto-upgrade, patch a
vendor file, or claim a package override replaces bundled source.
