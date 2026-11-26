# Licensing

GeppIO's original source code, documentation, examples and repository-owned assets are
licensed under the [Apache License 2.0](../../LICENSE), unless a file states different terms.
The root `LICENSE` contains the unmodified official text. The root and six workspace
package manifests, and the native Cargo workspace, use the SPDX identifier `Apache-2.0`.

## Third-party material

Dependencies and incorporated third-party material retain their own licenses, copyrights
and notices. The existing files in this directory preserve the Monaco, DOMPurify, marked,
trusted-types and Terminal dependency notices. `heroicons-LICENSE.txt` covers the Heroicons
24/outline SVG copies embedded by the native GeppUI (`native/crates/geppui/assets/icons`,
regenerated from the approved `@heroicons/react` 2.2.0 by `tools/native-icons.ts`). They are
not relicensed by GeppIO.
Other dependencies carry their notices in their upstream packages; this directory is not
a complete dependency inventory. Distribution must preserve the notices for the actual
components included, including transitive and bundled components.

## Generated packages and applications

| Output | License placement |
| --- | --- |
| GeppUI and Editor archives | `package/LICENSE` covers GeppIO's code; the Editor also retains its existing `package/legal/` notices. |
| Standalone directory | `LICENSE-GeppIO` covers the GeppIO engine; `LICENSE` and `LICENSES.chromium.html` retain the Electron and Chromium terms. |

Independently authored plugins and selected application content keep the terms chosen by
their authors. Loading or packaging them with GeppIO does not automatically license them
under Apache 2.0. Include their applicable permissions and notices when redistributing them.

Contributions intentionally submitted for inclusion follow section 5 of the Apache License,
unless explicitly stated otherwise. Contributors retain ownership of their contributions.
This license adoption adds no separate CLA or DCO requirement. Existing dependency review
and publication approvals remain applicable.
