import { createContext, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LocalSessionState } from '../../../shared/workbench/model.ts'

type PropertiesModel = LocalSessionState['properties']
const initial: PropertiesModel = { name: 'Meu espaço de trabalho', density: 'compact', details: true }
const HostModels = createContext({ properties: initial, updateProperties(_patch: Partial<PropertiesModel>) {}, replaceProperties(_value: PropertiesModel) {}, registerHistory(_handler: ((value: PropertiesModel) => void) | null) {} })
/** Native model identity is independent of placement. Editing can record typed
 * reversible values; another view/preview reads this store and executes nothing.
 */
export function HostModelsProvider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState(initial)
  const live = useRef(properties), history = useRef<((value: PropertiesModel) => void) | null>(null)
  live.current = properties
  return <HostModels value={{ properties, updateProperties(patch) {
    const next = { ...live.current, ...patch }; live.current = next
    if (history.current) history.current(next); else setProperties(next)
  }, replaceProperties(value) { live.current = value; setProperties(value) }, registerHistory(handler) { history.current = handler } }}>{children}</HostModels>
}
export const useHostModels = () => useContext(HostModels)
