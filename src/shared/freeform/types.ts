/** CSS-pixel geometry. Fractional values are intentional; there is no cell topology. */
export interface Size { width: number; height: number }
export interface Rect extends Size { x: number; y: number }
export type Region = 'main' | 'sidebar' | 'bottom'
export const REGIONS: readonly Region[] = ['main', 'sidebar', 'bottom']
export type Direction = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const DIRECTIONS: readonly Direction[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']
export interface Placement extends Rect { id: string; region: Region; preferred: Size }
export interface Constraint {
  min: Size; default: Size; max: Size; resizeX: boolean; resizeY: boolean;
  regions: readonly Region[]; overflow: 'auto'; responsive: 'region'
}
export type Constraints = Readonly<Record<string, Constraint>>
export type References = Record<Region, Size>
export interface Snapshot {
  schemaVersion: 1; engine: 'freeform'; constraintVersion: 1;
  reference: References; placements: Placement[]
}
export interface Surface extends Size { region: Region; expanded: boolean }
