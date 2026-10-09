import { useRef } from 'react'
import type { GridPlacement, GridSnapshot } from '../../../shared/grid/types.ts'
import type { LayoutTransaction } from './useLayoutTransaction.ts'

/** View adapter: geometry consumes projected bounds; only explicit editing changes the source. */
export function useProjectedTransaction(tx: LayoutTransaction, snapshot: GridSnapshot) {
  const live = useRef(snapshot); live.current = snapshot
  return { ...tx, snapshot, live, source: tx.live,
    putPlacements(placements: GridPlacement[]) {
      const next = { ...live.current, placements }; live.current = next; tx.put(next)
    },
    begin() { tx.begin(live.current) }, save() { tx.save(live.current) }
  }
}
export type ProjectedTransaction = ReturnType<typeof useProjectedTransaction>
