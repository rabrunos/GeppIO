//! Edit commands (`shared/workbench/commands.ts`): catalog insertion, moves between
//! regions, Sidebar stacking, removal, swap, the paired divider and composition fitting.
//! Every command builds a private snapshot and returns `None` on any failure.
use super::groups::transfer_group;
use super::model::{
    HOME, Operation, Presence, Registry, UserBar, View, WidgetGroup, WorkbenchSnapshot,
    active_placements, evaluate_placement, frame_types, group_for, limits, model_id,
    remove_grouped_presence, sidebar_insertion, snapshot_constraints,
};
use super::portable::{js_length, js_space};
use super::presentations::{panel_ids, validate_presentation_edges};
use crate::freeform::{constraint_in_region, constraints_for, project_region, transfer};
use crate::js;
use crate::layout::policy::{GAP, MAX_COORDINATE, MAX_WIDGETS};
use crate::layout::{Axis, Placement, References, Region, Size, Surface, collides, valid_layout};

/// Repacks every bar after an explicit intention, preserving each bar's stable order
/// (`reconcileBarHeights`). `None` when a stack would exceed the coordinate cap.
pub fn reconcile_bar_heights(source: &WorkbenchSnapshot) -> Option<WorkbenchSnapshot> {
    let mut bars = Vec::with_capacity(source.organization.bars.len());
    for bar in &source.organization.bars {
        let scene = source.with_active_bar(&bar.id);
        let mut placements: Vec<Placement> = active_placements(&scene, true)
            .into_iter()
            .filter(|p| p.region == Region::Sidebar)
            .collect();
        placements.sort_by(|a, b| js::order(a.y - b.y));
        let mut positions = bar.positions.clone();
        let mut end = -GAP;
        for p in &placements {
            let y = end + GAP;
            let type_id = source.type_of(&p.id).expect("sidebar view");
            if y + p.height > MAX_COORDINATE {
                return None;
            }
            positions.set(type_id, y);
            end = y + p.height;
        }
        let mut next_bar = bar.clone();
        next_bar.positions = positions;
        bars.push(next_bar);
    }
    let mut next = source.clone();
    next.organization.bars = bars;
    let active: Vec<Placement> = active_placements(&next, true)
        .into_iter()
        .filter(|p| p.region == Region::Sidebar)
        .collect();
    for p in &mut next.placements {
        if let Some(q) = active.iter().find(|q| q.id == p.id) {
            *p = q.clone();
        }
    }
    next.reference.sidebar.height = js::max_of(
        std::iter::once(next.reference.sidebar.height).chain(active.iter().map(|p| p.y + p.height)),
    );
    Some(next)
}

fn insert_sidebar(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    target: &Surface,
    y: Option<f64>,
    size: Option<Size>,
) -> Option<WorkbenchSnapshot> {
    if y.is_some_and(|y| !y.is_finite()) {
        return None;
    }
    let mut next = source.clone();
    let index = next.placements.iter().position(|p| p.id == id)?;
    let type_id = next.type_of(id)?.to_owned();
    let c = constraint_in_region(
        snapshot_constraints(&next, registry).get(id)?,
        Region::Sidebar,
    );
    if size.is_some_and(|s| s.width < c.min.width || s.width > c.max.width) {
        return None;
    }
    let (peers, at, _) = sidebar_insertion(source, Some(id), y.unwrap_or(f64::INFINITY));
    let mut placement = next.placements[index].clone();
    placement.region = Region::Sidebar;
    placement.x = 0.0;
    placement.width = target.width;
    placement.height = match size {
        Some(s) => s.height,
        None => js::max(c.min.height, js::min(c.max.height, placement.height)),
    };
    let mut ordered = peers;
    ordered.insert(at, placement.clone());
    let members: Vec<String> = ordered
        .iter()
        .flat_map(|p| frame_types(&next, &p.id))
        .collect();
    let bar_index = next.active_bar_index()?;
    let mut end = 0.0;
    let mut positions = super::model::Positions::new();
    for p in &ordered {
        positions.set(next.type_of(&p.id)?, end);
        end += p.height + GAP;
    }
    placement.y = positions.get(&type_id)?;
    placement.preferred = placement.size();
    {
        let bar = &mut next.organization.bars[bar_index];
        bar.members = members;
        bar.positions = positions;
    }
    next.placements[index] = placement;
    next.reference.sidebar = Size::new(target.width, js::max(target.height, end - GAP));
    let sidebar: Vec<Placement> = active_placements(&next, true)
        .into_iter()
        .filter(|p| p.region == Region::Sidebar)
        .collect();
    if target.width < c.min.width
        || target.width > c.max.width
        || !valid_layout(
            &sidebar,
            target,
            &constraints_for(target, &snapshot_constraints(&next, registry)),
        )
    {
        return None;
    }
    reconcile_bar_heights(&next)
}

/// Adds a catalog type to a region at `at`, reusing an existing view or model when the
/// presence rules allow it (`addWidget`). `slot_size` places an explicit reserved rectangle.
pub fn add_widget(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    type_id: &str,
    surface: &Surface,
    at: Option<(f64, f64)>,
    disabled: &[String],
    slot_size: Option<Size>,
) -> Option<WorkbenchSnapshot> {
    evaluate_placement(
        source,
        registry,
        type_id,
        surface.region,
        Operation::Catalog,
        &[],
        disabled,
    )
    .ok()?;
    let mut next = source.clone();
    let t = registry.get(type_id)?;
    let find_view = |next: &WorkbenchSnapshot| {
        next.organization
            .views
            .iter()
            .find(|v| {
                v.type_id == type_id
                    && (t.presence == Presence::SingleView
                        || next
                            .placements
                            .iter()
                            .any(|p| p.id == v.id && p.region == surface.region))
            })
            .map(|v| v.id.clone())
    };
    let view_id = match find_view(&next) {
        Some(id) => id,
        None => match next
            .organization
            .views
            .iter()
            .find(|v| v.type_id == type_id && !next.placements.iter().any(|p| p.id == v.id))
        {
            Some(v) => v.id.clone(),
            None => {
                if next.organization.views.len() >= MAX_WIDGETS {
                    return None;
                }
                let id = format!("{}:view:{}", t.id, surface.region.as_str());
                if next.organization.views.iter().any(|v| v.id == id) {
                    return None;
                }
                next.organization.views.push(View::new(id.clone(), type_id));
                id
            }
        },
    };
    let existing = next.placement(&view_id).cloned();
    if let Some(existing) = &existing
        && existing.region != surface.region
        && t.presence == Presence::SingleView
        && slot_size.is_none()
    {
        return move_view(source, registry, &existing.id, surface, at, None, None, &[]);
    }
    if let Some(existing) = &existing
        && slot_size.is_some()
    {
        next = remove_presence(&next, &existing.id, None);
        next.placements.retain(|p| p.id != existing.id);
    }
    if surface.region == Region::Sidebar {
        let peers: Vec<Placement> = active_placements(&next, true)
            .into_iter()
            .filter(|p| p.region == Region::Sidebar)
            .collect();
        let bar_index = next.active_bar_index()?;
        let bar = &mut next.organization.bars[bar_index];
        let default_y = match at {
            Some((_, y)) => y,
            None => js::max(0.0, js::max_of(peers.iter().map(|p| p.y + p.height + GAP))),
        };
        bar.positions.set_default(type_id, default_y);
        if !bar.members.iter().any(|m| m == type_id) {
            bar.members.push(type_id.to_owned());
        }
        if let Some(existing) = &existing
            && existing.region == Region::Sidebar
            && slot_size.is_none()
        {
            return insert_sidebar(
                &next,
                registry,
                &existing.id,
                surface,
                at.map(|a| a.1),
                None,
            );
        }
    }
    if existing.is_none() || slot_size.is_some() {
        let size = slot_size.unwrap_or(t.constraint.default);
        let (x, y) = match (slot_size, at) {
            (Some(_), Some(at)) => at,
            _ => (0.0, 0.0),
        };
        next.placements.push(Placement {
            id: view_id.clone(),
            region: surface.region,
            x,
            y,
            width: size.width,
            height: size.height,
            preferred: size,
        });
    }
    if surface.region == Region::Sidebar {
        return insert_sidebar(
            &next,
            registry,
            &view_id,
            surface,
            at.map(|a| a.1),
            slot_size,
        );
    }
    if let Some(size) = slot_size {
        // A reserved rectangle is an explicit placement/size intention, not a move.
        return exact_placement(&next, registry, &view_id, surface, at, size);
    }
    transfer_active(&next, registry, &view_id, surface, at)
}

fn transfer_active(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    target: &Surface,
    at: Option<(f64, f64)>,
) -> Option<WorkbenchSnapshot> {
    let panels = panel_ids(source);
    let active: Vec<Placement> = active_placements(source, true)
        .into_iter()
        .filter(|p| !panels.contains(&p.id) || p.id == id)
        .collect();
    let active_ids: Vec<String> = active.iter().map(|p| p.id.clone()).collect();
    let original = source.placement(id)?.clone();
    let mut solver: Vec<Placement> = active.into_iter().filter(|p| p.id != id).collect();
    solver.push(original);
    let (moved, reference) = transfer(
        &solver,
        &source.reference,
        id,
        target,
        at,
        &snapshot_constraints(source, registry),
    )?;
    let mut placements: Vec<Placement> = source
        .placements
        .iter()
        .map(|p| moved.iter().find(|q| q.id == p.id).unwrap_or(p).clone())
        .collect();
    for p in &moved {
        if !placements.iter().any(|q| q.id == p.id) {
            placements.push(p.clone());
        }
    }
    let mut result = source.clone();
    result.reference = reference;
    result.placements = placements;
    validate_presentation_edges(&result).ok()?;
    if target.region == Region::Sidebar {
        let bar_index = result.active_bar_index()?;
        for p in moved
            .iter()
            .filter(|p| p.region == Region::Sidebar && (active_ids.contains(&p.id) || p.id == id))
        {
            let type_id = source.type_of(&p.id)?.to_owned();
            result.organization.bars[bar_index]
                .positions
                .set(&type_id, p.y);
        }
        result.reference.sidebar.height = js::max_of(
            std::iter::once(result.reference.sidebar.height).chain(
                result
                    .placements
                    .iter()
                    .filter(|p| p.region == Region::Sidebar)
                    .map(|p| p.y + p.height),
            ),
        );
    }
    reconcile_bar_heights(&result)
}

/// Moves a view to `target` (`moveView`): a cross-region group frame moves through the
/// group transfer, everything else through [`move_frame`]. `source_bar` defaults to the
/// active bar.
#[allow(clippy::too_many_arguments)] // Mirrors the reference signature.
pub fn move_view(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    target: &Surface,
    at: Option<(f64, f64)>,
    source_bar: Option<&str>,
    slot_size: Option<Size>,
    disabled: &[String],
) -> Option<WorkbenchSnapshot> {
    let source_bar = source_bar.unwrap_or(&source.organization.active_bar);
    let group = group_for(source, id);
    let placement = source.placement(id);
    if let (Some(_), Some(placement)) = (group, placement)
        && (target.region != placement.region
            || (target.region == Region::Sidebar && source_bar != source.organization.active_bar))
    {
        if slot_size.is_some() {
            return None;
        }
        return transfer_group(source, registry, id, target, at, source_bar, disabled);
    }
    move_frame(
        source,
        registry,
        id,
        target,
        at,
        Some(source_bar),
        slot_size,
        disabled,
    )
}

/// Internal bounded-frame placement; group partitioning is owned by the groups module
/// (`moveFrame`).
#[allow(clippy::too_many_arguments)] // Mirrors the reference signature.
pub fn move_frame(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    target: &Surface,
    at: Option<(f64, f64)>,
    source_bar: Option<&str>,
    slot_size: Option<Size>,
    disabled: &[String],
) -> Option<WorkbenchSnapshot> {
    let source_bar = source_bar
        .unwrap_or(&source.organization.active_bar)
        .to_owned();
    let view = source.view(id)?;
    let placement = source.placement(id)?;
    let t = registry.get(&view.type_id)?;
    if t.preserve_normal_geometry
        && placement.region != target.region
        && panel_ids(source).contains(&id.to_owned())
    {
        return None;
    }
    let mut next = source.clone();
    let destination = next.active_bar_index()?;
    let other_sidebar = next
        .placements
        .iter()
        .find(|p| {
            p.id != id && p.region == Region::Sidebar && next.type_of(&p.id) == Some(t.id.as_str())
        })
        .map(|p| p.id.clone());
    let destination_id = next.organization.bars[destination].id.clone();
    if target.region == Region::Sidebar
        && next.organization.bars[destination].members.contains(&t.id)
        && (placement.region != Region::Sidebar || source_bar != destination_id)
    {
        return None;
    }
    let mut ignored = vec![id];
    if let Some(other) = &other_sidebar {
        ignored.push(other);
    }
    evaluate_placement(
        source,
        registry,
        &t.id,
        target.region,
        Operation::Move,
        &ignored,
        disabled,
    )
    .ok()?;
    if placement.region == Region::Sidebar
        && (source_bar != destination_id || target.region != Region::Sidebar)
    {
        if let Some(origin) = next
            .organization
            .bars
            .iter_mut()
            .find(|b| b.id == source_bar)
        {
            origin.members.retain(|m| *m != t.id);
            origin.positions.remove(&t.id);
        }
        if t.presence == Presence::MultipleAreas
            && target.region != Region::Sidebar
            && next
                .organization
                .bars
                .iter()
                .any(|b| b.members.contains(&t.id))
        {
            return add_widget(&next, registry, &t.id, target, at, disabled, slot_size);
        }
    }
    if target.region == Region::Sidebar
        && let Some(other) = other_sidebar
    {
        next.placements.retain(|p| p.id != id);
        if !next.organization.bars[destination].members.contains(&t.id) {
            next.organization.bars[destination]
                .members
                .push(t.id.clone());
        }
        let peers_end = js::max(
            0.0,
            js::max_of(
                active_placements(&next, true)
                    .iter()
                    .filter(|p| p.region == Region::Sidebar && p.id != other)
                    .map(|p| p.y + p.height + GAP),
            ),
        );
        next.organization.bars[destination]
            .positions
            .set_default(&t.id, peers_end);
        return insert_sidebar(&next, registry, &other, target, at.map(|a| a.1), slot_size);
    }
    if target.region == Region::Sidebar {
        return insert_sidebar(&next, registry, id, target, at.map(|a| a.1), slot_size);
    }
    match slot_size {
        Some(size) => exact_placement(&next, registry, id, target, at, size),
        None => transfer_active(&next, registry, id, target, at),
    }
}

/// An explicit rectangle never goes through default-size insertion or solver resize.
fn exact_placement(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    target: &Surface,
    at: Option<(f64, f64)>,
    size: Size,
) -> Option<WorkbenchSnapshot> {
    let mut next = source.clone();
    let index = next.placements.iter().position(|p| p.id == id)?;
    let (x, y) = at?;
    {
        let p = &mut next.placements[index];
        p.x = x;
        p.y = y;
        p.width = size.width;
        p.height = size.height;
        p.region = target.region;
        p.preferred = size;
    }
    *next.reference.get_mut(target.region) = Size::new(
        target.width,
        if target.region == Region::Sidebar {
            js::max(target.height, y + size.height)
        } else {
            target.height
        },
    );
    if target.region == Region::Sidebar {
        let type_id = next.type_of(id)?.to_owned();
        let bar_index = next.active_bar_index()?;
        next.organization.bars[bar_index].positions.set(&type_id, y);
    }
    validate_presentation_edges(&next).ok()?;
    let panels = panel_ids(&next);
    let scene: Vec<Placement> = active_placements(&next, true)
        .into_iter()
        .filter(|p| p.region == target.region && !panels.contains(&p.id))
        .collect();
    if !valid_layout(
        &scene,
        target,
        &constraints_for(target, &snapshot_constraints(&next, registry)),
    ) {
        return None;
    }
    if target.region == Region::Sidebar {
        reconcile_bar_heights(&next)
    } else {
        Some(next)
    }
}

/// Removes a view's presence (`removePresence`). A Sidebar presence shared by another bar
/// only leaves the active bar.
pub fn remove_presence(
    source: &WorkbenchSnapshot,
    id: &str,
    registry: Option<&Registry>,
) -> WorkbenchSnapshot {
    if group_for(source, id).is_some() {
        return remove_grouped_presence(source, id, registry);
    }
    let (Some(placement), Some(view)) = (source.placement(id), source.view(id)) else {
        return source.clone();
    };
    let mut next = source.clone();
    if placement.region == Region::Sidebar {
        let type_id = view.type_id.clone();
        if let Some(bar_index) = next.active_bar_index() {
            let bar = &mut next.organization.bars[bar_index];
            bar.members.retain(|t| *t != type_id);
            bar.positions.remove(&type_id);
        }
        if next
            .organization
            .bars
            .iter()
            .any(|b| b.members.contains(&type_id))
        {
            return next;
        }
    }
    next.placements.retain(|p| p.id != id);
    next
}

/// Swaps two views; both destinations are validated together and rectangles belong to the
/// slots (`swapViews`).
pub fn swap_views(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    a: &str,
    b: &str,
) -> Option<WorkbenchSnapshot> {
    let active = active_placements(source, true);
    let first = active.iter().find(|p| p.id == a)?.clone();
    let second = active.iter().find(|p| p.id == b)?.clone();
    if a == b {
        return None;
    }
    let cross = first.region != second.region;
    if cross
        && (first.region == Region::Sidebar || second.region == Region::Sidebar)
        && (group_for(source, a).is_some() || group_for(source, b).is_some())
    {
        return None;
    }
    let one = source.view(a)?.clone();
    let two = source.view(b)?.clone();
    let panels = panel_ids(source);
    if cross
        && [&one, &two].iter().any(|v| {
            registry
                .get(&v.type_id)
                .is_some_and(|t| t.preserve_normal_geometry)
                && panels.contains(&v.id)
        })
    {
        return None;
    }
    evaluate_placement(
        source,
        registry,
        &one.type_id,
        second.region,
        Operation::Swap,
        &[a, b],
        &[],
    )
    .ok()?;
    evaluate_placement(
        source,
        registry,
        &two.type_id,
        first.region,
        Operation::Swap,
        &[a, b],
        &[],
    )
    .ok()?;
    let mut next = source.clone();
    for p in &mut next.placements {
        if p.id == a {
            *p = Placement {
                id: a.to_owned(),
                preferred: second.size(),
                ..second.clone()
            };
        } else if p.id == b {
            *p = Placement {
                id: b.to_owned(),
                preferred: first.size(),
                ..first.clone()
            };
        }
    }
    if first.region == Region::Sidebar || second.region == Region::Sidebar {
        let bar_index = next.active_bar_index()?;
        let bar_id = next.organization.bars[bar_index].id.clone();
        {
            let bar = &mut next.organization.bars[bar_index];
            bar.members = bar
                .members
                .iter()
                .map(|m| {
                    if first.region == Region::Sidebar && *m == one.type_id {
                        two.type_id.clone()
                    } else if second.region == Region::Sidebar && *m == two.type_id {
                        one.type_id.clone()
                    } else {
                        m.clone()
                    }
                })
                .collect();
            for (i, m) in bar.members.iter().enumerate() {
                if bar.members[..i].contains(m) {
                    return None;
                }
            }
            if first.region == Region::Sidebar {
                bar.positions.remove(&one.type_id);
                bar.positions.set(&two.type_id, first.y);
            }
            if second.region == Region::Sidebar {
                bar.positions.remove(&two.type_id);
                bar.positions.set(&one.type_id, second.y);
            }
            // Simultaneous Sidebar swaps must retain both new positions.
            if first.region == Region::Sidebar && second.region == Region::Sidebar {
                bar.positions.set(&one.type_id, second.y);
                bar.positions.set(&two.type_id, first.y);
            }
            let positions = bar.positions.clone();
            bar.members.sort_by(|x, y| {
                js::order(positions.get(x).unwrap_or(0.0) - positions.get(y).unwrap_or(0.0))
            });
        }
        for (placement, destination, record) in [(&first, &second, &one), (&second, &first, &two)] {
            if placement.region != Region::Sidebar
                || destination.region == Region::Sidebar
                || !next
                    .organization
                    .bars
                    .iter()
                    .any(|o| o.id != bar_id && o.members.contains(&record.type_id))
            {
                continue;
            }
            let t = registry.get(&record.type_id)?;
            let id = format!("{}:view:sidebar", t.id);
            if t.presence == Presence::SingleView {
                continue;
            }
            if next.organization.views.len() >= MAX_WIDGETS
                || next.organization.views.iter().any(|v| v.id == id)
            {
                return None;
            }
            next.organization.views.push(View {
                id: id.clone(),
                type_id: t.id.clone(),
                model_id: model_id(&t.id),
            });
            next.placements.push(Placement {
                id,
                ..placement.clone()
            });
        }
    }
    let cs = snapshot_constraints(&next, registry);
    let mut regions = vec![first.region];
    if second.region != first.region {
        regions.push(second.region);
    }
    for region in regions {
        let surface = Surface::of(
            region,
            *source.reference.get(region),
            region == Region::Main,
        );
        let scene: Vec<Placement> = active_placements(&next, true)
            .into_iter()
            .filter(|p| p.region == region)
            .collect();
        if !valid_layout(&scene, &surface, &constraints_for(&surface, &cs)) {
            return None;
        }
    }
    Some(next)
}

/// The paired divider intention: the edge between two adjacent frames moves by `delta`.
#[derive(Clone, Debug, PartialEq)]
pub struct ResizePair {
    /// Frame before the divider.
    pub first: String,
    /// Frame after the divider.
    pub second: String,
    /// Divider axis (`x` moves a vertical divider).
    pub axis: Axis,
    /// Signed travel.
    pub delta: f64,
}

/// The only implicit normal-mode geometry transaction (`resizePair`).
pub fn resize_pair(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    intent: &ResizePair,
) -> Option<WorkbenchSnapshot> {
    let active = active_placements(source, true);
    let a = active.iter().find(|p| p.id == intent.first)?;
    let b = active.iter().find(|p| p.id == intent.second)?;
    if a.region != b.region || !intent.delta.is_finite() {
        return None;
    }
    let axis = intent.axis;
    let horizontal = axis == Axis::X;
    if (a.region == Region::Sidebar && horizontal)
        || (a.region == Region::Bottom && !horizontal)
        || (b.start(axis) - a.start(axis) - a.extent(axis) - GAP).abs() > 0.1
    {
        return None;
    }
    let cross = axis.cross();
    if a.start(cross) >= b.start(cross) + b.extent(cross)
        || b.start(cross) >= a.start(cross) + a.extent(cross)
    {
        return None;
    }
    let mut first = a.clone();
    let mut second = b.clone();
    let mut fb = first.bounds();
    *fb.extent_mut(axis) = a.extent(axis) + intent.delta;
    first.set_bounds(fb);
    let mut sb = second.bounds();
    *sb.start_mut(axis) = b.start(axis) + intent.delta;
    *sb.extent_mut(axis) = b.extent(axis) - intent.delta;
    second.set_bounds(sb);
    first.preferred = first.size();
    second.preferred = second.size();
    let mut next = source.clone();
    for p in &mut next.placements {
        if p.id == a.id {
            *p = first.clone();
        } else if p.id == b.id {
            *p = second.clone();
        }
    }
    if a.region == Region::Sidebar {
        let bar_index = next.active_bar_index()?;
        let ta = source.type_of(&a.id)?.to_owned();
        let tb = source.type_of(&b.id)?.to_owned();
        next.organization.bars[bar_index]
            .positions
            .set(&ta, first.y);
        next.organization.bars[bar_index]
            .positions
            .set(&tb, second.y);
        next = reconcile_bar_heights(&next)?;
    }
    let surface = Surface::of(
        a.region,
        *source.reference.get(a.region),
        a.region == Region::Main,
    );
    let scene: Vec<Placement> = active_placements(&next, true)
        .into_iter()
        .filter(|p| p.region == a.region)
        .collect();
    valid_layout(
        &scene,
        &surface,
        &constraints_for(&surface, &snapshot_constraints(&next, registry)),
    )
    .then_some(next)
}

/// Projects composition targets against the actual constraints, preserving omitted
/// regions (`fitTargets`).
pub fn fit_targets(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    targets: &[Placement],
    reference: &References,
    scopes: &[Region],
) -> Option<WorkbenchSnapshot> {
    let cs = snapshot_constraints(source, registry);
    let mut result: Vec<Placement> = source
        .placements
        .iter()
        .filter(|p| !scopes.contains(&p.region))
        .cloned()
        .collect();
    for &region in scopes {
        let projected = project_region(
            targets,
            reference,
            region,
            *source.reference.get(region),
            false,
            &cs,
        );
        let surface = Surface::of(region, *source.reference.get(region), false);
        if !projected.feasible
            || !valid_layout(
                &projected.placements,
                &surface,
                &constraints_for(&surface, &cs),
            )
        {
            return None;
        }
        result.extend(projected.placements);
    }
    let together = |a: &Placement, b: &Placement| {
        a.region != Region::Sidebar
            || source.organization.bars.iter().any(|bar| {
                [a, b].iter().all(|p| {
                    source
                        .type_of(&p.id)
                        .is_some_and(|t| bar.members.iter().any(|m| m == t))
                })
            })
    };
    for (i, p) in result.iter().enumerate() {
        if result[i + 1..].iter().any(|q| {
            p.id == q.id
                || (p.region == q.region && together(p, q) && collides(&p.bounds(), &q.bounds()))
        }) {
            return None;
        }
    }
    let mut next = source.clone();
    next.placements = result;
    validate_presentation_edges(&next).ok()?;
    Some(next)
}

/// Creates or replaces a bar (`updateBar`): a non-blank name of at most 100 UTF-16 units,
/// unique members, a protected Home and the saved/active bar caps.
pub fn update_bar(source: &WorkbenchSnapshot, bar: &UserBar) -> Option<WorkbenchSnapshot> {
    if bar.name.chars().all(js_space) || js_length(&bar.name) > 100 {
        return None;
    }
    for (i, m) in bar.members.iter().enumerate() {
        if bar.members[..i].contains(m) {
            return None;
        }
    }
    if bar.id == HOME && bar.archived {
        return None;
    }
    let mut next = source.clone();
    match next.organization.bars.iter_mut().find(|b| b.id == bar.id) {
        Some(old) => *old = bar.clone(),
        None => next.organization.bars.push(bar.clone()),
    }
    let active_count = |s: &WorkbenchSnapshot| {
        s.organization
            .bars
            .iter()
            .filter(|b| !b.archived && b.id != HOME)
            .count()
    };
    if next.organization.bars.len() > limits::SAVED_BARS + 1
        || (active_count(&next) > limits::ACTIVE_BARS && active_count(&next) > active_count(source))
    {
        return None;
    }
    if next.organization.active_bar == bar.id && bar.archived {
        next.organization.active_bar = HOME.to_owned();
    }
    Some(next)
}

/// A complete bar edit as one intention, built from the supplied baseline only
/// (`configureBar`): retained tab groups stay whole, other members are added in order.
pub fn configure_bar(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    bar: &UserBar,
    surface: &Surface,
    disabled: &[String],
) -> Option<WorkbenchSnapshot> {
    if bar.members.iter().any(|id| {
        registry.get(id).is_none_or(|t| {
            constraint_in_region(&t.constraint, Region::Sidebar)
                .min
                .width
                > surface.width
        })
    }) {
        return None;
    }
    let canonical = Surface {
        width: source.reference.sidebar.width,
        ..*surface
    };
    let saved_members = source
        .organization
        .bars
        .iter()
        .find(|b| b.id == bar.id)
        .map(|b| b.members.clone());
    let owned: Vec<WidgetGroup> = source
        .organization
        .groups
        .as_ref()
        .map(|g| {
            g.entries
                .iter()
                .filter(|group| {
                    source
                        .placements
                        .iter()
                        .any(|p| p.id == group.frame_id && p.region == Region::Sidebar)
                        && saved_members.as_ref().is_some_and(|members| {
                            source
                                .type_of(&group.frame_id)
                                .is_some_and(|t| members.iter().any(|m| m == t))
                        })
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    if owned.iter().any(|group| {
        let count = frame_types(source, &group.frame_id)
            .iter()
            .filter(|t| bar.members.contains(t))
            .count();
        count > 0 && count < group.members.len()
    }) {
        return None;
    }
    let retained: Vec<&WidgetGroup> = owned
        .iter()
        .filter(|group| {
            frame_types(source, &group.frame_id)
                .iter()
                .all(|t| bar.members.contains(t))
        })
        .collect();
    let mut retained_types: Vec<String> = Vec::new();
    for group in &retained {
        for t in frame_types(source, &group.frame_id) {
            if !retained_types.contains(&t) {
                retained_types.push(t);
            }
        }
    }
    let mut next = update_bar(
        source,
        &UserBar {
            members: retained_types.clone(),
            ..bar.clone()
        },
    )?;
    if let Some(groups) = &mut next.organization.groups {
        groups.entries.retain(|group| {
            !owned.iter().any(|item| item.id == group.id)
                || retained.iter().any(|item| item.id == group.id)
        });
    }
    next.organization.active_bar = bar.id.clone();
    for type_id in &bar.members {
        if retained_types.contains(type_id) {
            continue;
        }
        next = add_widget(&next, registry, type_id, &canonical, None, disabled, None)?;
    }
    if let Some(saved) = next.organization.bars.iter_mut().find(|b| b.id == bar.id) {
        let members = saved.members.clone();
        saved.positions.retain(|id| members.iter().any(|m| m == id));
    }
    Some(next)
}

/// Deletes an archived custom bar and the Sidebar groups it owned (`deleteBar`).
pub fn delete_bar(source: &WorkbenchSnapshot, id: &str) -> Option<WorkbenchSnapshot> {
    let bar = source.organization.bars.iter().find(|b| b.id == id)?;
    if id == HOME || !bar.archived {
        return None;
    }
    let mut next = source.clone();
    if let Some(groups) = &mut next.organization.groups {
        groups.entries.retain(|group| {
            !source.placements.iter().any(|p| {
                p.id == group.frame_id
                    && p.region == Region::Sidebar
                    && source
                        .type_of(&p.id)
                        .is_some_and(|t| bar.members.iter().any(|m| m == t))
            })
        });
    }
    next.organization.bars.retain(|b| b.id != id);
    Some(next)
}

/// Moves a custom bar by `offset` places; Home stays first (`reorderBar`).
pub fn reorder_bar(source: &WorkbenchSnapshot, id: &str, offset: i64) -> Option<WorkbenchSnapshot> {
    let bars = &source.organization.bars;
    let from = bars
        .iter()
        .position(|b| b.id == id)
        .map_or(-1, |i| i as i64);
    let to = from + offset;
    if id == HOME || from < 1 || to < 1 || to >= bars.len() as i64 {
        return None;
    }
    let mut next = source.clone();
    let moved = next.organization.bars.remove(from as usize);
    next.organization.bars.insert(to as usize, moved);
    Some(next)
}
