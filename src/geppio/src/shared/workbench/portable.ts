import { DEFAULT_FREEFORM, constraintInRegion } from '../freeform/policy.ts'
import { applyComposition, systemCompositions } from './compositions.ts'
import { parseGroups, validateGroups } from './groups.ts'
import { LIMITS, groupConstraint, modelId, surfacePlacements } from './model.ts'
import type { Composition, Registry, View, WorkbenchSnapshot } from './model.ts'
import { presentationFor } from './presentations.ts'
import { parsePortableLayout, portableName, portableType } from './portable-format.ts'
import type { PortableLayout } from './portable-format.ts'
export { parsePortableLayout, parsePortableText, serializePortableLayout } from './portable-format.ts'
export type { PortableLayout, PortableCompositionV1 } from './portable-format.ts'

export function exportPortableComposition(saved: Composition, registry: Registry): PortableLayout {
  if (saved.system) throw new Error('Selecione uma composição salva para exportar.')
  if (saved.portable) return parsePortableLayout({ ...saved.portable, name: saved.name })
  const keys = new Map(saved.views.map((view, i) => [view.id, 'v' + (i + 1)]))
  const geometry = ({ region, x, y, width, height }: Composition['format'][number]) => ({ region, x, y, width, height })
  const chrome: PortableLayout['chrome'] = {}
  if (saved.chrome?.sidebar?.size !== undefined) chrome.sidebar = { size: saved.chrome.sidebar.size }
  if (saved.scopes.includes('bottom') && saved.chrome?.bottom?.size !== undefined) chrome.bottom = { size: saved.chrome.bottom.size }
  return parsePortableLayout({
    kind: 'geppio-layout', version: 1, name: saved.name, mode: saved.mode, scopes: saved.scopes,
    reference: Object.fromEntries(saved.scopes.map(region => [region, saved.reference[region]])), chrome,
    format: saved.format.map((slot, i) => ({ key: 's' + (i + 1), ...geometry(slot) })),
    views: saved.views.map(view => {
      const type = registry.get(view.typeId)
      if (!type || type.fixture || type.retired || type.missing) throw new Error('A composição contém um widget indisponível para exportação.')
      return { key: keys.get(view.id), ref: type.owner === 'host' ? { host: type.id } : { pluginId: type.pluginId, widgetId: type.widgetId } }
    }),
    placements: saved.placements.map(p => ({ view: keys.get(p.id), ...geometry(p), preferred: p.preferred })),
    groups: (saved.groups?.entries ?? []).map(group => ({ frame: keys.get(group.frameId), members: group.members.map(id => keys.get(id)), active: keys.get(group.active) }))
  })
}

/** A foreign association never enters the executable view registry during import or recovery. */
export function storedPortableComposition(id: string, name: string, input: unknown): Composition {
  const portable = parsePortableLayout(input)
  return { id, name: portableName(name), system: false, mode: portable.mode, scopes: [...portable.scopes],
    reference: { ...structuredClone(DEFAULT_FREEFORM.reference), ...structuredClone(portable.reference) },
    format: portable.format.map(({ key, ...slot }) => ({ ...slot, id: key })), chrome: structuredClone(portable.chrome),
    views: [], placements: [], portable }
}
export function importPortableComposition(source: WorkbenchSnapshot, input: PortableLayout, requestedName: string): Composition {
  if (source.organization.compositions.length >= LIMITS.compositions) throw new Error('Limite de composições salvas atingido.')
  const names = new Set([...systemCompositions(), ...source.organization.compositions].map(item => item.name.toLowerCase()))
  const base = portableName(requestedName.trim())
  let name = base
  for (let i = 2; names.has(name.toLowerCase()); i++) {
    const suffix = ' (' + i + ')'
    const prefix = base.slice(0, 100 - suffix.length).replace(/[\ud800-\udbff]$/, '')
    name = prefix + suffix
  }
  return storedPortableComposition('composition:' + crypto.randomUUID(), name, input)
}

export interface PortableDependency { key: string; label: string; candidates: { id: string; label: string }[]; reason?: string }
export function portableDependencies(source: WorkbenchSnapshot, registry: Registry, item: Composition, disabledOwners: ReadonlySet<string>): PortableDependency[] {
  if (!item.portable) return []
  const recipe = item.portable, placements = surfacePlacements(source)
  const dependencies = recipe.views.map(entry => {
    const id = portableType(entry.ref), type = registry.get(id), label = type?.title ?? id
    const group = recipe.groups.find(group => group.members.includes(entry.key))
    const frame = recipe.placements.find(p => p.view === (group?.frame ?? entry.key))!, region = frame.region
    const dependency: PortableDependency = { key: entry.key, label, candidates: [] }
    if (!type || type.missing || type.retired || disabledOwners.has(type.owner)) dependency.reason = 'Widget ausente, desativado ou indisponível.'
    else if (type.presence === 'single-view' && recipe.views.some(other => other.key !== entry.key && portableType(other.ref) === id)) dependency.reason = 'O widget permite apenas uma apresentação nessa instalação.'
    else if (!type.constraint.regions.includes(region) || group && (!type.tabMember || group.frame === entry.key && !type.tabHost)) dependency.reason = 'O widget é incompatível com a região ou o grupo.'
    else {
      const members = group?.members.map(key => ({ typeId: portableType(recipe.views.find(view => view.key === key)!.ref) }))
      const constraint = members?.every(member => registry.has(member.typeId)) ? groupConstraint(members, registry) : type.constraint
      const { min, max } = constraintInRegion(constraint, region)
      if ([frame, frame.preferred].some(size => size.width < min.width || size.height < min.height || size.width > max.width || size.height > max.height)) {
        dependency.reason = 'A geometria salva é incompatível com os limites atuais do widget ou grupo.'
        return dependency
      }
      const instances = source.organization.views.filter(view => view.typeId === id && view.modelId === modelId(id))
      const omitted = instances.filter(view => placements.some(p => p.id === view.id && !item.scopes.includes(p.region)))
      if (omitted.length && type.presence === 'single-view') dependency.reason = 'O widget já ocupa uma região fora da composição.'
      else {
        for (const view of instances) {
          if (omitted.includes(view) || presentationFor(source, view.id, registry).presentation !== 'normal' && group) continue
          const place = placements.find(p => p.id === view.id)
          dependency.candidates.push({ id: view.id, label: `${label} · ${place ? { main: 'Main', bottom: 'Bottom', sidebar: 'Sidebar' }[place.region] : 'sem posição'} · ${dependency.candidates.length + 1}` })
        }
        if (!dependency.candidates.length) dependency.reason = 'Nenhuma instância local compatível está disponível.'
      }
    }
    return dependency
  })
  // There are at most two placements for a public type (one per portable region).
  // If both can only use the same presentation, a complete binding is impossible.
  const unique = dependencies.filter(dep => dep.candidates.length === 1)
  for (const dep of unique) if (unique.some(other => other !== dep && other.candidates[0]!.id === dep.candidates[0]!.id)) {
    dep.reason = 'A composição requer apresentações locais distintas deste widget.'
  }
  return dependencies
}

/** Return a local application candidate only after every existing binding is resolved together. */
export function resolvePortableWidgets(source: WorkbenchSnapshot, registry: Registry, item: Composition, disabledOwners: ReadonlySet<string>, choices: Readonly<Record<string, string>>): Composition | null {
  const recipe = item.portable
  if (!recipe || recipe.mode !== 'format-widgets' || !recipe.views.length) return null
  const refs = portableDependencies(source, registry, item, disabledOwners), bindings = new Map<string, View>(), used = new Set<string>()
  if (Object.keys(choices).some(key => !refs.some(ref => ref.key === key))) return null
  for (const ref of refs) {
    const id = choices[ref.key] ?? (ref.candidates.length === 1 ? ref.candidates[0]!.id : null)
    if (ref.reason || !id || used.has(id) || !ref.candidates.some(option => option.id === id)) return null
    used.add(id)
    bindings.set(ref.key, source.organization.views.find(view => view.id === id)!)
  }
  const local = (key: string) => bindings.get(key)!.id
  const groups = recipe.groups.map(group => {
    const frameId = local(group.frame), members = group.members.map(local)
    const existing = source.organization.groups?.entries.find(entry => entry.frameId === frameId)
    return { id: existing?.id ?? 'group:' + crypto.randomUUID(), frameId, members, active: local(group.active) }
  })
  const resolved: Composition = { ...item, views: [...bindings.values()], placements: recipe.placements.map(({ view, ...placement }) => ({ ...placement, id: local(view) })) }
  delete resolved.portable
  if (groups.length) resolved.groups = { version: 1, entries: groups }
  try {
    const applied = applyComposition(source, registry, resolved, 'widgets')
    if (!applied) return null
    parseGroups(applied.organization.groups, applied.organization.views, registry); validateGroups(applied, registry)
  }
  catch { return null }
  return resolved
}
