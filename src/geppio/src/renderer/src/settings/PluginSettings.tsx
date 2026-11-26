import { SurfaceGrants } from '../web-surfaces.tsx'
import { useLocale } from '../workbench/Locale.tsx'
import type { Plugins } from '../usePlugins.ts'

const STATUS = { starting: 'Ativando', active: 'Ativo', stopping: 'Desativando', disabled: 'Desativado', error: 'Falha' }
export function PluginSettings({ plugins }: { plugins: Plugins }) {
  const { t } = useLocale()
  return <section aria-label="Plugins">
    <h3>Plugins</h3>
    <p>{t('Instale um arquivo .gpp assinado por uma chave autorizada para o plugin.')}</p>
    <button className="ui-button tool-button ui-button-primary" disabled={plugins.busy || !plugins.available} onClick={plugins.installFile}>{t('Instalar arquivo assinado')}</button>
    <label className="workspace-switch-row"><span>{t('Modo desenvolvedor')}</span><input type="checkbox" role="switch" aria-label={t('Modo desenvolvedor')} checked={Boolean(plugins.inventory.developerMode)} disabled={plugins.busy || !plugins.available} onChange={event => plugins.setDeveloperMode(event.target.checked)} /></label>
    <p>{t('As APIs 1 e 2 executam código local confiável. A API 3 usa superfícies isoladas com permissões de comunicação. Desligar o modo pausa as pastas e preserva seus dados e posições.')}</p>
    {plugins.inventory.developerMode && <button className="ui-button tool-button" disabled={plugins.busy || !plugins.available} onClick={plugins.install}>{t('Carregar pasta local')}</button>}
    <p role="status">{plugins.busy ? t('Processando plugins…') : t(plugins.message)}</p>
    {plugins.inventoryUnconfirmed() && <button className="ui-button tool-button" disabled={plugins.busy} onClick={plugins.refresh}>Atualizar lista de plugins</button>}
    {plugins.inventory.errors.map(error => <div className="plugin-error" key={error}><p>{error}</p>{/^[a-z][a-z0-9.-]*:/.test(error) && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.removeInvalid(error.split(':')[0]!)}>{t('Remover instalação inválida')}</button>}</div>)}
    {!plugins.views.length && <p>{t('Nenhum plugin instalado.')}</p>}
    <ul className="plugin-list">{plugins.views.map(view => <li key={view.plugin.manifest.id} data-plugin={view.plugin.manifest.id} data-status={view.status}>
      <div><strong>{view.plugin.manifest.name}</strong><small>{view.plugin.manifest.id} · {view.plugin.manifest.version} · {view.plugin.manifest.widgets.length} widget(s)</small></div>
      <small>{t(view.plugin.source === 'external' ? 'Pasta externa' : view.plugin.source === 'signed' ? 'Pacote assinado' : 'Cópia gerenciada legada')}</small>
      <span className="badge">{t(STATUS[view.status])}</span>
      <p role="status">{t(view.detail)}</p>
      {view.status === 'active' && view.plugin.manifest.surface && <SurfaceGrants plugin={view.plugin} host={plugins.surfaces} active={plugins.views.filter(item => item.status === 'active').map(item => item.plugin)} />}
      {view.plugin.unavailable && <p role="status">{t(view.plugin.unavailable)}</p>}
      <details><summary>{t('Eventos desta sessão')}</summary><ul>{view.events.map((event, index) => <li key={index}>{event}</li>)}</ul></details>
      <div className="plugin-actions"><button className="ui-button tool-button" disabled={plugins.busy || view.plugin.source === 'external' && !plugins.inventory.developerMode} onClick={() => plugins.toggle(view)}>{t((view.plugin.desiredEnabled ?? view.plugin.enabled) ? 'Desativar' : 'Ativar')}</button>
        {view.status === 'error' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.retry(view.plugin.manifest.id)}>{t('Tentar novamente')}</button>}
        {plugins.inventory.developerMode && view.plugin.source === 'external' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.reload(view.plugin.manifest.id)}>{view.plugin.manifest.apiVersion === 3 ? 'Atualizar' : t('Recarregar')}</button>}
        {plugins.inventory.developerMode && view.plugin.source === 'external' && view.status === 'error' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.reload(view.plugin.manifest.id, true)}>{t('Recarregar descartando rascunhos')}</button>}
        {plugins.inventory.developerMode && (view.plugin.source ?? 'legacy') === 'legacy' && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.link(view.plugin.manifest.id)}>{t('Vincular pasta original')}</button>}
        {view.recoveryRequired && view.plugin.enabled && <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.discardAndDisable(view)}>{t('Descartar rascunhos e desativar')}</button>}
        <button className="ui-button tool-button" disabled={plugins.busy} onClick={() => plugins.remove(view.plugin.manifest.id)}>{t('Remover')}</button></div>
    </li>)}</ul>
  </section>
}
