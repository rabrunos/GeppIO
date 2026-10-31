import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { messages } from './messages.ts'
import { appMessages } from './app-messages.ts'

type Preference = 'auto' | 'pt-BR' | 'en'
function detect() { return navigator.languages.find(language => /^(pt|en)(-|$)/i.test(language))?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en' }
const Locale = createContext({ locale: 'pt-BR', preference: 'auto' as Preference, setPreference(_value: Preference) {}, t: (key: string, ...params: (string | number)[]) => key.replace(/\{(\d+)\}/g, (_, index: string) => String(params[Number(index)] ?? '')) })
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(() => { try { const value = localStorage.getItem('geppio.locale'); return value === 'pt-BR' || value === 'en' ? value : 'auto' } catch { return 'auto' } })
  const [browser, setBrowser] = useState(detect), locale = preference === 'auto' ? browser : preference
  useEffect(() => { const changed = () => setBrowser(detect()); window.addEventListener('languagechange', changed); return () => window.removeEventListener('languagechange', changed) }, [])
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  return <Locale value={{ locale, preference, setPreference(value) { setPreference(value); try { localStorage.setItem('geppio.locale', value) } catch { /* Session preference remains usable. */ } },
    t(key, ...params) { return (locale === 'en' ? messages[key] ?? appMessages[key] ?? key : key).replace(/\{(\d+)\}/g, (_, index: string) => String(params[Number(index)] ?? '')) } }}>{children}</Locale>
}
export const useLocale = () => useContext(Locale)
export function LanguageChoice() {
  const { preference, setPreference, t } = useLocale()
  return <select data-locale-select className="ui-input" aria-label={t('Idioma da interface')} value={preference} onChange={event => setPreference(event.target.value as Preference)}><option value="auto">{t('Idioma do navegador')}</option><option value="pt-BR">Português (Brasil)</option><option value="en">English</option></select>
}
