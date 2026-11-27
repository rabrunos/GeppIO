//! Demo retirement (`shared/workbench/retirement.ts`). Only validated identities are
//! retired; the archive survives explicit saves and startup never writes bytes.
use super::model::{DemoArchive, HOME, Registry, UserBar, WorkbenchSnapshot};
use super::presentations::Presentations;
use crate::freeform::CodecError;
use crate::freeform::schema::reject;

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
