//! Clearance, validity and candidate rectangles (`clearance.ts`, `geometry.ts`,
//! `settlement.ts`).
use super::policy::{GAP, MAX_WIDGETS, surface_limit};
use super::types::{Bounds, Constraint, Constraints, Direction, Gesture, Placement, Size, Surface};
use crate::js;

/// Geometry tolerance of validity checks.
pub const EPSILON: f64 = 1e-7;
/// Tolerance of the clearance predicate (`clearance.ts`).
const CLEARANCE_EPSILON: f64 = 1e-9;

/// `Math.max(lo, Math.min(hi, n))`.
pub fn clamp(n: f64, lo: f64, hi: f64) -> f64 {
    js::max(lo, js::min(hi, n))
}

/// Exact rectangle equality.
pub fn same(a: &Bounds, b: &Bounds) -> bool {
    a.x == b.x && a.y == b.y && a.width == b.width && a.height == b.height
}

/// Manhattan distance between top-left corners.
pub fn distance(a: &Bounds, b: &Bounds) -> f64 {
    (a.x - b.x).abs() + (a.y - b.y).abs()
}

/// Projection clearance: interiors may not overlap, and when interiors overlap on one axis
/// the separating axis needs `gap`. Diagonal-only neighbours need no invented margin.
pub fn too_close(a: &Bounds, b: &Bounds, gap: Size) -> bool {
    let e = CLEARANCE_EPSILON;
    let intersects_x = a.x < b.x + b.width - e && a.x + a.width > b.x + e;
    let intersects_y = a.y < b.y + b.height - e && a.y + a.height > b.y + e;
    (intersects_x && intersects_y)
        || (intersects_y
            && a.x + a.width + gap.width > b.x + e
            && b.x + b.width + gap.width > a.x + e)
        || (intersects_x
            && a.y + a.height + gap.height > b.y + e
            && b.y + b.height + gap.height > a.y + e)
}

/// Whether two rectangles violate the 10px widget clearance.
pub fn collides(a: &Bounds, b: &Bounds) -> bool {
    too_close(a, b, Size::new(GAP, GAP))
}

/// Whether a handle may resize under a constraint.
pub fn allows_resize(d: Direction, c: &Constraint) -> bool {
    (!d.horizontal() || c.resize_x) && (!d.vertical() || c.resize_y)
}

/// Finite, non-negative, within min/max and inside the surface limit.
pub fn valid_rect(p: &Bounds, s: &Surface, c: &Constraint) -> bool {
    let limit = surface_limit(s);
    [p.x, p.y, p.width, p.height].iter().all(|v| v.is_finite())
        && p.x >= 0.0
        && p.y >= 0.0
        && p.width >= c.min.width
        && p.height >= c.min.height
        && p.width <= c.max.width
        && p.height <= c.max.height
        && p.x + p.width <= limit.width + EPSILON
        && p.y + p.height <= limit.height + EPSILON
}

/// A complete valid region layout: bounded count, unique identities, eligible constraints,
/// valid rectangles and pairwise clearance.
pub fn valid_layout(ps: &[Placement], s: &Surface, cs: &Constraints) -> bool {
    if ps.len() > MAX_WIDGETS {
        return false;
    }
    for (i, p) in ps.iter().enumerate() {
        if ps[..i].iter().any(|q| q.id == p.id) {
            return false;
        }
    }
    ps.iter().enumerate().all(|(i, p)| {
        cs.get(&p.id).is_some_and(|c| {
            c.allows(s.region)
                && p.region == s.region
                && valid_rect(&p.bounds(), s, c)
                && ps[i + 1..]
                    .iter()
                    .all(|q| !collides(&p.bounds(), &q.bounds()))
        })
    })
}

/// The requested rectangle of a pointer delta. Opposite edges remain anchored and deltas
/// stay unrounded. Returns `None` for a non-finite delta (the reference throws).
pub fn candidate(
    p: &Placement,
    dx: f64,
    dy: f64,
    kind: Gesture,
    s: &Surface,
    c: &Constraint,
) -> Option<Bounds> {
    use super::types::Region;
    if !dx.is_finite() || !dy.is_finite() {
        return None;
    }
    let limit = surface_limit(s);
    let mut next = p.bounds();
    let direction = match kind {
        Gesture::Move | Gesture::Insert => {
            next.x = if s.region == Region::Sidebar {
                0.0
            } else {
                clamp(p.x + dx, 0.0, limit.width - p.width)
            };
            next.y = if s.region == Region::Bottom {
                0.0
            } else {
                clamp(p.y + dy, 0.0, limit.height - p.height)
            };
            return Some(next);
        }
        Gesture::Resize(d) => d,
    };
    // At the gesture origin, avoid a fractional far-edge round trip that would miss exact
    // snapshot equality and keep a prior alignment lock active.
    if dx == 0.0 && dy == 0.0 {
        return Some(next);
    }
    if !allows_resize(direction, c) {
        return Some(next);
    }
    if kind.has('e') {
        next.width = clamp(
            p.width + dx,
            c.min.width,
            js::min(c.max.width, limit.width - p.x),
        );
    }
    if kind.has('w') {
        next.width = clamp(
            p.width - dx,
            c.min.width,
            js::min(c.max.width, p.x + p.width),
        );
        next.x = p.x + p.width - next.width;
    }
    if kind.has('s') {
        next.height = clamp(
            p.height + dy,
            c.min.height,
            js::min(c.max.height, limit.height - p.y),
        );
    }
    if kind.has('n') {
        next.height = clamp(
            p.height - dy,
            c.min.height,
            js::min(c.max.height, p.y + p.height),
        );
        next.y = p.y + p.height - next.height;
    }
    Some(next)
}

/// Accepts actual geometry as the next automatic size baseline (`settlePlacements`).
/// Returns whether any placement changed.
pub fn settle_placements(placements: &mut [Placement]) -> bool {
    let mut changed = false;
    for p in placements {
        if p.preferred.width != p.width || p.preferred.height != p.height {
            p.preferred = p.size();
            changed = true;
        }
    }
    changed
}
