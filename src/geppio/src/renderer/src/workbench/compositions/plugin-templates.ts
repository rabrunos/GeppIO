import { codeGeneration } from '../../../../shared/plugins.ts'
import type { InstalledPlugin } from '../../../../shared/plugins.ts'
import type { PortableLayout } from '../../../../shared/workbench/portable.ts'

export interface TemplateChoice {
  providerId: string; providerName: string; version: string; revision: string; generation: string; enabled: boolean
  id: string; recipe: PortableLayout
}
/** Only the accepted inventory supplies templates. The Worker and the package's files are not consulted. */
export function compositionTemplates(inventory: readonly InstalledPlugin[]): TemplateChoice[] {
  return inventory.flatMap(plugin => plugin.unavailable ? [] : (plugin.manifest.compositionTemplates ?? []).map(template => ({
    providerId: plugin.manifest.id, providerName: plugin.manifest.name, version: plugin.manifest.version,
    revision: plugin.revision, generation: codeGeneration(plugin), enabled: plugin.enabled, id: template.id, recipe: template.composition
  })))
}
export function currentCompositionTemplate(inventory: readonly InstalledPlugin[], choice: TemplateChoice): boolean {
  const plugin = inventory.find(entry => entry.manifest.id === choice.providerId)
  if (!plugin || plugin.unavailable || plugin.revision !== choice.revision || codeGeneration(plugin) !== choice.generation ||
      plugin.enabled !== choice.enabled || plugin.manifest.version !== choice.version || plugin.manifest.name !== choice.providerName) return false
  const template = plugin.manifest.compositionTemplates?.find(item => item.id === choice.id)
  return !!template && JSON.stringify(template.composition) === JSON.stringify(choice.recipe)
}
