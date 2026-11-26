# Find the implementation

Use the active Issue for scope and acceptance. The [architecture overview](architecture/overview.md) maps the six workspaces and their public boundaries.

| Working on | Read first | Find the code |
| --- | --- | --- |
| Shell, chrome, widgets, bars and compositions | [Requirements](product/requirements.md), [geometry and persistence](architecture/layout.md) | Renderer `workbench/`, `freeform/`, `settings/`; shared `workbench/`; runtime `layout/`. Historical grid codecs remain recovery inputs. |
| GeppUI, editor and portable composition | [GeppUI](../src/geppui/README.md), [basic Editor](../src/geppio-editor/README.md), [Standalone](../src/geppio-standalone/README.md) | Each package owns its exports and assets. Runtime owns activation and teardown. |
| IDE services | [Workspace](architecture/workspace.md), [documents](architecture/documents.md), [Explorer](architecture/explorer.md), [Git](architecture/git.md), [search](architecture/search.md), [Terminal](architecture/terminal.md), [Tools](architecture/workspace-tools.md) | Start with the named host service under `src/geppio/src/main/` and its matching test. Renderer views share host-owned models. |
| Plugins | [Activation and development](architecture/plugins.md), [surfaces and endpoints](architecture/plugin-surfaces.md), [packages](architecture/plugin-package.md), [ordinary data](architecture/plugin-data.md) | SDK exports, runtime broker and host plugin services |
| Native handoff | [Behavior and open proofs](architecture/native-reference.md) | Follow the domain and test named for each scenario. Use the exact integrated Electron commit recorded in the preparation Issue. |
| Build, verification and integration | [Local setup](development/local.md), [test commands](development/testing.md), [security review](development/security-review.md), [Git](development/github.md) | Root package scripts, `tools/`, `tests/`, Windows CI |
| Client setup | [Optional project adapters](development/clients.md) | Project-local discovery and verification |
