import type { TabArrangement } from '../../../shared/workspace.ts'

export type GroupIndex = 0 | 1
export const oppositeGroup = (group: GroupIndex): GroupIndex => group === 0 ? 1 : 0

interface Group { tabs: string[]; selected: string | null }
const empty = (): Group => ({ tabs: [], selected: null })

/** Presentation membership only. The document registry owns drafts, limits and grants. */
export class EditorGroups {
  readonly sides: [Group, Group] = [empty(), empty()]
  active: GroupIndex = 0
  split = false
  ratio = 0.5
  readonly pinned = new Set<string>()
  snapshot(): TabArrangement<string> {
    return { active: this.active, split: this.split, sides: [[...this.sides[0].tabs], [...this.sides[1].tabs]],
      selected: [this.sides[0].selected, this.sides[1].selected], pinned: [...this.pinned] }
  }
  restore(value: TabArrangement<string>) {
    this.active = value.active; this.split = value.split; this.pinned.clear()
    value.pinned.forEach(id => this.pinned.add(id))
    for (const side of [0, 1] as const) this.sides[side] = { tabs: [...value.sides[side]], selected: value.selected[side] }
  }
  reorder(side: GroupIndex, id: string, index: number) {
    const tabs = this.sides[side].tabs, from = tabs.indexOf(id)
    if (!Number.isInteger(index) || index < 0 || index >= tabs.length || from < 0 || from === index) return false
    tabs.splice(from, 1); tabs.splice(index, 0, id); return true
  }

  sync(ids: readonly string[], selected: string | null) {
    for (const id of this.pinned) if (!ids.includes(id)) this.pinned.delete(id)
    for (const group of this.sides) {
      group.tabs = group.tabs.filter(id => ids.includes(id))
      if (group.selected && !group.tabs.includes(group.selected)) group.selected = group.tabs[0] ?? null
    }
    const focused = this.sides[this.active]
    for (const id of ids) if (!this.sides.some(group => group.tabs.includes(id))) focused.tabs.push(id)
    if (selected && ids.includes(selected)) {
      if (!focused.tabs.includes(selected)) focused.tabs.push(selected)
      focused.selected = selected
    }
  }
  remove(side: GroupIndex, id: string) {
    const group = this.sides[side], index = group.tabs.indexOf(id)
    if (index < 0) return
    group.tabs.splice(index, 1)
    if (group.selected === id) group.selected = group.tabs[Math.max(0, index - 1)] ?? null
  }
  send(id: string, move: boolean) {
    const source = this.active, destination = oppositeGroup(source)
    this.split = true
    if (move) this.remove(source, id)
    const group = this.sides[destination]
    if (!group.tabs.includes(id)) group.tabs.push(id)
    group.selected = id
    this.active = destination
  }
  merge() {
    const selected = this.sides[this.active].selected
    this.sides[0].tabs = [...new Set([...this.sides[0].tabs, ...this.sides[1].tabs])]
    this.sides[0].selected = selected ?? this.sides[0].tabs[0] ?? null
    this.sides[1] = empty()
    this.split = false
    this.active = 0
  }
}
