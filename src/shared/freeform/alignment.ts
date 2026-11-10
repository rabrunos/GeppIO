import { reflow } from './reflow.ts'
import { collides, validRect } from './geometry.ts'
import type { Constraints, Placement, Rect, Surface } from './types.ts'
export const ALIGNMENT_ENTER = 7, ALIGNMENT_EXIT = 14
type Axis = 'x' | 'y'
export interface AlignmentCandidate { key: string; axis: Axis; peer: string; own: number; target: number; delta: number; line: number; priority: number }
export type AlignmentLocks = Partial<Record<Axis, string>>
export interface AlignmentGuide { axis: Axis; line: number; from: number; to: number; peer: string }
const point = (p: Rect, axis: Axis, fraction: number) => p[axis] + (axis === 'x' ? p.width : p.height) * fraction
/** Geometry only: group membership, presentation and pointer state stay outside. */
export function alignmentCandidates(rect: Rect, peers: readonly Placement[]): AlignmentCandidate[] {
  const pairs = [[0, 0], [1, 1], [.5, .5], [0, 1], [1, 0]] as const
  return peers.flatMap(peer => (['x', 'y'] as const).flatMap(axis => pairs.map(([own, target], priority) => {
    const line = point(peer, axis, target), delta = line - point(rect, axis, own)
    return { key: `${peer.id}:${axis}:${own}:${target}`, axis, peer: peer.id, own, target, delta, line, priority }
  })))
}
export function resolveAlignment(rect: Rect, peers: readonly Placement[], previous: AlignmentLocks = {}) {
  // A candidate must keep clearance from its own anchor. In particular, a held
  // opposite edge cannot turn a normal gap into zero-gap contact and mask a
  // nearby compatible edge. Other peers still go through ordinary reflow.
  const candidates = alignmentCandidates(rect, peers).filter(candidate => {
    const peer = peers.find(peer => peer.id === candidate.peer)!, next = { ...rect }
    next[candidate.axis] += candidate.delta
    return !collides(next, peer)
  }), locks: AlignmentLocks = {}, chosen: AlignmentCandidate[] = []
  for (const axis of ['x', 'y'] as const) {
    const held = candidates.find(candidate => candidate.key === previous[axis] && Math.abs(candidate.delta) <= ALIGNMENT_EXIT)
    const entered = candidates.filter(candidate => candidate.axis === axis && Math.abs(candidate.delta) <= ALIGNMENT_ENTER)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.priority - b.priority || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0))
    const candidate = held ?? entered[0]
    if (candidate) { chosen.push(candidate); locks[axis] = candidate.key }
  }
  const snapped = { ...rect }
  for (const candidate of chosen) snapped[candidate.axis] += candidate.delta
  return { rect: snapped, locks, chosen }
}
/** Preserve the ordinary solution first, then spend only the remaining operation
 * budget on a snap. A rejected/invalid snap cannot consume the fallback solution.
 */
export function alignedMove(source: readonly Placement[], id: string, requested: Rect, surface: Surface, cs: Constraints, previous: AlignmentLocks = {}, budget = { probes: 8192, states: 2048 }) {
  const ordinary = reflow(source, id, requested, surface, cs, 'move', budget)
  const peers = source.filter(p => p.id !== id), proposal = resolveAlignment(requested, peers, previous)
  const empty = { result: ordinary, locks: {} as AlignmentLocks, guides: [] as AlignmentGuide[] }
  const usage = { probes: ordinary.probes, states: ordinary.states, candidates: ordinary.candidates }
  const variants = proposal.chosen.length === 2 ? [proposal.chosen, ...proposal.chosen.map(candidate => [candidate])] : [proposal.chosen]
  for (const chosen of variants) {
    if (!chosen.length || !cs[id] || usage.probes >= budget.probes || usage.states >= budget.states) continue
    const rect = { ...requested }; for (const candidate of chosen) rect[candidate.axis] += candidate.delta
    if (!validRect(rect, surface, cs[id]!)) continue
    const trial = reflow(source, id, rect, surface, cs, 'move', { probes: budget.probes - usage.probes, states: budget.states - usage.states })
    usage.probes += trial.probes; usage.states += trial.states; usage.candidates += trial.candidates
    const active = trial.placements.find(p => p.id === id)
    const aligned = trial.status === 'valid' && active && chosen.every(candidate => {
      const peer = trial.placements.find(p => p.id === candidate.peer)
      return peer && Math.abs(point(active, candidate.axis, candidate.own) - point(peer, candidate.axis, candidate.target)) < .01
    })
    if (!aligned || !active) continue
    const guides = chosen.map(candidate => {
      const peer = trial.placements.find(p => p.id === candidate.peer)!, cross = candidate.axis === 'x' ? 'y' : 'x', size = cross === 'x' ? 'width' : 'height'
      return { axis: candidate.axis, line: point(peer, candidate.axis, candidate.target), from: Math.min(active[cross], peer[cross]), to: Math.max(active[cross] + active[size], peer[cross] + peer[size]), peer: peer.id }
    })
    return { result: { ...trial, ...usage }, locks: Object.fromEntries(chosen.map(candidate => [candidate.axis, candidate.key])) as AlignmentLocks, guides }
  }
  return { ...empty, result: { ...ordinary, ...usage } }
}
