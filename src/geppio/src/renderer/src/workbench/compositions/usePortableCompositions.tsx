import { useEffect, useRef, useState } from 'react'
import { codeGeneration } from '../../../../shared/plugins.ts'
import { compositionScene } from '../../../../shared/workbench/compositions.ts'
import type { InstalledPlugin } from '../../../../shared/plugins.ts'
import type { Composition, Registry, WorkbenchSnapshot } from '../../../../shared/workbench/model.ts'
import { LIMITS } from '../../../../shared/workbench/model.ts'
import { exportPortableComposition, importPortableComposition, parsePortableLayout, portableDependencies, resolvePortableWidgets, storedPortableComposition } from '../../../../shared/workbench/portable.ts'
import type { PortableLayout } from '../../../../shared/workbench/portable.ts'
import type { Transaction } from '../../freeform/useTransaction.ts'
import { CompositionThumbnail } from './CompositionThumbnail.tsx'
import { Confirm, Dialog } from '../Primitives.tsx'
import { compositionTemplates, currentCompositionTemplate } from './plugin-templates.ts'
import type { TemplateChoice } from './plugin-templates.ts'

export interface PortableEnvironment {
  disabled: ReadonlySet<string>
  inventory: readonly InstalledPlugin[]
  managing(): boolean
  inventoryUnconfirmed(): boolean
  gesture(): boolean
}
interface Context extends PortableEnvironment {
  tx: Transaction; registry: Registry; view: WorkbenchSnapshot; hidden: boolean
  applied(item: Composition): void
  imported(): void
}
interface Preview { recipe: PortableLayout; record: Composition; stamp: string; provider?: TemplateChoice }
interface Mapping { item: Composition; stamp: string; choices: Record<string, string> }
const recheckInventory = 'Atualize a lista de plugins para confirmar os modelos e widgets disponíveis.'
function needsPlugins(recipe?: PortableLayout) { return recipe?.views.some(({ ref }) => 'pluginId' in ref) }

function dependencies(ctx: Context, item: Composition) {
  return portableDependencies(ctx.tx.live.current, ctx.registry, item, ctx.disabled)
}
function stamp(ctx: Context, item: Composition) {
  const versions = item.portable?.views.map(({ ref }) => {
    if (!('pluginId' in ref)) return null
    const installed = ctx.inventory.find(plugin => plugin.manifest.id === ref.pluginId)
    return installed ? [installed.revision, codeGeneration(installed), installed.enabled] : null
  })
  return JSON.stringify([versions, dependencies(ctx, item)])
}
function issue(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível validar a composição.'
}

export function usePortableCompositions(context: Context) {
  const latest = useRef(context); latest.current = context
  const mounted = useRef(false), pending = useRef(false)
  const [working, setWorking] = useState(false), [preview, setPreview] = useState<Preview | null>(null)
  const [name, setName] = useState(''), [checkpoint, setCheckpoint] = useState(false)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [catalog, setCatalog] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const allowed = () => !latest.current.hidden && latest.current.tx.canImportComposition() && !latest.current.gesture() && !latest.current.managing()
  function startWork() {
    if (pending.current || !allowed()) return false
    pending.current = true; setWorking(true); return true
  }
  function endWork() { pending.current = false; if (mounted.current) setWorking(false) }
  function previewRecipe(input: PortableLayout, provider?: TemplateChoice) {
    const ctx = latest.current, recipe = parsePortableLayout(input), source = ctx.tx.live.current
    const record = provider && source.organization.compositions.length >= LIMITS.compositions
      ? storedPortableComposition('preview', recipe.name, recipe) : importPortableComposition(source, recipe, recipe.name)
    setPreview({ recipe, record, stamp: stamp(ctx, record), provider }); setName(record.name)
    ctx.tx.setMessage('')
  }
  function showTemplates() { if (!pending.current && allowed() && !latest.current.inventoryUnconfirmed()) setCatalog(true) }
  function previewTemplate(choice: TemplateChoice) {
    if (pending.current || !allowed() || latest.current.inventoryUnconfirmed() || !currentCompositionTemplate(latest.current.inventory, choice)) return
    try { previewRecipe(choice.recipe, structuredClone(choice)); setCatalog(false) }
    catch (error) { latest.current.tx.setMessage(issue(error)) }
  }
  async function selectImport() {
    if (!startWork()) return
    try {
      const result = await window.geppio!.portableLayouts.importFile().catch(() => { throw new Error('Não foi possível receber a composição selecionada.') })
      if (!mounted.current || !allowed()) return
      const ctx = latest.current
      if (!result.ok) { ctx.tx.setMessage(result.error); return }
      if (!result.recipe) return
      previewRecipe(result.recipe)
    } catch (error) { if (mounted.current) latest.current.tx.setMessage(issue(error)) }
    finally { endWork() }
  }
  async function exportItem(id: string) {
    if (!startWork()) return
    try {
      const ctx = latest.current, saved = ctx.tx.savedComposition(id)
      if (!saved) { ctx.tx.setMessage('Salve a composição antes de exportá-la.'); return }
      const recipe = exportPortableComposition(saved, ctx.registry)
      const result = await window.geppio!.portableLayouts.exportFile(JSON.stringify(recipe)).catch(() => {
        throw new Error('Não foi possível confirmar a exportação. Confira o destino antes de tentar novamente.')
      })
      if (mounted.current) ctx.tx.setMessage(!result.ok ? result.error : result.canceled ? 'Exportação cancelada.' : 'Composição exportada.')
    } catch (error) { if (mounted.current) latest.current.tx.setMessage(issue(error)) }
    finally { endWork() }
  }
  function verify(p: Preview) {
    const ctx = latest.current
    return mounted.current && !ctx.hidden && !ctx.gesture() && !ctx.managing() &&
      (!(p.provider || needsPlugins(p.recipe)) || !ctx.inventoryUnconfirmed()) &&
      (!p.provider || currentCompositionTemplate(ctx.inventory, p.provider)) && stamp(ctx, p.record) === p.stamp
  }
  async function importPreview(saveCheckpoint = false) {
    if (!preview || !name.trim() || !startWork()) return
    try {
      if (!verify(preview)) { latest.current.tx.setMessage('As dependências mudaram. Atualize a prévia antes de importar.'); return }
      if (latest.current.tx.live.current.organization.compositions.length >= LIMITS.compositions) {
        latest.current.tx.setMessage('Limite de composições salvas atingido.'); return
      }
      if (latest.current.tx.pendingImportCheckpoint()) {
        if (!saveCheckpoint) { setCheckpoint(true); return }
        if (!await latest.current.tx.saveEditing(latest.current.view, () => verify(preview))) return
      }
      if (!allowed() || !verify(preview)) return
      const ctx = latest.current, record = importPortableComposition(ctx.tx.live.current, preview.recipe, name.trim())
      if (await ctx.tx.saveImportedComposition(record, () => verify(preview)) && mounted.current) {
        setPreview(null); ctx.imported()
        ctx.tx.setMessage((preview.provider ? 'Cópia adicionada: ' : 'Composição importada: ') + record.name + '.')
      }
    } catch (error) { if (mounted.current) latest.current.tx.setMessage(issue(error)) }
    finally { endWork() }
  }
  function reason(item: Composition) {
    if (context.hidden || !item.portable) return
    if (context.managing()) return 'Aguarde a conclusão do gerenciamento de plugins.'
    if (needsPlugins(item.portable) && context.inventoryUnconfirmed()) return recheckInventory
    if (item.portable?.mode === 'format-widgets' && !item.portable.views.length) return 'Esta composição não contém associações de widgets.'
    const unavailable = item.portable && dependencies(context, item).find(value => value.reason || !value.candidates.length)
    return unavailable ? unavailable.label + ' — ' + (unavailable.reason ?? 'Nenhuma apresentação local compatível.') : undefined
  }
  function resolve(item: Composition, choices: Record<string, string>, expected: string) {
    const ctx = latest.current, current = ctx.tx.live.current.organization.compositions.find(value => value.id === item.id)
    if (!allowed() || !current || needsPlugins(current.portable) && ctx.inventoryUnconfirmed() || stamp(ctx, current) !== expected || JSON.stringify(item.portable) !== JSON.stringify(current.portable)) {
      ctx.tx.setMessage('A composição ou as dependências mudaram. Confira as opções e tente novamente.'); return
    }
    const scene = compositionScene(ctx.tx.live.current, ctx.view, current.scopes)
    const value = resolvePortableWidgets(scene, ctx.registry, current, ctx.disabled, choices)
    if (!value) { ctx.tx.setMessage('As apresentações atuais são incompatíveis com a composição. Confira os widgets disponíveis.'); return }
    setMapping(null); ctx.applied(value)
  }
  function widgets(item: Composition) {
    if (!allowed()) return
    const problem = reason(item)
    if (problem) { context.tx.setMessage(problem); return }
    const signature = stamp(context, item)
    if (dependencies(context, item).some(dep => dep.candidates.length > 1)) {
      context.tx.setMessage(''); setMapping({ item, stamp: signature, choices: {} })
    } else resolve(item, {}, signature)
  }
  const previewStale = preview && stamp(context, preview.record) !== preview.stamp
  const previewUnconfirmed = preview && (preview.provider || needsPlugins(preview.recipe)) && context.inventoryUnconfirmed()
  const providerStale = preview?.provider && !currentCompositionTemplate(context.inventory, preview.provider)
  const full = context.tx.live.current.organization.compositions.length >= LIMITS.compositions
  const templates = context.hidden || context.inventoryUnconfirmed() ? [] : compositionTemplates(context.inventory)
  const ambiguous = mapping ? dependencies(context, mapping.item).filter(dep => dep.candidates.length > 1) : []
  const mappingStale = mapping && (needsPlugins(mapping.item.portable) && context.inventoryUnconfirmed() || stamp(context, mapping.item) !== mapping.stamp)
  const dialogs = <>
    {preview && <Dialog title={preview.provider ? 'Prévia do modelo' : 'Importar composição'} close={() => { if (!pending.current) setPreview(null) }}>
      <form className="layout-save-form" onSubmit={event => { event.preventDefault(); void importPreview() }}>
        <div className="layout-save-preview"><CompositionThumbnail composition={preview.record} /></div>
        {preview.provider && <p>Plugin: {preview.provider.providerName} · {preview.provider.providerId} · versão {preview.provider.version} · {preview.provider.enabled ? 'habilitado' : 'desabilitado'}</p>}
        <label className="custom-bar-field">Nome da composição<input className="ui-input" data-initial-focus required maxLength={100}
          value={name} onChange={event => setName(event.target.value)} /></label>
        <ul>{preview.record.scopes.map(region => <li key={region}>{region === 'main' ? 'Área principal' : 'Barra inferior'} · {preview.record.reference[region].width} × {preview.record.reference[region].height} px</li>)}
          {preview.record.chrome?.sidebar?.size !== undefined && <li>Largura da barra lateral · {preview.record.chrome.sidebar.size} px</li>}</ul>
        <p>Espaços: {preview.record.format.length}. Grupos: {preview.recipe.groups.length}.</p>
        {preview.provider && preview.record.format.length > 0 && <details><summary>Geometria dos espaços</summary><ul>{preview.record.format.map(slot =>
          <li key={slot.id}>{slot.region === 'main' ? 'Área principal' : 'Barra inferior'} · x {slot.x}, y {slot.y} · {slot.width} × {slot.height} px</li>)}</ul></details>}
        {preview.recipe.views.length > 0 && <section aria-label="Dependências"><strong>Widgets necessários</strong><ul>{dependencies(context, preview.record).map(dep =>
          <li key={dep.key}>{dep.label} — {dep.reason ?? (dep.candidates.length + ' apresentação(ões) local(is)')}</li>)}</ul></section>}
        {preview.provider && !preview.recipe.views.length && <p>Sem dependências de widgets.</p>}
        <p className="custom-bar-hint">{preview.provider ? 'A cópia ficará em Composições Salvas. Use Formato ou Widgets para aplicá-la depois.' : 'A importação adiciona uma cópia à biblioteca. Use Formato ou Widgets para aplicá-la depois.'}</p>
        {previewStale && !providerStale && <button type="button" className="ui-button tool-button" onClick={() => setPreview({ ...preview, stamp: stamp(context, preview.record) })}>Atualizar prévia</button>}
        <p role="status">{previewUnconfirmed ? recheckInventory : providerStale ? 'O plugin ou o modelo mudou. Cancele e consulte os modelos disponíveis.' : previewStale ? 'As dependências mudaram. Atualize a prévia.' : full ? 'Limite de composições salvas atingido.' : context.tx.message}</p>
        <footer className="custom-bar-actions"><button type="button" className="ui-button tool-button" disabled={working} onClick={() => setPreview(null)}>Cancelar</button>
          <button className="ui-button plugins-button" disabled={working || context.managing() || !!previewUnconfirmed || !!providerStale || !!previewStale || full || !name.trim()}>{preview.provider ? 'Adicionar cópia' : 'Importar como nova composição'}</button></footer>
      </form>
    </Dialog>}
    {checkpoint && <Confirm title="Salvar a edição primeiro?" text={preview?.provider ? 'Salve o checkpoint da edição para adicionar a cópia. Cancelar mantém o rascunho e a prévia abertos.' : 'Salve o checkpoint da edição para continuar a importação. Cancelar mantém o rascunho e a prévia abertos.'}
      label="Salvar edição e continuar" destructive={false} confirm={() => { void importPreview(true) }} close={() => setCheckpoint(false)} />}
    {mapping && <Dialog title="Escolher apresentações" close={() => setMapping(null)}>
      <p>Escolha a apresentação local de cada widget em “{mapping.item.name}”.</p>
      {ambiguous.map(dep => <label className="custom-bar-field" key={dep.key}>{dep.label}<select className="ui-input" value={mapping.choices[dep.key] ?? ''}
        onChange={event => setMapping({ ...mapping, choices: { ...mapping.choices, [dep.key]: event.target.value } })}>
        <option value="">Escolher…</option>{dep.candidates.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>)}
      <p role="status">{mappingStale ? 'As apresentações mudaram. Cancele e confira os widgets novamente.' : context.tx.message}</p>
      <footer className="workspace-dialog-actions"><button className="ui-button workspace-secondary" onClick={() => setMapping(null)}>Cancelar</button>
        <button className="ui-button workspace-primary" disabled={context.managing() || !!mappingStale || ambiguous.some(dep => !mapping.choices[dep.key])}
          onClick={() => resolve(mapping.item, mapping.choices, mapping.stamp)}>Aplicar widgets</button></footer>
    </Dialog>}
    {catalog && !context.hidden && <Dialog title="Modelos de plugins" close={() => setCatalog(false)}>
      {templates.length ? <ul className="plugin-template-list">{templates.map(choice => <li key={choice.providerId + ':' + choice.id}>
        <button type="button" className="ui-button workspace-command" data-composition-template-provider={choice.providerId} data-composition-template-id={choice.id}
          aria-label={'Ver modelo ' + choice.recipe.name} disabled={context.managing()} onClick={() => previewTemplate(choice)}>
          <strong>{choice.recipe.name}</strong><small>{choice.providerName} · {choice.version}</small></button></li>)}</ul> : <p>Nenhum modelo de plugin disponível.</p>}
    </Dialog>}
  </>
  return { selectImport, exportItem, widgets, reason, dialogs, working, showTemplates, hasTemplates: !!templates.length }
}
