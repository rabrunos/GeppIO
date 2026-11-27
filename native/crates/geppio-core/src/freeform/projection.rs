//! Stable viewport projection (`freeform/projection.ts`). Stable source separations become
//! a DAG, never a packing order; binary fitting replaces integer decrement loops. There is
//! no viewport history, gravity, coordinate rounding or implicit persistence.
use super::policy::constraint_in_region;
use crate::js;
use crate::layout::policy::{GAP, MAX_COORDINATE};
use crate::layout::{Axis, Constraints, EPSILON, Placement, References, Region, Size, clamp};

/// One fitted interval per identity: `(id, start, size)`.
type Fit = Vec<(String, f64, f64)>;

fn lookup(fit: &Fit, id: &str) -> (f64, f64) {
    // `new Map(entries)`: the last duplicate wins.
    fit.iter()
        .rev()
        .find(|(k, _, _)| k == id)
        .map(|(_, start, size)| (*start, *size))
        .expect("every projected placement has an interval")
}

fn axis_fit(
    ps: &[&Placement],
    axis: Axis,
    reference: f64,
    limit: f64,
    constraints: &Constraints,
) -> Option<Fit> {
    let mut intervals: Vec<&Placement> = ps.to_vec();
    intervals.sort_by(|a, b| {
        js::order(a.start(axis) - b.start(axis)).then_with(|| js::locale_compare(&a.id, &b.id))
    });
    let mut cs = Vec::with_capacity(intervals.len());
    for p in &intervals {
        // A missing constraint throws in the reference; the port reports infeasible.
        cs.push(constraints.get(&p.id)?);
    }
    let n = intervals.len();
    let predecessors: Vec<Vec<usize>> = intervals
        .iter()
        .map(|b| {
            intervals
                .iter()
                .enumerate()
                .filter(|(_, a)| {
                    a.id != b.id && a.start(axis) + a.extent(axis) <= b.start(axis) + EPSILON
                })
                .map(|(index, _)| index)
                .collect()
        })
        .collect();
    if reference == limit
        && intervals.iter().zip(&cs).all(|(p, c)| {
            p.extent(axis) >= c.min.along(axis) && p.start(axis) + p.extent(axis) <= limit + EPSILON
        })
    {
        // A validated direct composition already satisfies two-dimensional clearance;
        // re-imposing the projection DAG here would move anchored previews.
        return Some(
            intervals
                .iter()
                .map(|p| (p.id.clone(), p.start(axis), p.extent(axis)))
                .collect(),
        );
    }
    let resizable: Vec<bool> = cs
        .iter()
        .map(|c| match axis {
            Axis::X => c.resize_x,
            Axis::Y => c.resize_y,
        })
        .collect();
    let minima: Vec<f64> = (0..n)
        .map(|i| {
            if resizable[i] {
                cs[i].min.along(axis)
            } else {
                intervals[i].extent(axis)
            }
        })
        .collect();
    let mut depth = vec![0.0_f64; n];
    for i in 0..n {
        for &predecessor in &predecessors[i] {
            depth[i] = js::max(depth[i], depth[predecessor] + 1.0);
        }
    }
    let fixed_gaps = js::max(0.0, js::max_of(depth.iter().copied())) * GAP;
    let ratio = if reference > fixed_gaps {
        js::max(0.0, limit - fixed_gaps) / (reference - fixed_gaps)
    } else {
        limit / reference
    };
    // Viewport fitting may grow beyond a gesture's saved preference; only this
    // source-derived presentation changes, stored/preferred rectangles do not.
    let ideals: Vec<f64> = (0..n)
        .map(|i| {
            if resizable[i] {
                clamp(
                    intervals[i].extent(axis) * ratio,
                    minima[i],
                    cs[i].max.along(axis),
                )
            } else {
                intervals[i].extent(axis)
            }
        })
        .collect();
    let earliest = |sizes: &[f64]| -> Vec<f64> {
        let mut starts = vec![0.0_f64; n];
        for j in 0..n {
            for &i in &predecessors[j] {
                starts[j] = js::max(starts[j], starts[i] + sizes[i] + GAP);
            }
        }
        starts
    };
    let required = |sizes: &[f64]| -> f64 {
        let starts = earliest(sizes);
        js::max(
            0.0,
            js::max_of(starts.iter().enumerate().map(|(i, start)| start + sizes[i])),
        )
    };
    if required(&minima) > limit + EPSILON {
        return None;
    }
    let mut sizes = ideals.clone();
    if required(&ideals) > limit {
        let (mut lo, mut hi) = (0.0_f64, 1.0_f64);
        for _ in 0..48 {
            let factor = (lo + hi) / 2.0;
            let next: Vec<f64> = minima
                .iter()
                .enumerate()
                .map(|(j, min)| min + (ideals[j] - min) * factor)
                .collect();
            if required(&next) <= limit {
                lo = factor;
            } else {
                hi = factor;
            }
        }
        sizes = minima
            .iter()
            .enumerate()
            .map(|(j, min)| min + (ideals[j] - min) * lo)
            .collect();
    }
    let lower = earliest(&sizes);
    let mut upper: Vec<f64> = sizes.iter().map(|size| limit - size).collect();
    for i in (0..n).rev() {
        for j in i + 1..n {
            if predecessors[j].contains(&i) {
                upper[i] = js::min(upper[i], upper[j] - sizes[i] - GAP);
            }
        }
    }
    let mut starts = lower;
    for i in 0..n {
        let p = intervals[i];
        for &predecessor in &predecessors[i] {
            starts[i] = js::max(starts[i], starts[predecessor] + sizes[predecessor] + GAP);
        }
        let ideal = p.start(axis) / js::or(reference - p.extent(axis), 1.0) * (limit - sizes[i]);
        starts[i] = clamp(ideal, starts[i], js::max(starts[i], upper[i]));
    }
    Some(
        intervals
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), js::max(0.0, starts[i]), sizes[i]))
            .collect(),
    )
}

/// A region presentation derived from a stable source.
#[derive(Clone, Debug, PartialEq)]
pub struct Projection {
    /// The region's placements (source rectangles when infeasible).
    pub placements: Vec<Placement>,
    /// Whether relationships and minima fit the available size.
    pub feasible: bool,
    /// Scroll world size of the region.
    pub world: Size,
}

/// Projects one region of a stable source into `available` (`projectRegion`). Equal inputs
/// give equal results; A→B→A never accumulates drift.
pub fn project_region(
    placements: &[Placement],
    reference: &References,
    region: Region,
    available: Size,
    expanded: bool,
    constraints: &Constraints,
) -> Projection {
    let constraints = constraints.map(|c| constraint_in_region(c, region));
    let expanded = expanded && region == Region::Main;
    let ps: Vec<&Placement> = placements.iter().filter(|p| p.region == region).collect();
    let reference = *reference.get(region);
    let width = clamp(available.width, 0.0, MAX_COORDINATE);
    let height = clamp(available.height, 0.0, MAX_COORDINATE);
    let x = if region == Region::Sidebar || expanded {
        None
    } else {
        axis_fit(&ps, Axis::X, reference.width, width, &constraints)
    };
    let y = if region != Region::Main {
        None
    } else {
        axis_fit(&ps, Axis::Y, reference.height, height, &constraints)
    };
    let fits_width = |p: &&Placement| {
        constraints
            .get(&p.id)
            .is_some_and(|c| width >= c.min.width && width <= c.max.width)
    };
    let fits_height = |p: &&Placement| {
        constraints
            .get(&p.id)
            .is_some_and(|c| height >= c.min.height && height <= c.max.height)
    };
    let feasible = (if region == Region::Sidebar {
        ps.iter().all(fits_width)
    } else {
        expanded || x.is_some()
    }) && (if region == Region::Bottom {
        ps.iter().all(fits_height)
    } else {
        region == Region::Sidebar || y.is_some()
    });
    if !feasible {
        let world = if region == Region::Main {
            Size::new(
                js::max_of(
                    [width, reference.width]
                        .into_iter()
                        .chain(ps.iter().map(|p| p.x + p.width)),
                ),
                js::max(height, reference.height),
            )
        } else {
            Size::new(
                width,
                if region == Region::Sidebar {
                    js::max(0.0, js::max_of(ps.iter().map(|p| p.y + p.height)))
                } else {
                    height
                },
            )
        };
        return Projection {
            placements: ps.into_iter().cloned().collect(),
            feasible: false,
            world,
        };
    }
    let projected: Vec<Placement> = ps
        .iter()
        .map(|p| {
            let fx = x.as_ref().map(|fit| lookup(fit, &p.id));
            let fy = y.as_ref().map(|fit| lookup(fit, &p.id));
            let mut next = (*p).clone();
            next.x = if region == Region::Sidebar {
                0.0
            } else if expanded {
                p.x
            } else {
                fx.expect("x fit").0
            };
            next.y = if region == Region::Bottom {
                0.0
            } else if region == Region::Sidebar {
                p.y
            } else {
                fy.expect("y fit").0
            };
            next.width = if region == Region::Sidebar {
                width
            } else if expanded {
                p.width
            } else {
                fx.expect("x fit").1
            };
            next.height = if region == Region::Bottom {
                height
            } else if region == Region::Sidebar {
                p.height
            } else {
                fy.expect("y fit").1
            };
            next
        })
        .collect();
    let world = Size::new(
        if region == Region::Main {
            js::max_of(std::iter::once(width).chain(projected.iter().map(|p| p.x + p.width)))
        } else {
            width
        },
        if region == Region::Sidebar {
            js::max(0.0, js::max_of(projected.iter().map(|p| p.y + p.height)))
        } else {
            height
        },
    );
    Projection {
        placements: projected,
        feasible: true,
        world,
    }
}
