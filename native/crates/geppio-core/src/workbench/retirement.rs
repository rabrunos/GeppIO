//! Demo retirement (`shared/workbench/retirement.ts`). Only validated identities are
//! retired; the archive survives explicit saves and startup never writes bytes.
use super::model::{DemoArchive, HOME, Registry, UserBar, WorkbenchSnapshot};
use super::presentations::Presentations;
use crate::freeform::CodecError;
use crate::freeform::schema::reject;

/// The initial composition for a reset preview (`resetWorkbench`): with demo fixtures it is
/// the demo scene; otherwise it keeps the Sidebar, the bars, their groups and the archive.
pub fn reset_workbench(source: &WorkbenchSnapshot, demo_fixtures: bool) -> WorkbenchSnapshot {
    let initial = super::model::initial_workbench(demo_fixtures);
    if demo_fixtures {
        return initial;
    }
    let mut organization = source.organization.clone();
    if let Some(groups) = &mut organization.groups {
        groups.entries.retain(|g| {
            source
                .placements
                .iter()
                .any(|p| p.id == g.frame_id && p.region == crate::layout::Region::Sidebar)
        });
    }
    organization.chrome = initial.organization.chrome;
    organization.presentations = initial.organization.presentations.clone();
    WorkbenchSnapshot {
        retired_demos: source.retired_demos.clone(),
        organization,
        placements: source
            .placements
            .iter()
            .filter(|p| p.region == crate::layout::Region::Sidebar)
            .cloned()
            .collect(),
        ..initial
    }
}

/// Moves views of retired types (and their placements, bar memberships and presentations)
/// into the `retiredDemos` archive (`retireDemoViews`).
pub fn retire_demo_views(
    source: WorkbenchSnapshot,
    registry: &Registry,
) -> Result<WorkbenchSnapshot, CodecError> {
    let retired: Vec<_> = source
        .organization
        .views
        .iter()
        .filter(|v| registry.get(&v.type_id).is_some_and(|t| t.retired))
        .cloned()
        .collect();
    if retired.is_empty() {
        return Ok(source);
    }
    let ids: Vec<&str> = retired.iter().map(|v| v.id.as_str()).collect();
    let types: Vec<&str> = retired.iter().map(|v| v.type_id.as_str()).collect();
    if source.retired_demos.is_some() {
        return reject("Conflicting retired demo archive");
    }
    let bars = source
        .organization
        .bars
        .iter()
        .map(|bar| {
            let mut positions = bar.positions.clone();
            positions.retain(|id| types.contains(&id));
            (
                bar.id.clone(),
                bar.members
                    .iter()
                    .filter(|m| types.contains(&m.as_str()))
                    .cloned()
                    .collect::<Vec<_>>(),
                positions,
            )
        })
        .filter(|(id, members, _)| id == HOME || !members.is_empty())
        .collect();
    let archive = DemoArchive {
        reference: source.reference,
        views: retired.clone(),
        placements: source
            .placements
            .iter()
            .filter(|p| ids.contains(&p.id.as_str()))
            .cloned()
            .collect(),
        bars,
        presentations: Presentations {
            entries: source
                .organization
                .presentations
                .entries
                .iter()
                .filter(|e| ids.contains(&e.view_id.as_str()))
                .cloned()
                .collect(),
        },
        views_first: true,
    };
    let mut next = source.clone();
    next.retired_demos = Some(archive);
    next.placements.retain(|p| !ids.contains(&p.id.as_str()));
    next.organization
        .views
        .retain(|v| !ids.contains(&v.id.as_str()));
    next.organization.bars = source
        .organization
        .bars
        .iter()
        .map(|bar| {
            let mut positions = bar.positions.clone();
            positions.retain(|id| !types.contains(&id));
            UserBar {
                members: bar
                    .members
                    .iter()
                    .filter(|m| !types.contains(&m.as_str()))
                    .cloned()
                    .collect(),
                positions,
                ..bar.clone()
            }
        })
        .collect();
    next.organization
        .presentations
        .entries
        .retain(|e| !ids.contains(&e.view_id.as_str()));
    Ok(next)
}

// ---- native round trip of `--geppio-demo-fixtures` (owner decision, #75, C2c) ------------
// The reference turns the demo widgets on only in test profiles. The native host accepts the
// flag on the owner's profile and keeps its sessions in a separate document that starts as a
// copy of the owner's one, so switching the flag never loses data or meets a conflict. The
// helper returns a snapshot only when the codec accepts it; otherwise the archive stays.

/// With the demo widgets on, the archive returns to the layout (views, placements, bar
/// memberships and presentations) when every archived type is live, no identity collides and
/// the result is a valid document.
pub fn restore_demo_views(
    source: &WorkbenchSnapshot,
    registry: &Registry,
) -> Option<WorkbenchSnapshot> {
    let archive = source.retired_demos.as_ref()?;
    if archive
        .views
        .iter()
        .any(|v| registry.get(&v.type_id).is_none_or(|t| t.retired))
        || archive
            .views
            .iter()
            .any(|v| source.organization.views.iter().any(|w| w.id == v.id))
    {
        return None;
    }
    let mut next = source.clone();
    next.retired_demos = None;
    next.organization
        .views
        .extend(archive.views.iter().cloned());
    // Archived placements were stored against the archive's reference sizes; a document saved
    // since then may have new ones, so they are projected into the current reference.
    let placements = if archive.reference == source.reference {
        archive.placements.clone()
    } else {
        let constraints = super::model::snapshot_constraints(&next, registry);
        let mut moved = Vec::new();
        for region in crate::layout::Region::ALL {
            if !archive.placements.iter().any(|p| p.region == region) {
                continue;
            }
            let projected = crate::freeform::project_region(
                &archive.placements,
                &archive.reference,
                region,
                *source.reference.get(region),
                false,
                &constraints,
            );
            if !projected.feasible {
                return None;
            }
            moved.extend(projected.placements);
        }
        moved
    };
    next.placements.extend(placements);
    for (bar_id, members, positions) in &archive.bars {
        let bar = next
            .organization
            .bars
            .iter_mut()
            .find(|b| b.id == *bar_id)?;
        for member in members {
            if !bar.members.contains(member) {
                bar.members.push(member.clone());
            }
        }
        for (type_id, y) in positions.iter() {
            bar.positions.set_default(type_id, y);
        }
    }
    next.organization
        .presentations
        .entries
        .extend(archive.presentations.entries.iter().cloned());
    validated(&next, registry)
}

/// The document as the codec accepts it (serialize, then parse), or `None`.
fn validated(next: &WorkbenchSnapshot, registry: &Registry) -> Option<WorkbenchSnapshot> {
    let raw = super::codec::serialize_workbench(next, registry).ok()?;
    super::codec::parse_workbench(&raw, registry).ok()
}
