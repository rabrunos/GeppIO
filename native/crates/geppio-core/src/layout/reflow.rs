//! Bounded continuous reflow (`reflow.ts`): complete-solution ranking, forward push,
//! impacted-axis compression, preferred contact slots and bounded rearrangement. Phase
//! order, budgets, ranking tuples and the `states`/`probes`/`candidates` counters are
//! identical to the reference.
use std::collections::HashSet;

use super::geometry::{EPSILON, allows_resize, collides, distance, same, valid_layout, valid_rect};
use super::policy::{GAP, MAX_LOCAL_TRAVEL, surface_limit};
use super::types::{
    Axis, Bounds, Constraint, Constraints, Gesture, Placement, Region, Size, Surface,
};
use crate::js;
use crate::json::write_js_number;

/// Outcome status of a solve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// A complete valid layout was found (or nothing changed).
    Valid,
    /// No valid layout: the source placements are returned unchanged.
    Blocked,
}

impl Status {
    /// `'valid'` or `'blocked'`.
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Valid => "valid",
            Status::Blocked => "blocked",
        }
    }
}

/// Why a solve was blocked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockReason {
    /// The input or requested rectangle violates the contract.
    Invalid,
    /// The bounded search found no layout.
    Space,
    /// The operation budget ran out.
    Budget,
}

impl BlockReason {
    /// `'invalid' | 'space' | 'budget'`.
    pub fn as_str(self) -> &'static str {
        match self {
            BlockReason::Invalid => "invalid",
            BlockReason::Space => "space",
            BlockReason::Budget => "budget",
        }
    }
}

/// Operation budget of one solve (probes include rejected probes).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
    /// Candidate probe budget (capped at 8192).
    pub probes: i64,
    /// Visited state budget (capped at 2048, at most 512 per phase).
    pub states: i64,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            probes: 8192,
            states: 2048,
        }
    }
}

/// Result of [`reflow`].
#[derive(Clone, Debug, PartialEq)]
pub struct ReflowResult {
    /// Valid or blocked.
    pub status: Status,
    /// Every placement of the snapshot, in snapshot order.
    pub placements: Vec<Placement>,
    /// Why the solve was blocked.
    pub reason: Option<BlockReason>,
    /// Visited states.
    pub states: i64,
    /// Candidate probes, including rejected ones.
    pub probes: i64,
    /// Accepted candidates.
    pub candidates: i64,
}

impl ReflowResult {
    fn blocked(placements: Vec<Placement>, reason: BlockReason) -> Self {
        Self {
            status: Status::Blocked,
            placements,
            reason: Some(reason),
            states: 0,
            probes: 0,
            candidates: 0,
        }
    }
}

fn lex(a: &[f64], b: &[f64]) -> f64 {
    for i in 0..a.len() {
        if a[i] != b[i] {
            return a[i] - b[i];
        }
    }
    0.0
}

fn point_key(out: &mut String, b: &Bounds) {
    write_js_number(out, b.x);
    out.push(',');
    write_js_number(out, b.y);
    out.push(',');
    write_js_number(out, b.width);
    out.push(',');
    write_js_number(out, b.height);
}

/// Normalizes `-0` so that hashing matches SameValueZero/string-key equality.
fn bits(v: f64) -> u64 {
    (v + 0.0).to_bits()
}

/// Pushes `value` unless an equal (SameValueZero) value is present, like a `Set`.
fn push_unique(values: &mut Vec<f64>, value: f64) {
    if !values
        .iter()
        .any(|v| *v == value || (v.is_nan() && value.is_nan()))
    {
        values.push(value);
    }
}

/// Solves one intention: `id` requests `rect` under `gesture`; neighbours move or compress
/// within the bounded search. The snapshot is never mutated.
pub fn reflow(
    snapshot: &[Placement],
    id: &str,
    rect: Bounds,
    surface: &Surface,
    cs: &Constraints,
    gesture: Gesture,
    budget: Budget,
) -> ReflowResult {
    let unchanged = || snapshot.to_vec();
    let original = snapshot.iter().find(|p| p.id == id);
    let c = cs.get(id);
    let (Some(original), Some(c)) = (original, c) else {
        return ReflowResult::blocked(unchanged(), BlockReason::Invalid);
    };
    let insert = gesture == Gesture::Insert;
    let moving = gesture == Gesture::Move || insert;
    let peers: Vec<Placement>;
    let validated: &[Placement] = if insert {
        peers = snapshot.iter().filter(|p| p.id != id).cloned().collect();
        &peers
    } else {
        snapshot
    };
    let resize_denied = match gesture {
        Gesture::Resize(d) => !allows_resize(d, c),
        _ => false,
    };
    if (insert && snapshot.iter().filter(|p| p.id == id).count() != 1)
        || !valid_layout(validated, surface, cs)
        || !valid_rect(&rect, surface, c)
        || resize_denied
        || (moving && (rect.width != original.width || rect.height != original.height))
        || (!c.resize_x && rect.width != original.width)
        || (!c.resize_y && rect.height != original.height)
    {
        return ReflowResult::blocked(unchanged(), BlockReason::Invalid);
    }
    if !insert && same(&original.bounds(), &rect) {
        return ReflowResult {
            status: Status::Valid,
            placements: unchanged(),
            reason: None,
            states: 0,
            probes: 0,
            candidates: 0,
        };
    }
    let mut requested = original.with_bounds(rect);
    requested.preferred = if moving {
        original.preferred
    } else {
        let name = gesture.name();
        Size::new(
            if name.contains(['e', 'w']) {
                rect.width
            } else {
                original.preferred.width
            },
            if name.contains(['n', 's']) {
                rect.height
            } else {
                original.preferred.height
            },
        )
    };
    let start: Vec<Placement> = snapshot
        .iter()
        .map(|p| {
            if p.id == id {
                requested.clone()
            } else {
                p.clone()
            }
        })
        .collect();
    let dx = js::or(rect.x - original.x, rect.width - original.width);
    let dy = js::or(rect.y - original.y, rect.height - original.height);
    let axes: Vec<Axis> = match surface.region {
        Region::Sidebar => vec![Axis::Y],
        Region::Bottom => vec![Axis::X],
        Region::Main => match gesture {
            Gesture::Insert => vec![Axis::X, Axis::Y],
            Gesture::Move => vec![if dx.abs() >= dy.abs() {
                Axis::X
            } else {
                Axis::Y
            }],
            Gesture::Resize(d) => {
                let mut axes = Vec::new();
                if d.horizontal() {
                    axes.push(Axis::X);
                }
                if d.vertical() {
                    axes.push(Axis::Y);
                }
                axes
            }
        },
    };
    let mut search = Search {
        snapshot,
        id,
        surface,
        cs,
        gesture,
        limit: surface_limit(surface),
        axes,
        dx,
        dy,
        states: 0,
        probes: 0,
        candidate_count: 0,
        exhausted: false,
        max_states: 512,
        max_probes: budget.probes.min(8192),
        total_states: budget.states.min(2048),
        phase: 0,
        phase_start: 0,
        seen: HashSet::new(),
        best: None,
        best_score: None,
    };
    for phase in 0..4 {
        search.phase = phase;
        search.best = None;
        search.best_score = None;
        search.phase_start = search.states;
        search.seen.clear();
        search.visit(start.clone(), vec![id.to_owned()]);
        if let Some(best) = search.best.take() {
            let placements = search.restore(&best);
            return ReflowResult {
                status: Status::Valid,
                placements,
                reason: None,
                states: search.states,
                probes: search.probes,
                candidates: search.candidate_count,
            };
        }
        if search.probes >= search.max_probes {
            break;
        }
    }
    ReflowResult {
        status: Status::Blocked,
        reason: Some(if search.exhausted {
            BlockReason::Budget
        } else {
            BlockReason::Space
        }),
        placements: unchanged(),
        states: search.states,
        probes: search.probes,
        candidates: search.candidate_count,
    }
}

struct Search<'a> {
    snapshot: &'a [Placement],
    id: &'a str,
    surface: &'a Surface,
    cs: &'a Constraints,
    gesture: Gesture,
    limit: Size,
    axes: Vec<Axis>,
    dx: f64,
    dy: f64,
    states: i64,
    probes: i64,
    candidate_count: i64,
    exhausted: bool,
    max_states: i64,
    max_probes: i64,
    total_states: i64,
    phase: usize,
    phase_start: i64,
    seen: HashSet<String>,
    best: Option<Vec<Placement>>,
    best_score: Option<[f64; 4]>,
}

/// Per-call state of `candidates()`.
struct Probe<'p> {
    p: &'p Placement,
    constraint: &'p Constraint,
    obstacles: Vec<&'p Placement>,
    locked: Vec<&'p Placement>,
    options: Vec<Placement>,
    keys: HashSet<[u64; 4]>,
}

impl<'a> Search<'a> {
    fn original(&self, id: &str) -> &'a Placement {
        self.snapshot
            .iter()
            .find(|q| q.id == id)
            .expect("every solver placement comes from the snapshot")
    }

    fn constraint(&self, id: &str) -> &'a Constraint {
        self.cs
            .get(id)
            .expect("valid_layout guarantees a constraint for every placement")
    }

    fn score(&self, ps: &[Placement]) -> [f64; 4] {
        let (mut moved, mut travel, mut order, mut size) = (0.0, 0.0, 0.0, 0.0);
        for (i, p) in ps.iter().enumerate() {
            let old = &self.snapshot[i];
            if p.id == self.id {
                continue;
            }
            if !same(&p.bounds(), &old.bounds()) {
                moved += 1.0;
            }
            travel += distance(&p.bounds(), &old.bounds());
            size += (p.width - old.preferred.width).abs() + (p.height - old.preferred.height).abs();
            for (j, q) in self.snapshot.iter().enumerate() {
                if j <= i || q.id == self.id {
                    continue;
                }
                let other = &ps[j];
                if (old.x - q.x) * (p.x - other.x) < -EPSILON
                    || (old.y - q.y) * (p.y - other.y) < -EPSILON
                {
                    order += 1.0;
                }
            }
        }
        [moved, travel, order, size]
    }

    fn restore(&self, ps: &[Placement]) -> Vec<Placement> {
        // Restore in place first, then at nearby contact edges. Never push an unrelated
        // widget merely to recover a preference; rank shortest travel and preserve order.
        let mut next = ps.to_vec();
        let limit = self.limit;
        let surface = self.surface;
        for i in 0..next.len() {
            let mut p = next[i].clone();
            let before = self.original(&p.id);
            // Do not undo this gesture's newly required compression through a lateral
            // escape. Recovery applies to existing compression when later space frees up.
            if (before.width >= before.preferred.width && before.height >= before.preferred.height)
                || p.width < before.width - EPSILON
                || p.height < before.height - EPSILON
            {
                continue;
            }
            if p.id == self.id || (p.width >= p.preferred.width && p.height >= p.preferred.height) {
                continue;
            }
            let constraint = self.constraint(&p.id);
            let target = Size::new(
                if constraint.resize_x {
                    js::max(p.width, p.preferred.width)
                } else {
                    p.width
                },
                if constraint.resize_y {
                    js::max(p.height, p.preferred.height)
                } else {
                    p.height
                },
            );
            let xs: Vec<f64> = if surface.region == Region::Sidebar {
                vec![0.0]
            } else {
                let mut xs = vec![p.x, p.x + p.width - target.width];
                for q in next.iter().filter(|q| q.id != p.id) {
                    xs.push(q.x + q.width + GAP);
                    xs.push(q.x - target.width - GAP);
                }
                xs
            };
            let ys: Vec<f64> = if surface.region == Region::Bottom {
                vec![0.0]
            } else {
                let mut ys = vec![p.y, p.y + p.height - target.height];
                for q in next.iter().filter(|q| q.id != p.id) {
                    ys.push(q.y + q.height + GAP);
                    ys.push(q.y - target.height - GAP);
                }
                ys
            };
            let pb = p.bounds();
            let mut options: Vec<Bounds> = Vec::new();
            for &x in &xs {
                for &y in &ys {
                    let q = Bounds::new(x, y, target.width, target.height);
                    let ok = valid_rect(&q, surface, constraint)
                        && distance(&q, &pb) <= js::max(p.width, p.height) + GAP
                        && next
                            .iter()
                            .all(|other| other.id == p.id || !collides(&q, &other.bounds()))
                        && self.snapshot.iter().all(|old| {
                            old.id == p.id
                                || old.id == self.id
                                || !((p.x - old.x) * (q.x - old.x) < -EPSILON
                                    || (p.y - old.y) * (q.y - old.y) < -EPSILON)
                        });
                    if ok {
                        options.push(q);
                    }
                }
            }
            options.sort_by(|a, b| {
                js::order(distance(a, &pb) - distance(b, &pb))
                    .then_with(|| js::order(a.y - b.y))
                    .then_with(|| js::order(a.x - b.x))
            });
            if let Some(first) = options.first() {
                p.set_bounds(*first);
            } else {
                // Partial recovery can use any currently available slack without moving others.
                for axis in [Axis::X, Axis::Y] {
                    let resizable = match axis {
                        Axis::X => constraint.resize_x,
                        Axis::Y => constraint.resize_y,
                    };
                    if !resizable {
                        continue;
                    }
                    let mut lo = p.extent(axis);
                    let mut hi = js::min(target.along(axis), limit.along(axis) - p.start(axis));
                    if hi - lo <= EPSILON {
                        continue;
                    }
                    for _ in 0..40 {
                        let mid = (lo + hi) / 2.0;
                        let mut q = p.bounds();
                        *q.extent_mut(axis) = mid;
                        if valid_rect(&q, surface, constraint)
                            && next
                                .iter()
                                .all(|other| other.id == p.id || !collides(&q, &other.bounds()))
                        {
                            lo = mid;
                        } else {
                            hi = mid;
                        }
                    }
                    if (lo - target.along(axis)).abs() < EPSILON {
                        lo = target.along(axis);
                    }
                    if lo - p.extent(axis) > EPSILON {
                        match axis {
                            Axis::X => p.width = lo,
                            Axis::Y => p.height = lo,
                        }
                    }
                }
            }
            next[i] = p;
        }
        next
    }

    fn add(&mut self, probe: &mut Probe<'_>, x: f64, y: f64, size: Size) {
        if self.probes >= self.max_probes {
            self.exhausted = true;
            return;
        }
        self.probes += 1;
        if !probe
            .keys
            .insert([bits(x), bits(y), bits(size.width), bits(size.height)])
        {
            return;
        }
        let p = probe.p;
        let next = p.with_bounds(Bounds::new(x, y, size.width, size.height));
        let nb = next.bounds();
        let constraint = probe.constraint;
        if !valid_rect(&nb, self.surface, constraint)
            || (!constraint.resize_x && next.width != p.width)
            || (!constraint.resize_y && next.height != p.height)
            || (self.surface.region == Region::Sidebar && x != 0.0)
            || (self.surface.region == Region::Bottom && y != 0.0)
            || probe.locked.iter().any(|q| collides(&q.bounds(), &nb))
            || (self.phase == 2 && probe.obstacles.iter().any(|q| collides(&q.bounds(), &nb)))
        {
            return;
        }
        probe.options.push(next);
        self.candidate_count += 1;
    }

    fn candidates(&mut self, p: &Placement, ps: &[Placement], fixed: &[String]) -> Vec<Placement> {
        let constraint = self.constraint(&p.id);
        let obstacles: Vec<&Placement> = ps.iter().filter(|q| q.id != p.id).collect();
        let locked: Vec<&Placement> = obstacles
            .iter()
            .copied()
            .filter(|q| fixed.contains(&q.id))
            .collect();
        let mut probe = Probe {
            p,
            constraint,
            obstacles,
            locked,
            options: Vec::new(),
            keys: HashSet::new(),
        };
        let phase = self.phase;
        let limit = self.limit;
        if phase < 2 {
            for ai in 0..self.axes.len() {
                let axis = self.axes[ai];
                let sign = match axis {
                    Axis::X => {
                        if self.gesture.has('w') {
                            -1.0
                        } else {
                            js::or(js::sign(self.dx), 1.0)
                        }
                    }
                    Axis::Y => {
                        if self.gesture != Gesture::Insert && self.gesture.has('n') {
                            -1.0
                        } else {
                            js::or(js::sign(self.dy), 1.0)
                        }
                    }
                };
                for li in 0..probe.locked.len() {
                    let obstacle = probe.locked[li];
                    if !collides(&p.bounds(), &obstacle.bounds()) {
                        continue;
                    }
                    let position = if sign > 0.0 {
                        obstacle.start(axis) + obstacle.extent(axis) + GAP
                    } else {
                        obstacle.start(axis) - p.extent(axis) - GAP
                    };
                    let travel = position - p.start(axis);
                    if travel * sign < -EPSILON || travel.abs() > p.extent(axis) + GAP + EPSILON {
                        continue;
                    }
                    self.add(
                        &mut probe,
                        if axis == Axis::X { position } else { p.x },
                        if axis == Axis::Y { position } else { p.y },
                        p.size(),
                    );
                    let resizable = match axis {
                        Axis::X => constraint.resize_x,
                        Axis::Y => constraint.resize_y,
                    };
                    if phase == 1 && resizable {
                        let far = if sign > 0.0 {
                            p.start(axis) + p.extent(axis)
                        } else {
                            p.start(axis)
                        };
                        let size = if sign > 0.0 {
                            far - position
                        } else {
                            obstacle.start(axis) - GAP - far
                        };
                        let minimum = constraint.min.along(axis);
                        let length = js::max(minimum, size);
                        let at = if sign > 0.0 {
                            position
                        } else {
                            obstacle.start(axis) - GAP - length
                        };
                        let mut compressed = p.size();
                        *compressed.along_mut(axis) = length;
                        self.add(
                            &mut probe,
                            if axis == Axis::X { at } else { p.x },
                            if axis == Axis::Y { at } else { p.y },
                            compressed,
                        );
                    }
                }
            }
        } else {
            let preferred = Size::new(
                if constraint.resize_x {
                    js::max(p.width, p.preferred.width)
                } else {
                    p.width
                },
                if constraint.resize_y {
                    js::max(p.height, p.preferred.height)
                } else {
                    p.height
                },
            );
            let mut sizes = vec![preferred, p.size()];
            if phase != 2 {
                sizes.push(Size::new(
                    if constraint.resize_x && self.axes.contains(&Axis::X) {
                        constraint.min.width
                    } else {
                        p.width
                    },
                    if constraint.resize_y && self.axes.contains(&Axis::Y) {
                        constraint.min.height
                    } else {
                        p.height
                    },
                ));
            }
            // A thin widget must be able to leave the directly blocking rectangle. Only
            // actual contacts enlarge the local radius; remote holes never do.
            let contact = js::max_of(
                probe
                    .locked
                    .iter()
                    .filter(|q| collides(&p.bounds(), &q.bounds()))
                    .map(|q| js::max(q.width, q.height) + GAP),
            );
            let radius = js::min(
                MAX_LOCAL_TRAVEL,
                js::max(js::max(p.width, p.height) * 2.0 + GAP, contact),
            );
            for size in sizes {
                let xs: Vec<f64> = if self.surface.region == Region::Sidebar {
                    vec![0.0]
                } else {
                    let mut xs = Vec::new();
                    push_unique(&mut xs, p.x);
                    push_unique(&mut xs, 0.0);
                    push_unique(&mut xs, limit.width - size.width);
                    for q in &probe.obstacles {
                        push_unique(&mut xs, q.x);
                        push_unique(&mut xs, q.x + q.width + GAP);
                        push_unique(&mut xs, q.x - size.width - GAP);
                    }
                    xs.retain(|&x| {
                        x >= 0.0
                            && x + size.width <= limit.width + EPSILON
                            && (x - p.x).abs() <= radius
                    });
                    xs
                };
                let ys: Vec<f64> = if self.surface.region == Region::Bottom {
                    vec![0.0]
                } else {
                    let mut ys = Vec::new();
                    push_unique(&mut ys, p.y);
                    push_unique(&mut ys, 0.0);
                    push_unique(&mut ys, limit.height - size.height);
                    for q in &probe.obstacles {
                        push_unique(&mut ys, q.y);
                        push_unique(&mut ys, q.y + q.height + GAP);
                        push_unique(&mut ys, q.y - size.height - GAP);
                    }
                    ys.retain(|&y| {
                        y >= 0.0
                            && y + size.height <= limit.height + EPSILON
                            && (y - p.y).abs() <= radius
                    });
                    ys
                };
                for &x in &xs {
                    for &y in &ys {
                        if self.probes >= self.max_probes {
                            break;
                        }
                        if (x - p.x).abs() + (y - p.y).abs() <= radius {
                            self.add(&mut probe, x, y, size);
                        }
                    }
                }
            }
        }
        // Find small complete rearrangements before branches that recruit many untouched
        // neighbours. Complete-solution ranking remains authoritative.
        let mut ranked: Vec<([f64; 7], Placement)> = probe
            .options
            .into_iter()
            .map(|next| {
                let nb = next.bounds();
                let recruited = if phase == 3 {
                    probe
                        .obstacles
                        .iter()
                        .filter(|q| !fixed.contains(&q.id) && collides(&q.bounds(), &nb))
                        .count() as f64
                } else {
                    0.0
                };
                let rank = [
                    recruited,
                    distance(&nb, &p.bounds()),
                    (next.width - p.preferred.width).abs()
                        + (next.height - p.preferred.height).abs(),
                    next.y,
                    next.x,
                    -next.width,
                    -next.height,
                ];
                (rank, next)
            })
            .collect();
        ranked.sort_by(|a, b| js::order(lex(&a.0, &b.0)));
        ranked.into_iter().map(|(_, next)| next).collect()
    }

    fn visit(&mut self, ps: Vec<Placement>, fixed: Vec<String>) {
        if self.states >= self.total_states
            || self.states - self.phase_start >= self.max_states
            || self.probes >= self.max_probes
        {
            self.exhausted = true;
            return;
        }
        self.states += 1;
        let mut key = String::new();
        for (i, p) in ps.iter().enumerate() {
            if i > 0 {
                key.push(';');
            }
            point_key(&mut key, &p.bounds());
        }
        key.push('|');
        let mut sorted: Vec<&String> = fixed.iter().collect();
        sorted.sort_by(|a, b| js::cmp_utf16(a, b));
        for (i, f) in sorted.iter().enumerate() {
            if i > 0 {
                key.push(',');
            }
            key.push_str(f);
        }
        if !self.seen.insert(key) {
            return;
        }
        let mut conflicts: Vec<&Placement> = ps
            .iter()
            .filter(|p| {
                !fixed.contains(&p.id)
                    && ps
                        .iter()
                        .any(|q| fixed.contains(&q.id) && collides(&p.bounds(), &q.bounds()))
            })
            .collect();
        if self.phase == 3 {
            conflicts.sort_by(|a, b| {
                js::order(b.height - a.height)
                    .then_with(|| js::order(b.width - a.width))
                    .then_with(|| js::locale_compare(&a.id, &b.id))
            });
        }
        let Some(conflict) = conflicts.first().map(|c| (*c).clone()) else {
            if !valid_layout(&ps, self.surface, self.cs) {
                return;
            }
            let rank = self.score(&ps);
            if self.best_score.is_none_or(|best| lex(&rank, &best) < 0.0) {
                self.best = Some(ps);
                self.best_score = Some(rank);
            }
            return;
        };
        let settled: Vec<&Placement> = ps
            .iter()
            .filter(|p| fixed.contains(&p.id) && p.id != self.id)
            .collect();
        let settled_count = settled.len() as f64;
        if self
            .best_score
            .is_some_and(|best| settled_count + 1.0 > best[0])
        {
            return;
        }
        let travel = settled.iter().fold(0.0, |total, p| {
            total + distance(&p.bounds(), &self.original(&p.id).bounds())
        });
        for next in self.candidates(&conflict, &ps, &fixed) {
            if let Some(best) = self.best_score
                && settled_count + 1.0 == best[0]
                && travel + distance(&next.bounds(), &self.original(&next.id).bounds())
                    > best[1] + EPSILON
            {
                continue;
            }
            let state: Vec<Placement> = ps
                .iter()
                .map(|p| {
                    if p.id == next.id {
                        next.clone()
                    } else {
                        p.clone()
                    }
                })
                .collect();
            let mut fixed_next = fixed.clone();
            if !fixed_next.contains(&next.id) {
                fixed_next.push(next.id.clone());
            }
            self.visit(state, fixed_next);
        }
    }
}
