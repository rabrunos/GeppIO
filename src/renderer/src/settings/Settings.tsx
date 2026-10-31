import { useLocale } from '../workbench/Locale.tsx';
import { useRef, useState } from 'react';
import { CheckIcon, MoonIcon, SunIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { IconButton, useModalDialog } from '../workbench/Primitives.tsx';
import { PluginSettings } from '../Plugins.tsx';
import type { usePlugins } from '../Plugins.tsx';
import type { Transaction } from '../freeform/useTransaction.ts';
import type { PanelState, Anchor, Presentation } from '../workbench/TestPanel.tsx';
import { useScrollState } from '../workbench/ScrollArea.tsx';
import { LanguageChoice } from '../workbench/Locale.tsx';
export function Settings({ plugins, close, tx, panel, setPanel, expanded, setExpanded, theme, toggleTheme, snap, setSnap }: {
    plugins: ReturnType<typeof usePlugins>;
    close(): void;
    tx: Transaction;
    panel: PanelState;
    setPanel(value: PanelState): void;
    expanded: boolean;
    setExpanded(value: boolean): void;
    theme: string; toggleTheme(): void; snap: boolean; setSnap(value: boolean): void;
}) {
    const { t } = useLocale(), [advanced, setAdvanced] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    useModalDialog(dialog, close, '.profile-theme-option[aria-pressed="true"]');
    useScrollState(dialog);
    return <dialog ref={dialog} className={'profile-dialog ui-scrollbar ' + (advanced ? 'host-development-settings' : '')} data-testid="plugin-settings" onCancel={close} aria-labelledby="settings-title">
    <header className="profile-dialog-heading"><h2 id="settings-title">{t('Configurações')}</h2><IconButton className="profile-dialog-close" label="Fechar configurações" onClick={close}><XMarkIcon className="icon" /></IconButton></header>
    <div hidden={advanced}><p className="profile-dialog-description">{t('Deixe o GeppIO com a sua cara.')}</p><fieldset className="profile-appearance"><legend>{t('Aparência')}</legend><p>{t('Escolha o tema do seu espaço de trabalho.')}</p><div className="profile-theme-options">{(['light', 'dark'] as const).map(value => <button key={value} className="ui-button profile-theme-option" aria-pressed={theme === value} onClick={() => { if (theme !== value) toggleTheme() }}>{value === 'light' ? <SunIcon className="icon" /> : <MoonIcon className="icon" />}<span>{t(value === 'light' ? 'Claro' : 'Escuro')}</span><CheckIcon className="icon profile-theme-check" /></button>)}</div></fieldset><fieldset className="profile-appearance profile-resize-options"><legend>{t('Redimensionamento')}</legend><label className="workspace-switch-row"><span>{t('Guia e encaixe no centro')}</span><input className="workspace-switch" type="checkbox" role="switch" checked={snap} onChange={event => setSnap(event.target.checked)} /></label><p>{t('Mostra a guia e encaixa suavemente as colunas da área principal e da barra inferior em 50%.')}</p></fieldset><fieldset className="profile-appearance"><legend>{t('Idioma')}</legend><p>{t('O idioma do navegador é usado por padrão.')}</p><LanguageChoice /></fieldset><div className="workspace-dialog-actions"><button className="ui-button workspace-text-action" onClick={() => setAdvanced(true)}>{t('Desenvolvimento e recuperação')}</button></div></div>
    <div hidden={!advanced}><button className="ui-button workspace-text-action" onClick={() => setAdvanced(false)}>{t('Voltar às configurações')}</button><section className="development-settings" aria-label={t("Desenvolvimento")}><h3>{t("Desenvolvimento")}</h3>
      <label><input type="checkbox" checked={expanded} onChange={event => setExpanded(event.target.checked)}/>{t("Ativar expans\u00E3o horizontal")}</label>
      <p role="status">{t("A prefer\u00EAncia \u00E9 independente das posi\u00E7\u00F5es. Sidebar mant\u00E9m a organiza\u00E7\u00E3o vertical.")} {t(tx.message)}</p>
      {tx.choices.map(choice => <button key={choice.kind} className="ui-button tool-button" disabled={tx.editing} onClick={() => { tx.historical(choice); close(); }}>{t('Prévia: {0}', t(choice.label))}</button>)}
      {tx.previous !== null && <button className="ui-button tool-button" disabled={tx.editing} onClick={() => { tx.adoptPrevious(); close(); }}>{t("Pr\u00E9via: layout livre anterior")}</button>}
      <button className="ui-button tool-button" onClick={() => { tx.resetPreview(); close(); }}>{t("Pr\u00E9via da composi\u00E7\u00E3o inicial")}</button>
      <label className="import-layout">{t("Importar layout")}<input type="file" accept=".json,application/json" disabled={tx.editing} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void tx.importFile(file); close(); }}/></label>
      <div className="presentation-options"><span>{t("Painel de teste")}</span><select aria-label={t("Apresenta\u00E7\u00E3o do painel")} value={panel.presentation} disabled={tx.editing} onChange={e => {
            const presentation = e.target.value as Presentation;
            setPanel({ ...panel, presentation, anchor: presentation === 'docked' && panel.anchor === 'floating' ? 'bottom' : panel.anchor });
        }}><option value="overlay">{t("Overlay")}</option><option value="docked">{t("Docked")}</option></select>
        <select aria-label={t("Borda do painel")} value={panel.anchor} disabled={tx.editing} onChange={e => setPanel({ ...panel, anchor: e.target.value as Anchor })}><option value="bottom">{t("Inferior")}</option><option value="top">{t("Superior")}</option><option value="left">{t("Esquerda")}</option><option value="right">{t("Direita")}</option>{panel.presentation === 'overlay' && <option value="floating">{t("Flutuante")}</option>}</select>
        <button className="ui-button tool-button" disabled={tx.editing} onClick={() => { setPanel({ ...panel, open: !panel.open }); close(); }}>{t(panel.open ? 'Recolher' : 'Abrir painel')}</button>
      </div>
    </section><PluginSettings plugins={plugins}/></div>
  </dialog>;
}
