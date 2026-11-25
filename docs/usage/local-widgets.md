# Try the local widgets

These instructions use the existing development examples in a prepared Windows checkout.
For environment setup, see [local development](../development/local.md).

## Install and place a widget

```powershell
pnpm plugins:build
pnpm build
pnpm start
```

Open **Plugins**, enable **Modo desenvolvedor** in the development settings, and use
**Carregar pasta local** to select one generated folder under `.local/plugin-packages/`.
Activate the plugin, enter **Editar layout**, choose a widget in the catalog and select a
compatible region. Finish with **Concluir**. Activating a plugin does not place widgets automatically.

Development and built application profiles can have independent data. Keep using the same
launch mode when checking the examples' saved state. These local Worker examples require trusted code;
they are separate from [API 3 web surfaces](../architecture/plugin-surfaces.md).

## Workspace Essentials

Select `.local/plugin-packages/workspace-essentials`. The plugin includes:

| Widget | Try it |
| --- | --- |
| **Anotações** | Choose **Nova anotação**, edit the title/text, then select another note. |
| **Rascunho** | Type and wait for **Salvo.**; the autosave groups edits for 500 ms. |
| **Checklist** | Enter a **Novo item**, choose **Adicionar item**, then mark it complete. |
| **Prompts salvos** | Choose **Novo prompt**, edit it and use **Copiar prompt**. |

Notes, Checklist and Saved prompts support Main, Sidebar and Bottom; Scratchpad is Main-only.
Bottom presents compact reading/checklist controls. Use Main or Sidebar for the full editors.
If clipboard access is refused, select the prompt text and copy it manually.

Confirmed data remains when widgets are removed or the same installation is disabled and
reactivated. Uninstalling retains a recoverable file, but a new installation does not automatically
inherit it. If saving fails, retry or copy the pending text before closing. These are ordinary local
files, not a credential vault. See [data retention and recovery](../architecture/plugin-data.md).

The separate **Instalar arquivo assinado** path verifies authorized `.gpp` packages. See
[package signing and installation](../architecture/plugin-package.md) for the supported pilot.

## Time Tracker

Select `.local/plugin-packages/time-tracker`, activate it, and add **Cronômetro** and
**Relatórios de tempo**. They share one history per installation and support all three regions.

**Iniciar** starts a timestamp-based interval; it continues while the widget is hidden or the
application is closed, until **Pausar**. Wait for **Salvo.**; on failure, use **Tentar salvar novamente**.
Reports show local totals for the last seven days and paged sessions, up to 200 intervals.
Sidebar and Bottom provide compact summaries.

## Updating an example

Rebuild the example in the registered folder, then explicitly reload it in **Plugins**. There is
no automatic folder watcher. Wait for pending writes before reloading or disabling a plugin.
See [development-folder behavior](../architecture/plugins.md#external-folder-development-alpha35--issue-44).
