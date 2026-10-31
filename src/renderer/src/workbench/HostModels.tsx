import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface PropertiesModel { name: string; density: 'compact' | 'comfortable'; details: boolean }
const initial: PropertiesModel = { name: 'Meu espaço de trabalho', density: 'compact', details: true }
const HostModels = createContext({ properties: initial, updateProperties(_patch: Partial<PropertiesModel>) {} })
/** Native model state is independent of placement/session history. A preview or
 * another eligible view reads this same model; mounting a view executes nothing.
 */
export function HostModelsProvider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState(initial)
  return <HostModels value={{ properties, updateProperties(patch) { setProperties(value => ({ ...value, ...patch })) } }}>{children}</HostModels>
}
export const useHostModels = () => useContext(HostModels)
