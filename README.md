<p align="center">
  <img src="docs/assets/geppio-cover.png" width="1280" alt="GeppIO — a modular workbench for developers, with its mascot and a widget being moved out of a workspace window.">
</p>

# GeppIO

**Your tools. Your workspace.**

A local desktop workbench for widgets, code, and plugins. Arrange your workspace, save compositions,
and build new tools on a modular foundation made with Electron, React, and TypeScript.

[Get started](#get-started-on-windows) · [Create plugins](#build-for-geppio) · [Architecture](docs/architecture/overview.md) · [Roadmap](https://github.com/rabrunos/GeppIO/issues/2)

> **In alpha development.** The application is currently validated on Windows x64. Other platforms remain on the roadmap.

## What you can do

- **Organize with widgets.** Move, resize, and group compatible tools into tabs. Use the main,
  side, and bottom areas, then save compositions to return to a layout.
- **Work with code.** GeppIO Code brings together Monaco, a file explorer, search and replace,
  local Git tools, and a terminal. Tabs and two editor groups share the same documents.
- **Create your own tools.** Build custom interfaces, reload plugins from their source folders,
  and connect their functionality through explicit permissions.
- **Build an independent app.** The Standalone generator creates Windows x64 applications from
  selected notes, counters, and API 3 plugin surfaces, with a separate product identity and data profile.

## Get started on Windows

Install **Node.js 24.x**, **pnpm 11.25.0**, and **Git for Windows**.

```powershell
git clone https://github.com/rabrunos/GeppIO.git
cd GeppIO
pnpm install --frozen-lockfile
pnpm run doctor
pnpm dev
```

A new profile starts empty: activate plugins and choose their widgets from the catalog.
[Try the local widgets](docs/usage/local-widgets.md), or follow the
[development guide](docs/development/local.md) for environment setup, builds, and testing.

## Build for GeppIO

With **API 3**, plugin interfaces use HTML and CSS, with JavaScript or TypeScript prepared by the host.
Enable developer mode, load the source folder, edit its files, and explicitly reload the plugin from its details.
The [Board](examples/standalone/plugins/board) and [Stamp](examples/standalone/plugins/stamp)
examples demonstrate custom surfaces and communication between plugins.

API 3 surfaces are isolated and communicate through explicitly granted channels. The earlier **API 1/2**
contracts remain intended for trusted local plugins. The **signed `.gpp` package** pilot verifies
package contents and publisher identity against the application's authorized keys.

[Surfaces and communication](docs/architecture/plugin-surfaces.md) · [Signed .gpp packages](docs/architecture/plugin-package.md) · [Generate a Standalone](src/geppio-standalone/README.md)

## Six modules, clear responsibilities

| Module | Responsibility |
| --- | --- |
| [GeppIO](src/geppio) | Desktop application, workspaces, and native services. |
| [Runtime](src/geppio-runtime) | Layout geometry, capability activation, and shared contracts. |
| [GeppUI](src/geppui/README.md) | Reusable React controls, themes, and visual behavior. |
| [Editor](src/geppio-editor/README.md) | Reusable Monaco editor integration. |
| [Plugin SDK](src/plugin-sdk) | Plugin authoring and communication contracts. |
| [Standalone](src/geppio-standalone/README.md) | Selected compositions packaged as independent applications. |

GeppUI and Editor can be packaged for use in other projects. Their guides cover setup and boundaries;
the [architecture overview](docs/architecture/overview.md) explains how the modules connect.

The Electron application is the runnable reference for the planned Rust and GPUI host. The native GeppUI library will remain usable independently. [Native direction](docs/architecture/native-reference.md)

## Explore the project

- **Working on the code?** Start with the [domain map](docs/README.md).
- **Following development?** Browse the [roadmap](https://github.com/rabrunos/GeppIO/issues/2),
  [Issues](https://github.com/rabrunos/GeppIO/issues), and [changelog](CHANGELOG.md).
- **Understanding data and limits?** Read about [documents and recovery](docs/architecture/documents.md),
  [security boundaries](docs/architecture/security.md), and [validation](docs/development/testing.md).

## License

GeppIO is licensed under the [Apache License 2.0](LICENSE).
Third-party components retain their own licenses; see the [licensing notes](docs/legal/README.md).
