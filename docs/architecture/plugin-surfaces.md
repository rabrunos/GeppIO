# API 3 web surfaces

A schema 1 manifest can select API 3 for an author-owned HTML fragment, stylesheet and one script entry. The existing [API 1/2 contracts](plugins.md) continue to run their declarative widgets in trusted local Workers. API 3 has a separate execution context and an explicit communication protocol.

## Author a surface

Use the [board](../../examples/standalone/plugins/board/plugin.json) and [stamp](../../examples/standalone/plugins/stamp/plugin.json) folders directly. Each manifest declares a plugin ID, semantic version, entry file, one widget with `surface: "web"`, and a `surface` object with exactly `html`, `css`, `offers` and `uses`. Paths are relative to the selected folder. HTML and CSS reference a local PNG as `gpp-image:tile.png`. Main embeds the accepted image bytes in the prepared document. Shared input bounds include 16 KiB per manifest, 512 KiB per file, 2 MiB per decoded package and 64 files/directories. The final HTML, scripts, stylesheet and expanded images together must fit 4 MiB.

A self-contained JS, JSX, TS or TSX entry is transformed by the host's existing TypeScript compiler. Its small JSX factory creates DOM elements for intrinsic tags. Supply an already bundled script and the corresponding stylesheet when using a library such as GeppUI. Runtime module imports, author build hooks and remote assets are outside the loader contract. The examples use plain DOM and require no React or GeppUI.

At startup, await `window.geppioSurface`. The host starts one hidden activation frame per enabled generation. It creates separate frames for presentations. Both execute the declared entry. Use `mode` to distinguish activation from view, install handlers, then call `ready()` within three seconds. Keep state shared between presentations in the activation controller's supported contract. View-local JavaScript and DOM state last for that presentation. API 3 offers no durable plugin-data API. Layout references and data retained from other compatible installations remain under their existing owners.

## Connect plugins

An offer names `kind`, `name` and an integer `version` from 1 to 255. A use also specifies the exact `provider` plugin ID. Lists contain up to 16 distinct entries each. The user selects the required endpoint grants in **Configurações → Plugins** once the consumer and provider are active. Grants belong to the live pair of generations and exact endpoint. They expire on disable, reload or restart. Catalog reads and visual placement cannot grant access.

| Kind | Author call | Receiving side |
| --- | --- | --- |
| Command or service | `call(endpoint, value, signal?)` | Provider activation's `onInvoke(endpoint, value, caller, signal)` returns a string or a promise for one |
| Event | Provider calls `emit(endpoint, value)` for its own offered event | Granted consumer frames receive `onEvent(endpoint, value, caller)` |
| Slot | Consumer declares a use of a provider's named slot | Host mounts the contributor's own presentation alongside the provider's frame in its widget |

Use `available(endpoint)` for a declared endpoint's status. Calls, availability checks and sends resolve to `{ok:true,value}` or `{ok:false,error}`. Errors include `unavailable`, `incompatible`, `denied`, `invalid`, `busy`, `cancelled` and `failed`. Message protocol version 1 accepts strings of at most 8,192 UTF-16 code units. Structured payloads can be encoded as text and validated by the receiving contract. Each surface client permits 32 pending requests, the broker permits 64 in-flight invocations overall and accepts at most 120 messages per port per second. Malformed or excessive messages are dropped. The broker expires pending calls after five seconds, checked every 500 ms. The client has a six-second cancellation fallback. Abort, grant revocation or peer teardown settles the call. A provider that performs asynchronous work should honor its abort signal.

The host captures caller identity when attaching the channel. A nested stamp uses its own port and its own grants. Board never receives stamp's DOM or authority. The host cancels pending work and closes all presentation/controller ports for a superseded generation. Requests cannot specify a caller identity or native channel.

## Folder reload and packages

Enable **Modo desenvolvedor**, choose **Carregar pasta local**, select the original board and stamp folders separately and activate them. Add their widgets from the catalog. Grant stamp's service, command, event or slot as needed. Edit text or styles in the same source folder and press **Atualizar**. The development registration stays unsigned. The host inspects all candidate bytes, transforms the entry and prepares resources before publishing its new digest/generation. Prepublication errors preserve the previous accepted snapshot and registration. Reload preserves the registration’s execution family. Switching between the legacy Worker and web surface contracts requires a separate explicit registration. A postpublication activation error is visible as a failure; correct the source and reload explicitly. Measure the refresh through the moment the updated visible surface is usable.

The [signed package format](plugin-package.md) authenticates the original files. A byte-identical copy verifies against the same authorized key. Signed API 3 replacement requires a disabled signed API 3 installation, matching authorized key, plugin ID and widget ID, and a new native confirmation. The installation and layout identities persist while the new signed snapshot gets its own code generation. There is no publisher enrollment service. Source inclusion and third-party publication remain separate decisions.

## Isolation and evidence

The host loads one immutable prepared document through `geppio-surface://<generation>/<plugin-id>/index.html`. Main permits navigation into an accepted generation from the app's main frame. CSP and the iframe sandbox allow scripts with an opaque origin. The response permits only the exact hashed bootstrap, prepared entry and stylesheet, plus embedded image bytes. It denies subframes, Workers, forms and connections. The frame has no preload, native IPC interface, filesystem or process API. It receives one transferred MessagePort from the direct parent. Host controls and neighboring documents have distinct DOM authority. Native dialogs and grants stay in Main.

This boundary covers local web presentation and brokered communication. It provides no protection against an Electron/Chromium vulnerability, hostile same-user changes to the installation, deceptive content inside the author's own frame, or complete CPU/memory exhaustion. Resource limits apply to prepared documents and protocol traffic; the browser and OS still manage execution resources. API 1/2 Workers retain their separate trust assumptions. Package signatures establish content and publisher integrity within the configured trust roots.

Run `pnpm.cmd test:surfaces` against current built assets for the disposable Electron path. The [resource tests](../../tests/surface-resources.test.ts), [development-folder tests](../../tests/plugin-dev.test.ts) and [signed package tests](../../tests/plugin-package.test.ts) cover complementary checks. The Issue records actual command outcomes, elapsed reload time and remaining manual acceptance.

The [Standalone guide](../../src/geppio-standalone/README.md) describes how to generate the board and stamp as an independent Windows application.
