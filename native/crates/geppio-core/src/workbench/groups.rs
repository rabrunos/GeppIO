//! Regional tab groups (`shared/workbench/groups.ts`): codec, validation and the bounded
//! group transfer used by cross-region moves.
use super::commands::move_frame;
use super::model::{
    Registry, View, WidgetGroup, WidgetGroups, WorkbenchSnapshot, active_placements, frame_types,
    group_for, snapshot_constraints,
};
use super::presentations::{Presentation, presentation_of};
use crate::freeform::schema::reject;
use crate::freeform::{CodecError, constraints_for};
use crate::json::Json;
use crate::layout::policy::MAX_WIDGETS;
use crate::layout::{Region, Surface, valid_layout};

fn group_id(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("group:")
        && value[6..]
            .bytes()
            .all(|b| matches!(b, b'a'..=b'f' | b'0'..=b'9' | b'-'))
}

fn exact(value: &crate::json::JsonObject, keys: &[&str]) -> bool {
    value.len() == keys.len() && value.keys().all(|k| keys.contains(&k))
}

/// Validates tab groups (`parseGroups`).
pub fn parse_groups(
    value: Option<&Json>,
    views: &[View],
    registry: &Registry,
) -> Result<Option<WidgetGroups>, CodecError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value.as_object();
    let entries = value.get("entries").and_then(Json::as_array);
    let (Some(object), Some(entries)) = (object, entries) else {
        return reject("Unsupported tab groups");
    };
    if !exact(object, &["version", "entries"])
        || object.get("version").and_then(Json::as_f64) != Some(1.0)
        || entries.len() > MAX_WIDGETS
    {
        return reject("Unsupported tab groups");
    }
    let mut ids: Vec<String> = Vec::new();
    let mut used: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for item in entries {
        let invalid = || reject("Invalid tab group");
        let Some(o) = item.as_object() else {
            return invalid();
        };
        if !exact(o, &["id", "frameId", "members", "active"]) {
            return invalid();
        }
        let id = o.get("id").and_then(Json::as_str);
        let members = o.get("members").and_then(Json::as_array);
        let frame = o.get("frameId").and_then(Json::as_str);
        let active = o.get("active").and_then(Json::as_str);
        let (Some(id), Some(members), Some(frame), Some(active)) = (id, members, frame, active)
        else {
            return invalid();
        };
        let includes = |s: &str| members.iter().any(|m| m.as_str() == Some(s));
        if !group_id(id)
            || ids.iter().any(|i| i == id)
            || members.len() < 2
            || members.len() > MAX_WIDGETS
            || !includes(frame)
            || !includes(active)
        {
            return invalid();
        }
        ids.push(id.to_owned());
        let mut member_ids = Vec::with_capacity(members.len());
        for member in members {
            let view = member
                .as_str()
                .and_then(|m| views.iter().find(|v| v.id == m));
            let Some(view) = view else {
                return reject("Invalid tab membership");
            };
            if used.contains(&view.id) || !registry.get(&view.type_id).is_some_and(|t| t.tab_member)
            {
                return reject("Invalid tab membership");
            }
            used.push(view.id.clone());
            member_ids.push(view.id.clone());
        }
        let host = views
            .iter()
            .find(|v| v.id == frame)
            .expect("frame is a member view");
        if !registry.get(&host.type_id).is_some_and(|t| t.tab_host) {
            return reject("Ineligible tab host");
        }
        out.push(WidgetGroup {
            id: id.to_owned(),
            frame_id: frame.to_owned(),
            members: member_ids,
            active: active.to_owned(),
        });
    }
    Ok(Some(WidgetGroups { entries: out }))
}

/// Frames exist, Sidebar frames belong to exactly one bar and grouped presences do not
/// conflict (`validateGroups`).
pub fn validate_groups(source: &WorkbenchSnapshot, registry: &Registry) -> Result<(), CodecError> {
    let empty = Vec::new();
    let groups = source
        .organization
        .groups
        .as_ref()
        .map_or(&empty, |g| &g.entries);
    // A placement without a view throws a TypeError in the reference.
    let missing = || reject("Invalid snapshot");
    let mut occupied: Vec<String> = Vec::new();
    for p in &source.placements {
        let Some(t) = source.type_of(&p.id) else {
            return missing();
        };
        if !occupied.iter().any(|o| o == t) {
            occupied.push(t.to_owned());
        }
    }
    for group in groups {
        let Some(frame) = source.placement(&group.frame_id) else {
            return reject("Missing group frame");
        };
        if frame.region == Region::Sidebar {
            let types = frame_types(source, &group.frame_id);
            let bars = &source.organization.bars;
            let owners = bars
                .iter()
                .filter(|bar| types.iter().all(|t| bar.members.contains(t)))
                .count();
            if owners != 1
                || types
                    .iter()
                    .any(|t| bars.iter().filter(|bar| bar.members.contains(t)).count() != 1)
            {
                return reject("Invalid group bar ownership");
            }
        }
        for id in &group.members {
            let Some(view) = source.view(id) else {
                return missing();
            };
            let Some(member_type) = registry.get(&view.type_id) else {
                return missing();
            };
            let allowed = member_type.constraint.allows(frame.region);
            if !allowed
                || presentation_of(source, id) != Presentation::Normal
                || (*id != group.frame_id
                    && (source.placements.iter().any(|p| p.id == *id)
                        || occupied.contains(&view.type_id)))
            {
                return reject("Conflicting grouped presence");
            }
            if !occupied.contains(&view.type_id) {
                occupied.push(view.type_id.clone());
            }
        }
    }
    Ok(())
}

/// Every region (and every bar's Sidebar scene) is a valid layout (`validGroupScene`).
pub fn valid_group_scene(source: &WorkbenchSnapshot, registry: &Registry) -> bool {
    let cs = snapshot_constraints(source, registry);
    Region::ALL.into_iter().all(|region| {
        let scenes: Vec<WorkbenchSnapshot> = if region == Region::Sidebar {
            source
                .organization
                .bars
                .iter()
                .map(|bar| source.with_active_bar(&bar.id))
                .collect()
        } else {
            vec![source.clone()]
        };
        scenes.iter().all(|scene| {
            let surface = Surface::of(
                region,
                *source.reference.get(region),
                region == Region::Main,
            );
            let placements: Vec<_> = active_placements(scene, true)
                .into_iter()
                .filter(|p| p.region == region)
                .collect();
            valid_layout(&placements, &surface, &constraints_for(&surface, &cs))
        })
    })
}

/// The partition of a group moving to another region (`groupTransferPlan`).
#[derive(Clone, Debug, PartialEq)]
pub struct GroupTransferPlan {
    /// The group.
    pub group: WidgetGroup,
    /// Members eligible for the destination.
    pub going: Vec<String>,
    /// Members that stay.
    pub staying: Vec<String>,
    /// Frame of the moving part.
    pub destination_frame: Option<String>,
    /// Frame of the remaining part.
    pub source_frame: Option<String>,
    /// Refusal reason (pt-BR), if any.
    pub reason: Option<&'static str>,
}

impl GroupTransferPlan {
    /// Whether the transfer may proceed.
    pub fn allowed(&self) -> bool {
        self.reason.is_none()
    }
}

/// Plans the transfer of a group frame to `destination`.
pub fn group_transfer_plan(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    destination: Region,
) -> Option<GroupTransferPlan> {
    let group = group_for(source, id)?;
    let placement = source.placement(&group.frame_id)?;
    if group.frame_id != id {
        return None;
    }
    let t = |member: &str| {
        registry
            .get(source.type_of(member).expect("member view"))
            .expect("member type")
    };
    let going: Vec<String> = group
        .members
        .iter()
        .filter(|m| t(m).constraint.allows(destination))
        .cloned()
        .collect();
    let staying: Vec<String> = group
        .members
        .iter()
        .filter(|m| !going.contains(m))
        .cloned()
        .collect();
    let carrier = |members: &[String]| -> Option<String> {
        if members.contains(&group.frame_id) && (members.len() == 1 || t(&group.frame_id).tab_host)
        {
            Some(group.frame_id.clone())
        } else {
            members
                .iter()
                .find(|m| members.len() == 1 || t(m).tab_host)
                .cloned()
        }
    };
    let destination_frame = carrier(&going);
    let source_frame = carrier(&staying);
    let legal = |members: &[String]| {
        members.len() < 2 || (members.iter().all(|m| t(m).tab_member) && carrier(members).is_some())
    };
    let shared_bar = placement.region == Region::Sidebar
        && group.members.iter().any(|m| {
            source
                .organization
                .bars
                .iter()
                .filter(|bar| bar.members.contains(&t(m).id))
                .count()
                != 1
        });
    let reason = if going.is_empty() {
        Some("Nenhuma aba é compatível com o destino.")
    } else if !legal(&going) || !legal(&staying) {
        Some("Uma das partes não tem host compatível.")
    } else if shared_bar {
        Some("O grupo está associado a outra barra lateral.")
    } else {
        None
    };
    Some(GroupTransferPlan {
        group: group.clone(),
        going,
        staying,
        destination_frame,
        source_frame,
        reason,
    })
}

/// A new random group identity (`group:<uuid v4>`), like `crypto.randomUUID()`.
pub fn new_group_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let state = RandomState::new();
    let mut words = [0u64; 2];
    for (i, word) in words.iter_mut().enumerate() {
        let mut h = state.build_hasher();
        h.write_usize(i);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos()),
        );
        *word = h.finish();
    }
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&words[0].to_le_bytes());
    bytes[8..].copy_from_slice(&words[1].to_le_bytes());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "group:{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Partitions a group and places exactly one bounded destination frame through the
/// ordinary move (`transferGroup`). Any failure discards the private snapshot.
#[allow(clippy::too_many_arguments)] // Mirrors the reference signature.
pub fn transfer_group(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    id: &str,
    target: &Surface,
    at: Option<(f64, f64)>,
    source_bar: &str,
    disabled: &[String],
) -> Option<WorkbenchSnapshot> {
    let plan = group_transfer_plan(source, registry, id, target.region)?;
    let destination_frame = plan.destination_frame.clone()?;
    if !plan.allowed()
        || plan.going.iter().any(|m| {
            disabled.contains(
                &registry
                    .get(source.type_of(m).expect("member view"))
                    .expect("member type")
                    .owner,
            )
        })
    {
        return None;
    }
    let original = source.placement(&plan.group.frame_id)?.clone();
    let mut next = source.clone();
    let mut entries: Vec<WidgetGroup> = next
        .organization
        .groups
        .as_ref()
        .expect("grouped")
        .entries
        .iter()
        .filter(|g| g.id != plan.group.id)
        .cloned()
        .collect();
    let mut partition = |members: &[String], frame_id: &str, group_id: String| {
        if members.len() >= 2 {
            entries.push(WidgetGroup {
                id: group_id,
                frame_id: frame_id.to_owned(),
                members: members.to_vec(),
                active: if members.contains(&plan.group.active) {
                    plan.group.active.clone()
                } else {
                    members[0].clone()
                },
            });
        }
        let mut frame = original.clone();
        frame.id = frame_id.to_owned();
        frame
    };
    next.placements.retain(|p| p.id != id);
    if !plan.staying.is_empty()
        && let Some(source_frame) = &plan.source_frame
    {
        let frame = partition(&plan.staying, source_frame, plan.group.id.clone());
        next.placements.push(frame);
    }
    let going_id = if plan.staying.len() >= 2 {
        new_group_id()
    } else {
        plan.group.id.clone()
    };
    let frame = partition(&plan.going, &destination_frame, going_id);
    next.placements.push(frame);
    next.organization.groups = Some(WidgetGroups { entries });
    if original.region == Region::Sidebar {
        let types = frame_types(source, id);
        let origin = next
            .organization
            .bars
            .iter_mut()
            .find(|b| b.id == source_bar)?;
        if !types.iter().all(|t| origin.members.contains(t)) {
            return None;
        }
        let old_type = source.type_of(id).expect("frame view").to_owned();
        let y = origin.positions.get(&old_type).unwrap_or(original.y);
        origin.members.retain(|t| !types.contains(t));
        for t in &types {
            origin.positions.remove(t);
        }
        if let Some(source_frame) = &plan.source_frame {
            for member in &plan.staying {
                origin
                    .members
                    .push(source.type_of(member).expect("member view").to_owned());
            }
            origin
                .positions
                .set(source.type_of(source_frame).expect("frame view"), y);
        }
    }
    let result = move_frame(
        &next,
        registry,
        &destination_frame,
        target,
        at,
        Some(source_bar),
        None,
        disabled,
    )?;
    if !valid_group_scene(&result, registry) || validate_groups(&result, registry).is_err() {
        return None;
    }
    Some(result)
}
