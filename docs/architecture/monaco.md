# Monaco dependency and asset boundary

The [GeppIO Editor workspace](../../src/geppio-editor/README.md) owns the engine integration, common construction options, local Worker factory and read-only comparison. Application sessions use its public exports to attach presentations and reconcile acknowledged revisions, history budgets, view state and exact draft edits. Multiple editor surfaces in one page share the same Worker configuration through explicit leases.

`pnpm libraries:pack` emits local tarballs of the editor and [GeppUI](../../src/geppui/README.md), with JS, type declarations, CSS and the applicable Monaco notices. `pnpm test:isolated external-libraries` installs both archives into a disposable consumer outside the workspace, builds and opens it with a live local JSON Worker. The consumer creates React controls and two presentations of one document and exercises editing, undo/redo and disposal.

The owner individually approved Microsoft Monaco ([#49](https://github.com/rabrunos/GeppIO/issues/49)).
The exact official `monaco-editor@0.58.0` package is pinned by [#72](https://github.com/rabrunos/GeppIO/issues/72).
Its tarball and lockfile integrity are
`sha512-Lj5hlfT4zdM5GSG9VxTHslWnwibGBvO6d9Mq/+9zmb1CkTZnib4+uAZUKl1zg+tMHRgY2OGax6hHKZNBtldR1g==`.
Its ESM bundle includes DOMPurify 3.4.17 and vendors the `@vscode/diff` backend under `esm/external/`.
Separate production dependencies are DOMPurify 3.4.17, marked 14.0.0 and `@vscode/diff` 0.0.2-145
(MIT, Microsoft), with optional @types/trusted-types 2.0.7. The application imports Monaco's public
ESM entry points, not the installed `@vscode/diff` package or its WASM file. A transitive override
cannot repair a bundled sanitizer, so check the bundled version directly.

DOMPurify 3.4.17 fixes the five advisories the owner had accepted for the 0.57.0 prototype
([former risk acceptance](https://github.com/rabrunos/GeppIO/issues/49#issuecomment-6886134045)):
GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr and
GHSA-c6gr-qvv4-5v3f. That exception has no remaining use and does not cover future findings.
Monaco 0.58.0 also stops editor Markdown from loading remote images by default; the production and
development CSP `img-src` already excluded remote origins.

## Assets and runtime

The Vite 7.3.8 / Electron 44.11.6 build bundles editor, JSON, TypeScript/JavaScript,
HTML and CSS Workers using public ESM entrypoints and Vite `?worker` imports (ES module output).
All production Worker/script/font assets use the bounded `geppio://app/assets/` protocol.
The only protocol MIME addition is `.ttf: font/ttf` for the bundled codicon font.
Production keeps script-src/worker-src 'self', font-src 'self', connect-src 'none' and the remote
request block. Development uses the existing exact loopback Vite origin. There is no remote
grammar download, eval allowance, blob script allowance or plugin Worker/native grant.
Monaco's included TypeScript services operate on bounded local models, not a full project IDE.
The editor retains one model per unique document (up to eight), with one content listener,
undo history and language per model. Alpha.72 attaches up to two editor instances to these
models. Each group owns selection and scrolling independently. Exact source and retained history budgets, corrective
refusal handling and disposal are described in [document ownership](documents.md).

The complete upstream MIT license and ThirdPartyNotices are retained in
[legal notices](../legal/monaco-LICENSE.txt) and [third-party notices](../legal/monaco-ThirdPartyNotices.txt).
Bundling can strip upstream source comments; do not rely on an emitted license header.
DOMPurify's full dual-license text is retained [separately](../legal/dompurify-LICENSE.txt), together with
[its MPL license](../legal/dompurify-LICENSE-MPL.txt),
[marked](../legal/marked-LICENSE.txt), [optional types](../legal/trusted-types-LICENSE.txt) and the
[`@vscode/diff` MIT notice](../legal/monaco-vscode-diff-LICENSE.txt) for the backend Monaco 0.58.0 bundles in its Workers.
Future distribution must preserve all applicable notices and review the editor dependencies again.

## Update procedure

Each Monaco update requires a separate scoped target.
Verify official npm metadata, exact tarball/hash, bundled sanitizer, production graph/advisories,
licenses and upstream behavior changes before changing the exact pin/lockfile. Run the Windows
Monaco production/development/DPR, document EOL/BOM/save/conflict, Explorer/Status Bar and affected
workbench regressions. Review Worker/CSP assets and notices again. Do not auto-upgrade, patch a
vendor file, or claim a package override replaces bundled source.
