//! Saved compositions (`shared/workbench/compositions.ts`) and format-slot reservations
//! (`shared/workbench/slots.ts`): system presets, capture, apply format or widgets, the
//! favorite/default/order library and session slots.
use super::chrome::{ChromePatch, ChromePatchEntry, apply_chrome};
use super::commands::{add_widget, fit_targets, move_view};
use super::model::{
    Composition, CompositionMode, FormatSlot, FormatSource, Presence, Registry, SessionDraft,
    SessionSlot, View, WidgetGroups, WorkbenchSnapshot, initial_workbench, limits,
    surface_placements,
};
use crate::layout::policy::{GAP, MAX_WIDGETS};
use crate::layout::{Bounds, Placement, Region, Size, Surface, collides};

pub use super::model::ApplyMode;

/// The built-in presets Padrão, Foco and Equilibrado (`systemCompositions`).
pub fn system_compositions(demo_fixtures: bool) -> Vec<Composition> {
    let initial = initial_workbench(demo_fixtures);
    [
        ("default", "Padrão"),
        ("focus", "Foco"),
        ("balanced", "Equilibrado"),
    ]
    .into_iter()
    .map(|(id, name)| {
        let focus = id == "focus";
        let ids: [&str; 2] = if focus {
            ["summary", "queue"]
        } else {
            ["summary", "chart"]
        };
        let (width, height) = (initial.reference.main.width, initial.reference.main.height);
        let format: Vec<FormatSlot> = ids
            .iter()
            .enumerate()
            .map(|(i, widget)| {
                let chart = *widget == "chart";
                FormatSlot {
                    id: format!("format:{id}:{i}"),
                    region: if chart { Region::Bottom } else { Region::Main },
                    x: if focus {
                        i as f64 * (width + GAP) / 2.0
                    } else {
                        0.0
                    },
                    y: 0.0,
                    width: if chart {
                        initial.reference.bottom.width
                    } else if focus {
                        (width - GAP) / 2.0
                    } else {
                        width
                    },
                    height: if chart {
                        initial.reference.bottom.height
                    } else {
                        height
                    },
                }
            })
            .collect();
        let placements = ids
            .iter()
            .zip(&format)
            .map(|(widget, slot)| {
                Placement::new(
                    *widget,
                    slot.region,
                    Bounds::new(slot.x, slot.y, slot.width, slot.height),
                )
            })
            .collect();
        let chrome = ChromePatch {
            sidebar: Some(ChromePatchEntry {
                size: Some(if id == "balanced" { 238.0 } else { 283.0 }),
                visible: None,
            }),
            bottom: (!focus).then_some(ChromePatchEntry {
                size: Some(if id == "balanced" { 200.0 } else { 167.0 }),
                visible: None,
            }),
        };
        Composition {
            id: format!("system:{id}"),
            name: name.to_owned(),
            system: true,
            scopes: if focus {
                vec![Region::Main]
            } else {
                vec![Region::Main, Region::Bottom]
            },
            reference: initial.reference,
            views: initial
                .organization
                .views
                .iter()
                .filter(|v| ids.contains(&v.id.as_str()))
                .cloned()
                .collect(),
            placements: if demo_fixtures {
                placements
            } else {
                Vec::new()
            },
            mode: CompositionMode::FormatWidgets,
            format,
            chrome: Some(chrome),
            groups: None,
            portable: None,
        }
    })
    .collect()
}

/// A composition with retired views (and their placements) removed (`availableComposition`).
pub fn available_composition(source: &Composition, registry: &Registry) -> Composition {
    let views: Vec<View> = source
        .views
        .iter()
        .filter(|v| !registry.get(&v.type_id).is_some_and(|t| t.retired))
        .cloned()
        .collect();
    let placements = source
        .placements
        .iter()
        .filter(|p| views.iter().any(|v| v.id == p.id))
        .cloned()
        .collect();
    Composition {
        views,
        placements,
        ..source.clone()
    }
}

/// The current scene captured for "Salvar atual" (`captureCurrentComposition`).
pub fn capture_current_composition(
    snapshot: &WorkbenchSnapshot,
    id: &str,
    name: &str,
    scopes: &[Region],
    sidebar_width: bool,
    slots: &[SessionSlot],
) -> Composition {
    let chrome = ChromePatch {
        sidebar: sidebar_width.then_some(ChromePatchEntry {
            size: Some(snapshot.organization.chrome.sidebar.size),
            visible: None,
        }),
        bottom: scopes
            .contains(&Region::Bottom)
            .then_some(ChromePatchEntry {
                size: Some(snapshot.organization.chrome.bottom.size),
                visible: None,
            }),
    };
    capture_composition(
        snapshot,
        id,
        name,
        CompositionMode::FormatWidgets,
        scopes,
        Some(chrome),
        slots,
    )
}

/// Adopts displayed geometry only for the composition's regions (`compositionScene`).
pub fn composition_scene(
    source: &WorkbenchSnapshot,
    displayed: &WorkbenchSnapshot,
    scopes: &[Region],
) -> WorkbenchSnapshot {
    let mut next = source.clone();
    for &region in scopes {
        *next.reference.get_mut(region) = *displayed.reference.get(region);
    }
    next.placements = source
        .placements
        .iter()
        .map(|p| {
            if scopes.contains(&p.region) {
                displayed
                    .placements
                    .iter()
                    .find(|q| q.id == p.id)
                    .cloned()
                    .unwrap_or_else(|| p.clone())
            } else {
                p.clone()
            }
        })
        .collect();
    next
}

/// Applies a composition's chrome and reconciles the scoped reference sizes
/// (`compositionChrome`).
pub fn composition_chrome(
    source: &WorkbenchSnapshot,
    composition: &Composition,
) -> WorkbenchSnapshot {
    let mut patch = ChromePatch::default();
    let side = composition
        .chrome
        .and_then(|c| c.sidebar)
        .and_then(|e| e.size);
    let bottom = composition
        .chrome
        .and_then(|c| c.bottom)
        .and_then(|e| e.size);
    if let Some(size) = side {
        patch.sidebar = Some(ChromePatchEntry {
            size: Some(size),
            visible: None,
        });
    }
    if composition.scopes.contains(&Region::Bottom) {
        patch.bottom = Some(ChromePatchEntry {
            size: bottom,
            visible: Some(true),
        });
    }
    let chrome = apply_chrome(&source.organization.chrome, &patch);
    let mut reference = source.reference;
    let dx = source.organization.chrome.sidebar.size - chrome.sidebar.size;
    let dy = source.organization.chrome.bottom.size - chrome.bottom.size;
    for &region in &composition.scopes {
        if region != Region::Sidebar {
            let r = reference.get_mut(region);
            r.width = (r.width + dx).max(1.0);
        }
        if region == Region::Main {
            reference.main.height = (reference.main.height + dy).max(1.0);
        }
        if region == Region::Bottom {
            reference.bottom.height = (reference.bottom.height - dy).max(1.0);
        }
    }
    let mut next = source.clone();
    next.reference = reference;
    next.organization.chrome = chrome;
    next
}

/// Captures the scoped placements, views, groups and format (`captureComposition`).
pub fn capture_composition(
    snapshot: &WorkbenchSnapshot,
    id: &str,
    name: &str,
    mode: CompositionMode,
    scopes: &[Region],
    chrome: Option<ChromePatch>,
    slots: &[SessionSlot],
) -> Composition {
    let placements: Vec<Placement> = snapshot
        .placements
        .iter()
        .filter(|p| scopes.contains(&p.region))
        .cloned()
        .collect();
    let mut cells: Vec<(Region, f64, f64, f64, f64)> = placements
        .iter()
        .map(|p| (p.region, p.x, p.y, p.width, p.height))
        .collect();
    for slot in slots.iter().filter(|s| {
        scopes.contains(&s.region)
            && s.sidebar_bar
                .as_ref()
                .is_none_or(|bar| *bar == snapshot.organization.active_bar)
    }) {
        let p = project_session_slot(slot, *snapshot.reference.get(slot.region));
        cells.push((p.region, p.x, p.y, p.width, p.height));
    }
    let widgets = mode == CompositionMode::FormatWidgets;
    let surface = surface_placements(snapshot);
    Composition {
        id: id.to_owned(),
        name: name.to_owned(),
        system: false,
        scopes: scopes.to_vec(),
        reference: snapshot.reference,
        mode,
        placements: if widgets {
            placements.clone()
        } else {
            Vec::new()
        },
        views: if widgets {
            snapshot
                .organization
                .views
                .iter()
                .filter(|v| {
                    surface
                        .iter()
                        .any(|p| p.id == v.id && scopes.contains(&p.region))
                })
                .cloned()
                .collect()
        } else {
            Vec::new()
        },
        groups: if widgets {
            snapshot.organization.groups.as_ref().map(|g| WidgetGroups {
                entries: g
                    .entries
                    .iter()
                    .filter(|group| placements.iter().any(|p| p.id == group.frame_id))
                    .cloned()
                    .collect(),
            })
        } else {
            None
        },
        format: cells
            .into_iter()
            .enumerate()
            .map(|(i, (region, x, y, width, height))| FormatSlot {
                id: format!("format:{i}"),
                region,
                x,
                y,
                width,
                height,
            })
            .collect(),
        chrome,
        portable: None,
    }
}

/// Every composition identity the library knows (system presets first).
fn known(source: &WorkbenchSnapshot) -> Vec<String> {
    system_compositions(false)
        .into_iter()
        .map(|c| c.id)
        .chain(
            source
                .organization
                .compositions
                .iter()
                .map(|c| c.id.clone()),
        )
        .collect()
}

/// Favorite / default changes (`favoriteComposition`). `replace` names the favorite to drop
/// when the 9 favorites are full; `None` there means the change is refused.
pub fn favorite_composition(
    source: &WorkbenchSnapshot,
    id: &str,
    favorite: bool,
    make_default: bool,
    replace: Option<&str>,
) -> Option<WorkbenchSnapshot> {
    let mut next = source.clone();
    if !known(source).iter().any(|k| k == id) {
        return None;
    }
    let organization = &mut next.organization;
    if !favorite {
        organization.favorites.retain(|f| f != id);
        if organization.default_composition.as_deref() == Some(id) {
            organization.default_composition = None;
        }
    } else if !organization.favorites.iter().any(|f| f == id) {
        if organization.favorites.len() >= limits::FAVORITES {
            let index = replace.and_then(|r| organization.favorites.iter().position(|f| f == r))?;
            organization.favorites.remove(index);
            if organization.default_composition.as_deref() == replace {
                organization.default_composition = None;
            }
        }
        organization.favorites.push(id.to_owned());
    }
    if make_default {
        if !favorite {
            return None;
        }
        organization.default_composition = Some(id.to_owned());
    }
    Some(next)
}

/// The displayed order of a library tab (`compositionOrder`).
pub fn composition_order(snapshot: &WorkbenchSnapshot, favorites: bool) -> Vec<String> {
    if favorites {
        return snapshot.organization.favorites.clone();
    }
    let order = snapshot
        .organization
        .composition_order
        .clone()
        .unwrap_or_default();
    let mut out = order.clone();
    out.extend(known(snapshot).into_iter().filter(|id| !order.contains(id)));
    out
}

/// Moves `id` before `before` (or to the end) in a library tab (`reorderComposition`).
pub fn reorder_composition(
    source: &WorkbenchSnapshot,
    id: &str,
    before: Option<&str>,
    favorites: bool,
) -> Option<WorkbenchSnapshot> {
    let order = composition_order(source, favorites);
    if !order.iter().any(|o| o == id)
        || before == Some(id)
        || before.is_some_and(|b| !order.iter().any(|o| o == b))
    {
        return None;
    }
    let mut next_order: Vec<String> = order.iter().filter(|o| *o != id).cloned().collect();
    let at = before
        .and_then(|b| next_order.iter().position(|o| o == b))
        .unwrap_or(next_order.len());
    next_order.insert(at, id.to_owned());
    if next_order == order {
        return None;
    }
    let mut next = source.clone();
    if favorites {
        next.organization.favorites = next_order;
    } else {
        next.organization.composition_order = Some(next_order);
    }
    Some(next)
}

/// Applies a composition's format or widgets to the scene (`applyComposition`).
pub fn apply_composition(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    composition: &Composition,
    mode: ApplyMode,
) -> Option<WorkbenchSnapshot> {
    if mode == ApplyMode::Widgets && composition.portable.is_some() {
        return None;
    }
    let composition = available_composition(composition, registry);
    let mut next = composition_chrome(source, &composition);
    if mode == ApplyMode::Widgets {
        if composition.mode != CompositionMode::FormatWidgets {
            return None;
        }
        let preserved: Vec<_> = next
            .organization
            .groups
            .as_ref()
            .map(|g| {
                g.entries
                    .iter()
                    .filter(|group| {
                        source.placements.iter().any(|p| {
                            p.id == group.frame_id && !composition.scopes.contains(&p.region)
                        })
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let mut entries = preserved;
        entries.extend(composition.groups.iter().flat_map(|g| g.entries.clone()));
        if !entries.is_empty() || next.organization.groups.is_some() || composition.groups.is_some()
        {
            next.organization.groups = Some(WidgetGroups { entries });
        }
        for view in &composition.views {
            if !registry.has(&view.type_id) {
                return None;
            }
            match next.organization.views.iter().find(|v| v.id == view.id) {
                Some(existing) if existing.type_id != view.type_id => return None,
                Some(_) => {}
                None => next.organization.views.push(view.clone()),
            }
        }
        let surface = surface_placements(source);
        if surface.iter().any(|p| {
            composition.views.iter().any(|v| v.id == p.id)
                && !composition.scopes.contains(&p.region)
        }) {
            return None;
        }
        for view in &composition.views {
            let group = composition.groups.as_ref().and_then(|g| {
                g.entries
                    .iter()
                    .find(|group| group.members.contains(&view.id))
            });
            let frame = group.map_or(view.id.as_str(), |g| g.frame_id.as_str());
            let region = composition
                .placements
                .iter()
                .find(|p| p.id == frame)
                .map(|p| p.region);
            let ty = registry.get(&view.type_id)?;
            let region = region?;
            if surface.iter().any(|p| {
                !composition.scopes.contains(&p.region)
                    && source
                        .organization
                        .views
                        .iter()
                        .any(|v| v.id == p.id && v.type_id == ty.id)
                    && (ty.presence == Presence::SingleView || p.region == region)
            }) {
                return None;
            }
        }
        if next.organization.views.len() > MAX_WIDGETS {
            return None;
        }
        return fit_targets(
            &next,
            registry,
            &composition.placements,
            &composition.reference,
            &composition.scopes,
        );
    }
    let mut targets: Vec<Placement> = Vec::new();
    for &region in &composition.scopes {
        let widgets: Vec<&Placement> = source
            .placements
            .iter()
            .filter(|p| p.region == region)
            .collect();
        let cells: Vec<&FormatSlot> = composition
            .format
            .iter()
            .filter(|s| s.region == region)
            .collect();
        if !widgets.is_empty() && cells.is_empty() {
            return None;
        }
        let mut buckets: Vec<Vec<&Placement>> = cells.iter().map(|_| Vec::new()).collect();
        for (index, widget) in widgets.into_iter().enumerate() {
            let n = buckets.len();
            buckets[index % n].push(widget);
        }
        for (cell, occupants) in cells.iter().zip(&buckets) {
            let count = occupants.len() as f64;
            for (j, p) in occupants.iter().enumerate() {
                let height = (cell.height - GAP * (count - 1.0)) / count;
                targets.push(Placement {
                    x: cell.x,
                    y: cell.y + j as f64 * (height + GAP),
                    width: cell.width,
                    height,
                    preferred: Size::new(cell.width, height),
                    ..(*p).clone()
                });
            }
        }
    }
    fit_targets(
        &next,
        registry,
        &targets,
        &composition.reference,
        &composition.scopes,
    )
}

/// The library's "Formato" / "Widgets" on the edit draft (`applyLocal` in
/// `CompositionLibrary.tsx`). `view` is the displayed scene. Applying the current format
/// again empties its regions into reserved slots and holds their widgets aside; applying a
/// format afterwards deals them back. Returns the next draft or the refusal (pt-BR).
pub fn apply_to_draft(
    draft: &SessionDraft,
    view: &WorkbenchSnapshot,
    registry: &Registry,
    item: &Composition,
    requested: ApplyMode,
) -> Result<SessionDraft, &'static str> {
    let scoped = |region: Region| item.scopes.contains(&region);
    let scene = composition_scene(&draft.snapshot, view, &item.scopes);
    let remaining: Vec<Placement> = draft
        .format_source
        .as_ref()
        .map(|s| {
            s.placements
                .iter()
                .filter(|p| !scoped(p.region))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let retained = draft
        .format_source
        .as_ref()
        .filter(|_| !remaining.is_empty())
        .map(|s| FormatSource {
            placements: remaining.clone(),
            reference: s.reference,
        });
    let slots_with = |next: &WorkbenchSnapshot| -> Vec<SessionSlot> {
        draft
            .slots
            .iter()
            .filter(|s| !scoped(s.region))
            .cloned()
            .chain(composition_slots(item, next))
            .collect()
    };
    if requested == ApplyMode::Format
        && draft.format_mode == Some(ApplyMode::Format)
        && draft.format_id.as_deref() == Some(item.id.as_str())
        && view.placements.iter().any(|p| scoped(p.region))
    {
        let grouped = view.organization.groups.as_ref().is_some_and(|g| {
            g.entries.iter().any(|group| {
                view.placements
                    .iter()
                    .any(|p| p.id == group.frame_id && scoped(p.region))
            })
        });
        if grouped {
            return Err("Separe as abas antes de converter grupos em espaços reservados.");
        }
        let mut next = composition_chrome(&scene, item);
        next.placements = scene
            .placements
            .iter()
            .filter(|p| !scoped(p.region))
            .cloned()
            .collect();
        let mut reference = retained.as_ref().map_or(view.reference, |r| r.reference);
        for &region in &item.scopes {
            *reference.get_mut(region) = *view.reference.get(region);
        }
        let mut placements = remaining;
        placements.extend(view.placements.iter().filter(|p| scoped(p.region)).cloned());
        let slots = slots_with(&next);
        return Ok(SessionDraft {
            snapshot: next,
            slots,
            format_id: Some(item.id.clone()),
            format_mode: Some(ApplyMode::Format),
            format_source: Some(FormatSource {
                placements,
                reference,
            }),
            local: draft.local.clone(),
        });
    }
    let base = match (&draft.format_source, requested) {
        (Some(source), ApplyMode::Format) => {
            let mut base = scene;
            base.placements.extend(
                source
                    .placements
                    .iter()
                    .filter(|p| {
                        scoped(p.region)
                            && !view
                                .placements
                                .iter()
                                .any(|q| q.id == p.id || q.region == p.region)
                    })
                    .cloned(),
            );
            base
        }
        _ => scene,
    };
    let next = apply_composition(&base, registry, item, requested)
        .ok_or("Composição incompatível ou sem espaço. Amplie a região e tente novamente.")?;
    let slots = slots_with(&next);
    Ok(SessionDraft {
        snapshot: next,
        slots,
        format_id: Some(item.id.clone()),
        format_mode: Some(requested),
        format_source: retained,
        local: draft.local.clone(),
    })
}

/// A session slot projected to another reference size (`projectSessionSlot`).
pub fn project_session_slot(slot: &SessionSlot, to: Size) -> SessionSlot {
    let from = slot.reference;
    SessionSlot {
        x: slot.x / from.width * to.width,
        y: slot.y / from.height * to.height,
        width: slot.width / from.width * to.width,
        height: slot.height / from.height * to.height,
        reference: to,
        ..slot.clone()
    }
}

/// The free format cells of an applied composition, as session slots (`compositionSlots`).
pub fn composition_slots(
    composition: &Composition,
    snapshot: &WorkbenchSnapshot,
) -> Vec<SessionSlot> {
    composition
        .format
        .iter()
        .filter(|slot| composition.scopes.contains(&slot.region))
        .map(|slot| {
            let from = composition.reference.get(slot.region);
            let to = *snapshot.reference.get(slot.region);
            SessionSlot {
                id: format!("session:{}:{}", composition.id, slot.id),
                region: slot.region,
                x: slot.x / from.width * to.width,
                y: slot.y / from.height * to.height,
                width: slot.width / from.width * to.width,
                height: slot.height / from.height * to.height,
                sidebar_bar: (slot.region == Region::Sidebar)
                    .then(|| snapshot.organization.active_bar.clone()),
                reference: to,
            }
        })
        .filter(|slot| {
            !snapshot.placements.iter().any(|p| {
                p.region == slot.region
                    && collides(
                        &p.bounds(),
                        &Bounds::new(slot.x, slot.y, slot.width, slot.height),
                    )
            })
        })
        .collect()
}

/// What fills a reserved slot (`SlotIntention`).
#[derive(Clone, Debug, PartialEq)]
pub enum SlotIntention {
    /// A new widget from the catalog.
    Catalog(String),
    /// An existing view moved into the slot (from `source_bar` when it is a Sidebar view).
    Move {
        /// View identity.
        view_id: String,
        /// Bar the view comes from.
        source_bar: String,
    },
}

/// Fills a reserved slot by click or drop (`fillReservation`): the scene and the remaining
/// slots.
pub fn fill_reservation(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    slots: &[SessionSlot],
    id: &str,
    surface: &Surface,
    intention: &SlotIntention,
    disabled: &[String],
) -> Option<(WorkbenchSnapshot, Vec<SessionSlot>)> {
    let stored = slots
        .iter()
        .find(|s| s.id == id && s.region == surface.region)?;
    if stored
        .sidebar_bar
        .as_ref()
        .is_some_and(|bar| *bar != source.organization.active_bar)
    {
        return None;
    }
    if let SlotIntention::Move {
        view_id,
        source_bar,
    } = intention
    {
        let view = source
            .organization
            .views
            .iter()
            .find(|v| v.id == *view_id)?;
        let placement = source.placements.iter().find(|p| p.id == *view_id)?;
        if placement.region == Region::Sidebar
            && !source
                .organization
                .bars
                .iter()
                .any(|bar| bar.id == *source_bar && bar.members.contains(&view.type_id))
        {
            return None;
        }
    }
    let slot = project_session_slot(stored, Size::new(surface.width, surface.height));
    let size = Size::new(slot.width, slot.height);
    let at = Some((slot.x, slot.y));
    let next = match intention {
        SlotIntention::Catalog(type_id) => {
            add_widget(source, registry, type_id, surface, at, disabled, Some(size))
        }
        SlotIntention::Move {
            view_id,
            source_bar,
        } => move_view(
            source,
            registry,
            view_id,
            surface,
            at,
            Some(source_bar),
            Some(size),
            disabled,
        ),
    }?;
    Some((next, slots.iter().filter(|s| s.id != id).cloned().collect()))
}
