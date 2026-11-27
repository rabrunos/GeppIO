//! Edge, center and spacing alignment with hysteresis (`alignment.ts`). Geometry only:
//! group membership, presentation and pointer state stay outside.
use super::geometry::{collides, same, valid_rect};
use super::policy::GAP;
use super::reflow::{Budget, ReflowResult, Status, reflow};
use super::types::{Axis, Bounds, Constraints, Gesture, Placement, Region, Surface};
use crate::js;
use crate::json::js_number;

/// A candidate snaps when its delta is at most this many pixels.
pub const ALIGNMENT_ENTER: f64 = 7.0;
/// A held lock releases when its delta exceeds this many pixels.
pub const ALIGNMENT_EXIT: f64 = 14.0;

/// One possible alignment of an edge/center of the active rectangle with a peer.
#[derive(Clone, Debug, PartialEq)]
pub struct AlignmentCandidate {
    /// Stable lock key (`peer:axis:own:target[:gap]`).
    pub key: String,
    /// Axis of the alignment.
    pub axis: Axis,
    /// Peer identity.
    pub peer: String,
    /// Fraction of the active rectangle (0 start, 0.5 center, 1 end).
    pub own: f64,
    /// Fraction of the peer.
    pub target: f64,
    /// Signed travel needed to align.
    pub delta: f64,
    /// Aligned line coordinate.
    pub line: f64,
    /// Pair priority (lower wins ties).
    pub priority: usize,
    /// Spacing offset (0, +gap or −gap).
    pub offset: f64,
}

/// Held alignment lock keys per axis.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AlignmentLocks {
    /// Horizontal lock.
    pub x: Option<String>,
    /// Vertical lock.
    pub y: Option<String>,
}

impl AlignmentLocks {
    fn get(&self, axis: Axis) -> Option<&str> {
        match axis {
            Axis::X => self.x.as_deref(),
            Axis::Y => self.y.as_deref(),
        }
    }
    fn set(&mut self, axis: Axis, key: String) {
        match axis {
            Axis::X => self.x = Some(key),
            Axis::Y => self.y = Some(key),
        }
    }
}

/// Visual guide kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuideKind {
    /// Edge or center alignment.
    Alignment,
    /// Gap-spaced alignment.
    Spacing,
}

impl GuideKind {
    /// `'alignment' | 'spacing'`.
    pub fn as_str(self) -> &'static str {
        match self {
            GuideKind::Alignment => "alignment",
            GuideKind::Spacing => "spacing",
        }
    }
}

/// A guide line to draw for an accepted alignment.
#[derive(Clone, Debug, PartialEq)]
pub struct AlignmentGuide {
    /// Axis of the line coordinate.
    pub axis: Axis,
    /// Line coordinate (peer line plus offset).
    pub line: f64,
    /// Start along the cross axis.
    pub from: f64,
    /// End along the cross axis.
    pub to: f64,
    /// Peer identity.
    pub peer: String,
    /// Alignment or spacing.
    pub kind: GuideKind,
    /// The peer's own edge/center coordinate.
    pub peer_line: f64,
    /// Absolute spacing offset.
    pub gap: f64,
}

/// Result of [`aligned_gesture`].
#[derive(Clone, Debug, PartialEq)]
pub struct AlignedGesture {
    /// The accepted solve (counters include every attempted solve).
    pub result: ReflowResult,
    /// Locks to carry into the next frame of the same gesture.
    pub locks: AlignmentLocks,
    /// Guides of the accepted alignment.
    pub guides: Vec<AlignmentGuide>,
}

fn point(p: &Bounds, axis: Axis, fraction: f64) -> f64 {
    p.start(axis) + p.extent(axis) * fraction
}

/// Every alignment candidate of `rect` against `peers` on `axes`.
pub fn alignment_candidates(
    rect: &Bounds,
    peers: &[Placement],
    kind: Gesture,
    axes: &[Axis],
) -> Vec<AlignmentCandidate> {
    let mut pairs: Vec<(f64, f64, f64)> = vec![
        (0.0, 0.0, 0.0),
        (1.0, 1.0, 0.0),
        (0.5, 0.5, 0.0),
        (0.0, 1.0, 0.0),
        (1.0, 0.0, 0.0),
        (0.0, 1.0, GAP),
        (1.0, 0.0, -GAP),
    ];
    let moving = kind == Gesture::Move;
    if !moving {
        pairs.splice(5..5, [(0.0, 0.5, 0.0), (1.0, 0.5, 0.0)]);
    }
    let mut out = Vec::new();
    for peer in peers {
        let pb = peer.bounds();
        for &axis in axes {
            for (priority, &(own, target, offset)) in pairs.iter().enumerate() {
                if !moving && own == 0.5 {
                    continue;
                }
                if !moving {
                    let edge = match (axis, own == 0.0) {
                        (Axis::X, true) => 'w',
                        (Axis::X, false) => 'e',
                        (Axis::Y, true) => 'n',
                        (Axis::Y, false) => 's',
                    };
                    if !kind.has(edge) {
                        continue;
                    }
                }
                let line = point(&pb, axis, target) + offset;
                let delta = line - point(rect, axis, own);
                let key = format!(
                    "{}:{}:{}:{}{}",
                    peer.id,
                    axis.as_str(),
                    js_number(own),
                    js_number(target),
                    if offset != 0.0 { ":gap" } else { "" }
                );
                out.push(AlignmentCandidate {
                    key,
                    axis,
                    peer: peer.id.clone(),
                    own,
                    target,
                    delta,
                    line,
                    priority,
                    offset,
                });
            }
        }
    }
    out
}

fn apply_delta(rect: &Bounds, candidate: &AlignmentCandidate, kind: Gesture) -> Bounds {
    let mut next = *rect;
    let axis = candidate.axis;
    if kind == Gesture::Move {
        *next.start_mut(axis) += candidate.delta;
    } else if candidate.own == 0.0 {
        *next.start_mut(axis) += candidate.delta;
        *next.extent_mut(axis) -= candidate.delta;
    } else {
        *next.extent_mut(axis) += candidate.delta;
    }
    next
}

/// Chooses at most one candidate per axis: a held lock within [`ALIGNMENT_EXIT`], else the
/// nearest entering candidate within [`ALIGNMENT_ENTER`]. Returns the snapped rectangle,
/// the new locks and the chosen candidates.
pub fn resolve_alignment(
    rect: &Bounds,
    peers: &[Placement],
    previous: &AlignmentLocks,
    kind: Gesture,
    axes: &[Axis],
) -> (Bounds, AlignmentLocks, Vec<AlignmentCandidate>) {
    // A candidate must keep clearance from its own anchor: a held opposite edge cannot
    // turn a normal gap into zero-gap contact and mask a nearby compatible edge.
    let candidates: Vec<AlignmentCandidate> = alignment_candidates(rect, peers, kind, axes)
        .into_iter()
        .filter(|candidate| {
            let peer = peers
                .iter()
                .find(|peer| peer.id == candidate.peer)
                .expect("candidates come from peers");
            !collides(&apply_delta(rect, candidate, kind), &peer.bounds())
        })
        .collect();
    let mut locks = AlignmentLocks::default();
    let mut chosen: Vec<AlignmentCandidate> = Vec::new();
    for axis in [Axis::X, Axis::Y] {
        let held = previous.get(axis).and_then(|key| {
            candidates
                .iter()
                .find(|c| c.key == key && c.delta.abs() <= ALIGNMENT_EXIT)
        });
        let mut entered: Vec<&AlignmentCandidate> = candidates
            .iter()
            .filter(|c| c.axis == axis && c.delta.abs() <= ALIGNMENT_ENTER)
            .collect();
        entered.sort_by(|a, b| {
            js::order(a.delta.abs() - b.delta.abs())
                .then_with(|| a.priority.cmp(&b.priority))
                .then_with(|| js::cmp_utf16(&a.peer, &b.peer))
        });
        if let Some(candidate) = held.or(entered.first().copied()) {
            chosen.push(candidate.clone());
            locks.set(axis, candidate.key.clone());
        }
    }
    let mut snapped = *rect;
    for candidate in &chosen {
        snapped = apply_delta(&snapped, candidate, kind);
    }
    (snapped, locks, chosen)
}

/// [`aligned_gesture`] for a move.
pub fn aligned_move(
    source: &[Placement],
    id: &str,
    requested: Bounds,
    surface: &Surface,
    cs: &Constraints,
    previous: &AlignmentLocks,
    budget: Budget,
) -> AlignedGesture {
    aligned_gesture(
        source,
        id,
        requested,
        surface,
        cs,
        Gesture::Move,
        previous,
        budget,
    )
}

/// Solves the ordinary request first, then spends only the remaining budget on a snapped
/// variant. A rejected or invalid snap cannot consume the ordinary solution.
#[allow(clippy::too_many_arguments)] // Mirrors the reference signature.
pub fn aligned_gesture(
    source: &[Placement],
    id: &str,
    requested: Bounds,
    surface: &Surface,
    cs: &Constraints,
    kind: Gesture,
    previous: &AlignmentLocks,
    budget: Budget,
) -> AlignedGesture {
    let ordinary = reflow(source, id, requested, surface, cs, kind, budget);
    if kind != Gesture::Move
        && source
            .iter()
            .any(|p| p.id == id && same(&p.bounds(), &requested))
    {
        return AlignedGesture {
            result: ordinary,
            locks: AlignmentLocks::default(),
            guides: Vec::new(),
        };
    }
    let constraint = cs.get(id);
    let axes: Vec<Axis> = [Axis::X, Axis::Y]
        .into_iter()
        .filter(|&axis| {
            let excluded = match axis {
                Axis::X => Region::Sidebar,
                Axis::Y => Region::Bottom,
            };
            surface.region != excluded
                && (kind == Gesture::Move
                    || (constraint.is_some_and(|c| match axis {
                        Axis::X => c.resize_x,
                        Axis::Y => c.resize_y,
                    }) && match axis {
                        Axis::X => kind.name().contains(['e', 'w']),
                        Axis::Y => kind.name().contains(['n', 's']),
                    }))
        })
        .collect();
    let peers: Vec<Placement> = source.iter().filter(|p| p.id != id).cloned().collect();
    let (_, _, proposal) = resolve_alignment(&requested, &peers, previous, kind, &axes);
    let mut usage = (ordinary.probes, ordinary.states, ordinary.candidates);
    let variants: Vec<Vec<AlignmentCandidate>> = if proposal.len() == 2 {
        let mut v = vec![proposal.clone()];
        v.extend(proposal.iter().map(|c| vec![c.clone()]));
        v
    } else {
        vec![proposal.clone()]
    };
    for chosen in variants {
        let Some(constraint) = constraint else {
            continue;
        };
        if chosen.is_empty() || usage.0 >= budget.probes || usage.1 >= budget.states {
            continue;
        }
        let mut rect = requested;
        for candidate in &chosen {
            rect = apply_delta(&rect, candidate, kind);
        }
        if !valid_rect(&rect, surface, constraint) {
            continue;
        }
        let trial = reflow(
            source,
            id,
            rect,
            surface,
            cs,
            kind,
            Budget {
                probes: budget.probes - usage.0,
                states: budget.states - usage.1,
            },
        );
        usage.0 += trial.probes;
        usage.1 += trial.states;
        usage.2 += trial.candidates;
        let Some(active) = trial.placements.iter().find(|p| p.id == id) else {
            continue;
        };
        let ab = active.bounds();
        let aligned = trial.status == Status::Valid
            && chosen.iter().all(|candidate| {
                trial
                    .placements
                    .iter()
                    .find(|p| p.id == candidate.peer)
                    .is_some_and(|peer| {
                        (point(&ab, candidate.axis, candidate.own)
                            - point(&peer.bounds(), candidate.axis, candidate.target)
                            - candidate.offset)
                            .abs()
                            < 0.01
                    })
            });
        if !aligned {
            continue;
        }
        let guides = chosen
            .iter()
            .map(|candidate| {
                let peer = trial
                    .placements
                    .iter()
                    .find(|p| p.id == candidate.peer)
                    .expect("aligned peers exist");
                let pb = peer.bounds();
                let cross = candidate.axis.cross();
                let peer_line = point(&pb, candidate.axis, candidate.target);
                AlignmentGuide {
                    axis: candidate.axis,
                    line: peer_line + candidate.offset,
                    peer_line,
                    kind: if candidate.offset != 0.0 {
                        GuideKind::Spacing
                    } else {
                        GuideKind::Alignment
                    },
                    gap: candidate.offset.abs(),
                    from: js::min(ab.start(cross), pb.start(cross)),
                    to: js::max(
                        ab.start(cross) + ab.extent(cross),
                        pb.start(cross) + pb.extent(cross),
                    ),
                    peer: peer.id.clone(),
                }
            })
            .collect();
        let mut locks = AlignmentLocks::default();
        for candidate in &chosen {
            locks.set(candidate.axis, candidate.key.clone());
        }
        let mut result = trial;
        result.probes = usage.0;
        result.states = usage.1;
        result.candidates = usage.2;
        return AlignedGesture {
            result,
            locks,
            guides,
        };
    }
    let mut result = ordinary;
    result.probes = usage.0;
    result.states = usage.1;
    result.candidates = usage.2;
    AlignedGesture {
        result,
        locks: AlignmentLocks::default(),
        guides: Vec::new(),
    }
}
