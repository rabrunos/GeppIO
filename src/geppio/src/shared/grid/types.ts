/** Integer geometry only: no rendering, content or plugin authority. */
export interface GridSize { w: number; h: number }
export interface GridRect extends GridSize { x: number; y: number }
export interface GridPlacement extends GridRect { id: string; preferred: GridSize }
export interface GridBounds { columns: number; rows: number }
export interface GridConstraint { min: GridSize; max: GridSize; resizeX: boolean; resizeY: boolean }
export type GridConstraints = Readonly<Record<string, GridConstraint>>
export type Direction = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const DIRECTIONS: readonly Direction[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']
export interface GridSnapshot extends GridBounds { schemaVersion: 2; theme: 'dark' | 'light'; placements: GridPlacement[] }
