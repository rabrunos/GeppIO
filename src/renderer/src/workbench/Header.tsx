import { AdjustmentsHorizontalIcon, CheckIcon, ChevronRightIcon, CubeTransparentIcon, MoonIcon, PencilSquareIcon, SunIcon } from '@heroicons/react/24/outline'
import { IDENTITY } from '../../../shared/identity.ts'
export function Header({ editing, theme, openSettings, toggleTheme, begin, cancel, save, recovery }: {
  editing: boolean; theme: 'dark' | 'light'; openSettings(): void; toggleTheme(): void; begin(): void; cancel(): void; save(): void; recovery: boolean
}) {
  return <header className="workbench-header">
    <div className="brand"><span className="brand-icon"><CubeTransparentIcon className="size-6" /></span><div><strong>{IDENTITY.name}</strong><small>LABORATÓRIO DE WORKSPACE</small></div></div>
    <div className="project-context"><span>Projeto local</span><ChevronRightIcon className="size-3" /><strong>Laboratório</strong><span className="badge">plugins locais</span></div>
    <div className="header-actions"><span className="version">{window.geppio?.version ?? __APP_VERSION__}</span><button className="icon-button" onClick={toggleTheme} aria-label="Alternar tema">{theme === 'dark' ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}</button>
      <button className="button" onClick={openSettings} aria-label="Abrir configurações"><AdjustmentsHorizontalIcon className="size-4" />Configurações</button>
      {!editing ? <button className="button primary" disabled={recovery} onClick={begin} data-testid="edit-layout"><PencilSquareIcon className="size-4" />Editar layout</button>
        : <><button className="button" onClick={cancel} data-testid="cancel-layout">Cancelar</button><button className="button primary" onClick={save} data-testid="save-layout"><CheckIcon className="size-4" />Salvar layout</button></>}
    </div>
  </header>
}
