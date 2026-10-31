import { BellIcon, ClockIcon, CloudIcon } from '@heroicons/react/24/outline'
import { useLocale } from './Locale.tsx'

/** Approved status chrome bound to host metadata; no remote sync is implied. */
export function StatusBar() {
  const { t, locale } = useLocale()
  return <footer className="status-bar fixed-status-bar" aria-label={t('Barra de estado')}><div className="status-left"><span className="status-item"><span className="status-dot" />{t('Pronto')}</span><span className="status-divider" /><span className="status-item"><CloudIcon className="icon" aria-hidden="true" />{t('Local')}</span></div><div className="status-right"><span className="status-item status-clock"><ClockIcon className="icon" aria-hidden="true" /></span><span title="GeppIO">{window.geppio?.version ?? __APP_VERSION__}</span><span className="status-divider" /><span>{locale === 'pt-BR' ? 'PT-BR' : 'EN'}</span><span className="typescript"><span className="ts-badge">TS</span>TypeScript</span><span className="status-item"><BellIcon className="icon" aria-hidden="true" /></span></div></footer>
}
