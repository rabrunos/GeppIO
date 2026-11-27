//! Minimal region transfer route (`freeform/transfer.ts`): eligibility, a vacant seed or
//! a bounded insertion through the same solver. A failed transfer is atomic.
use super::policy::{constraint_in_region, constraints_for};
use crate::js;
use crate::layout::policy::{GAP, surface_limit};
use crate::layout::{
    Budget, Constraints, Gesture, Placement, References, Region, Size, Status, Surface, clamp,
    reflow, valid_layout,
};

/// `REGION_LABELS`.
pub fn region_label(region: Region) -> &'static str {
    match region {
        Region::Main => "Main",
        Region::Sidebar => "Sidebar",
        Region::Bottom => "Bottom",
    }
}

/// Moves `id` into `target` at `at` (default origin) with its preferred size, displacing
/// peers through the solver. Returns the new placements (snapshot order) and references.
pub fn transfer(
    placements: &[Placement],
    reference: &References,
    id: &str,
    target: &Surface,
    at: Option<(f64, f64)>,
    constraints: &Constraints,
) -> Option<(Vec<Placement>, References)> {
    let p = placements.iter().find(|p| p.id == id)?;
    let declaration = constraints.get(id)?;
    if !declaration.allows(target.region) {
        return None;
    }
    let c = constraint_in_region(declaration, target.region);
    let limit = surface_limit(target);
    let cs = constraints_for(target, constraints);
    if target.width < c.min.width
        || (target.region != Region::Sidebar && target.height < c.min.height)
    {
        return None;
    }
    let width = if target.region == Region::Sidebar {
        target.width
    } else {
        clamp(
            p.preferred.width,
            c.min.width,
            js::min(c.max.width, limit.width),
        )
    };
    let height = if target.region == Region::Bottom {
        target.height
    } else {
        clamp(
            p.preferred.height,
            c.min.height,
            js::min(c.max.height, limit.height),
        )
    };
    let (ax, ay) = at.unwrap_or((0.0, 0.0));
    let mut moved = p.clone();
    moved.region = target.region;
    moved.width = width;
    moved.height = height;
    moved.x = if target.region == Region::Sidebar {
        0.0
    } else {
        clamp(ax, 0.0, limit.width - width)
    };
    moved.y = if target.region == Region::Bottom {
        0.0
    } else {
        clamp(ay, 0.0, limit.height - height)
    };
    let peers: Vec<Placement> = placements
        .iter()
        .filter(|q| q.id != id && q.region == target.region)
        .cloned()
        .collect();
    if !valid_layout(&peers, target, &cs) {
        return None;
    }
    // Insert an initially unoccupied seed, then use the same contact solver for displacement.
    let mut seeds = vec![moved.clone()];
    for q in &peers {
        let mut right = moved.clone();
        right.x = if target.region == Region::Sidebar {
            0.0
        } else {
            q.x + q.width + GAP
        };
        let mut below = moved.clone();
        below.y = if target.region == Region::Bottom {
            0.0
        } else {
            q.y + q.height + GAP
        };
        seeds.push(right);
        seeds.push(below);
    }
    let mut budget = Budget::default();
    let accept = |solved: &[Placement]| -> (Vec<Placement>, References) {
        let mut next_reference = *reference;
        *next_reference.get_mut(target.region) = Size::new(
            target.width,
            if target.region == Region::Sidebar {
                js::max_of(
                    std::iter::once(target.height).chain(solved.iter().map(|q| q.y + q.height)),
                )
            } else {
                target.height
            },
        );
        let next = placements
            .iter()
            .map(|q| solved.iter().find(|n| n.id == q.id).unwrap_or(q).clone())
            .collect();
        (next, next_reference)
    };
    let rect = moved.bounds();
    for seed in seeds {
        let mut trial = peers.clone();
        trial.push(seed);
        if !valid_layout(&trial, target, &cs) {
            continue;
        }
        if budget.probes <= 0 || budget.states <= 0 {
            return None;
        }
        let result = reflow(&trial, id, rect, target, &cs, Gesture::Move, budget);
        budget.probes -= result.probes;
        budget.states -= result.states;
        if result.status != Status::Valid {
            continue;
        }
        return Some(accept(&result.placements));
    }
    if budget.probes <= 0 || budget.states <= 0 {
        return None;
    }
    let mut trial = peers;
    trial.push(moved);
    let insertion = reflow(&trial, id, rect, target, &cs, Gesture::Insert, budget);
    (insertion.status == Status::Valid).then(|| accept(&insertion.placements))
}
