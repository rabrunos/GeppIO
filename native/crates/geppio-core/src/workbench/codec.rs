//! The `geppio:workbench:v1` envelope (`shared/workbench/codec.ts`): validated layout plus
//! typed organization. Registry declarations stay authoritative; imported metadata cannot
//! grant capabilities or invent executable widget types. The writer reproduces
//! `JSON.stringify` byte for byte, including key order and number formatting.
use super::chrome::{complete, default_chrome, parse_chrome, write_chrome, write_patch};
use super::groups::{parse_groups, validate_groups};
use super::model::{
    BAR_ICONS, Composition, CompositionMode, DemoArchive, FormatSlot, HOME, Organization,
    Positions, Registry, UserBar, View, WidgetGroups, WorkbenchSnapshot, active_parts,
    constraints_for_views, limits, model_id,
};
use super::portable::{js_length, js_space, stored_portable_composition, write_portable};
use super::presentations::{
    Presentation, Presentations, parse_presentations, validate_presentation_edges,
    write_presentations,
};
use super::retirement::retire_demo_views;
use crate::freeform::schema::{oversized, reject};
use crate::freeform::{CodecError, Layout, constraint_in_region, parse_geometry};
use crate::js;
use crate::json::{self, Json, JsonObject, ObjectWriter, write_array, write_string_array};
use crate::layout::policy::{MAX_COORDINATE, MAX_WIDGETS};
use crate::layout::{Bounds, Placement, References, Region, collides};

const SYSTEM_COMPOSITIONS: [&str; 3] = ["system:default", "system:focus", "system:balanced"];

/// `/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/`.
fn identifier(value: Option<&Json>) -> Option<&str> {
    let s = value?.as_str()?;
    let b = s.as_bytes();
    (!b.is_empty()
        && b.len() <= 160
        && b[0].is_ascii_alphanumeric()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b':' | b'.' | b'_' | b'-')))
    .then_some(s)
}

fn list(value: Option<&Json>, cap: usize) -> Result<&Vec<Json>, CodecError> {
    match value.and_then(Json::as_array) {
        Some(a) if a.len() <= cap => Ok(a),
        _ => reject("Invalid bounded list"),
    }
}

fn name(value: Option<&Json>) -> Result<String, CodecError> {
    match value.and_then(Json::as_str) {
        Some(s) if !s.chars().all(js_space) && js_length(s) <= 100 => Ok(s.to_owned()),
        _ => reject("Invalid name"),
    }
}

fn unique<T>(items: Vec<T>, key: impl Fn(&T) -> &str) -> Result<Vec<T>, CodecError> {
    for (i, item) in items.iter().enumerate() {
        if items[..i].iter().any(|other| key(other) == key(item)) {
            return reject("Duplicate identity");
        }
    }
    Ok(items)
}

fn strings(value: Option<&Json>, cap: usize) -> Result<Vec<String>, CodecError> {
    let items = list(value, cap)?
        .iter()
        .map(|item| match identifier(Some(item)) {
            Some(s) => Ok(s.to_owned()),
            None => reject("Invalid identity"),
        })
        .collect::<Result<Vec<_>, _>>()?;
    unique(items, |s| s.as_str())
}

fn parse_views(value: Option<&Json>, registry: &Registry) -> Result<Vec<View>, CodecError> {
    let mut views = Vec::new();
    for item in list(value, MAX_WIDGETS)? {
        let id = identifier(item.get("id"));
        let type_id = item.get("typeId").and_then(Json::as_str);
        let t = type_id.and_then(|t| registry.get(t));
        let (Some(id), Some(type_id), Some(t)) = (id, type_id, t) else {
            return reject("Unknown widget owner/model/view");
        };
        if item.get("modelId").and_then(Json::as_str) != Some(model_id(type_id).as_str()) {
            return reject("Unknown widget owner/model/view");
        }
        let qualified = id.starts_with(&format!("{}:view:", t.id));
        if t.owner != "host" && !qualified {
            return reject("Unqualified plugin view");
        }
        if t.owner == "host" && t.fixture.as_deref() != Some(id) && !qualified {
            return reject("Wrong host view identity");
        }
        views.push(View::new(id, &t.id));
    }
    unique(views, |v| v.id.as_str())
}

fn parse_bars(value: Option<&Json>, registry: &Registry) -> Result<Vec<UserBar>, CodecError> {
    let mut bars = Vec::new();
    for item in list(value, limits::SAVED_BARS + 1)? {
        let id = identifier(item.get("id"));
        let archived = item.get("archived").and_then(Json::as_bool);
        let user_named = item.get("userNamed").and_then(Json::as_bool);
        let icon = item.get("icon").and_then(Json::as_str);
        let (Some(id), Some(archived), Some(user_named), Some(icon)) =
            (id, archived, user_named, icon)
        else {
            return reject("Invalid bar");
        };
        if !BAR_ICONS.contains(&icon) {
            return reject("Invalid bar");
        }
        let members = strings(item.get("members"), MAX_WIDGETS)?;
        if members.iter().any(|m| {
            !registry
                .get(m)
                .is_some_and(|t| t.constraint.allows(Region::Sidebar))
        }) {
            return reject("Invalid Sidebar membership");
        }
        let mut positions = Positions::new();
        if let Some(raw) = item.get("positions") {
            let Some(raw) = raw.as_object() else {
                return reject("Invalid bar geometry");
            };
            if raw.len() > MAX_WIDGETS {
                return reject("Invalid bar geometry");
            }
            for (type_id, y) in raw.iter() {
                match y.finite() {
                    Some(y)
                        if members.iter().any(|m| m == type_id)
                            && (0.0..=MAX_COORDINATE).contains(&y) =>
                    {
                        positions.set(type_id, y)
                    }
                    _ => return reject("Invalid bar geometry"),
                }
            }
        }
        bars.push(UserBar {
            id: id.to_owned(),
            name: name(item.get("name"))?,
            user_named,
            icon: icon.to_owned(),
            archived,
            members,
            positions,
        });
    }
    let bars = unique(bars, |b| b.id.as_str())?;
    // Previously valid 15–20-custom-bar documents remain readable and editable.
    if bars.first().is_none_or(|b| b.id != HOME || b.archived)
        || bars.iter().filter(|b| !b.archived && b.id != HOME).count() > limits::LEGACY_ACTIVE_BARS
    {
        return reject("Protected Home or bar cap");
    }
    Ok(bars)
}

fn reference_json(reference: &References, main_height: Option<f64>) -> Json {
    let size = |s: crate::layout::Size| {
        Json::Object(
            JsonObject::new()
                .with("width", Json::Number(s.width))
                .with("height", Json::Number(s.height)),
        )
    };
    let mut main = reference.main;
    if let Some(h) = main_height {
        main.height = h;
    }
    Json::Object(
        JsonObject::new()
            .with("main", size(main))
            .with("sidebar", size(reference.sidebar))
            .with("bottom", size(reference.bottom)),
    )
}

/// `{ ...layout, reference: …, placements: … }` for nested documents.
fn nested_document(reference: Option<&Json>, placements: Option<&Json>) -> Json {
    let mut o = JsonObject::new()
        .with("schemaVersion", Json::Number(1.0))
        .with("engine", Json::from("freeform"))
        .with("constraintVersion", Json::Number(1.0));
    if let Some(r) = reference {
        o.insert("reference", r.clone());
    }
    if let Some(p) = placements {
        o.insert("placements", p.clone());
    }
    Json::Object(o)
}

fn parse_document(
    value: Option<&Json>,
    views: &[View],
    registry: &Registry,
    bars: Option<&[UserBar]>,
    presentations: Option<&Presentations>,
    groups: Option<&WidgetGroups>,
) -> Result<Layout, CodecError> {
    let Some(document) = value.and_then(Json::as_object) else {
        return reject("Invalid geometry");
    };
    let constraints = constraints_for_views(views, groups, registry);
    // Active panels retain validated Normal seeds that do not constrain the visible scene.
    let panels: Vec<&str> = presentations
        .map(|p| {
            p.entries
                .iter()
                .filter(|e| e.presentation != Presentation::Normal)
                .map(|e| e.view_id.as_str())
                .collect()
        })
        .unwrap_or_default();
    let Some(raw_placements) = document.get("placements").and_then(Json::as_array) else {
        return reject("Missing widget placements");
    };
    let dormant: Vec<bool> = raw_placements
        .iter()
        .map(|p| {
            p.as_object().is_some()
                && p.get("region").and_then(Json::as_str) == Some("main")
                && p.get("id")
                    .and_then(Json::as_str)
                    .is_some_and(|id| panels.contains(&id))
        })
        .collect();
    let ordinary: Vec<Json> = raw_placements
        .iter()
        .zip(&dormant)
        .filter(|(_, d)| !**d)
        .map(|(p, _)| p.clone())
        .collect();
    let ordinary_count = ordinary.len();
    let mut with_ordinary = document.clone();
    with_ordinary.insert("placements", Json::Array(ordinary));
    let sidebar_pairs = bars.is_some();
    let mut layout = parse_geometry(
        &Json::Object(with_ordinary).stringify(),
        &constraints,
        None,
        |a, b| !sidebar_pairs || a.region != Region::Sidebar || b.region != Region::Sidebar,
    )?;
    // Acceptance below needs one distinct placement per raw entry and at most MAX_WIDGETS of
    // them, so a longer list is rejected now instead of re-parsing the document once per seed.
    if raw_placements.len() > MAX_WIDGETS {
        return reject("Duplicate panel identity");
    }
    let mut seeds: Vec<Placement> = Vec::new();
    for (p, _) in raw_placements.iter().zip(&dormant).filter(|(_, d)| **d) {
        let mut seed_document = document.clone();
        seed_document.insert(
            "reference",
            reference_json(&layout.reference, Some(MAX_COORDINATE)),
        );
        seed_document.insert("placements", Json::Array(vec![p.clone()]));
        let parsed = parse_geometry(
            &Json::Object(seed_document).stringify(),
            &constraints,
            None,
            |_, _| true,
        )?;
        seeds.extend(parsed.placements);
    }
    let all: Vec<Placement> = layout.placements.iter().chain(&seeds).cloned().collect();
    let mut distinct: Vec<&str> = Vec::new();
    for p in &all {
        if !distinct.contains(&p.id.as_str()) {
            distinct.push(&p.id);
        }
    }
    if ordinary_count + seeds.len() > MAX_WIDGETS || distinct.len() != raw_placements.len() {
        return reject("Duplicate panel identity");
    }
    layout.placements = raw_placements
        .iter()
        .map(|p| {
            let id = p.get("id").and_then(Json::as_str);
            all.iter()
                .find(|q| Some(q.id.as_str()) == id)
                .cloned()
                .expect("every raw placement was parsed")
        })
        .collect();
    let mut used: Vec<String> = Vec::new();
    for placement in &layout.placements {
        let view = views
            .iter()
            .find(|v| v.id == placement.id)
            .expect("placement view");
        let t = registry.get(&view.type_id).expect("view type");
        let key = match t.presence {
            super::model::Presence::SingleView => t.id.clone(),
            super::model::Presence::MultipleAreas => {
                format!("{}:{}", t.id, placement.region.as_str())
            }
        };
        if used.contains(&key) {
            return reject("Occupied widget presence");
        }
        used.push(key);
    }
    if let Some(bars) = bars {
        for bar in bars {
            let present = |type_id: &str| {
                views.iter().any(|view| {
                    view.type_id == type_id
                        && layout.placements.iter().any(|p| {
                            p.region == Region::Sidebar
                                && (p.id == view.id
                                    || groups.is_some_and(|g| {
                                        g.entries.iter().any(|group| {
                                            group.frame_id == p.id
                                                && group.members.contains(&view.id)
                                        })
                                    }))
                        })
                })
            };
            if bar.members.iter().any(|t| !present(t)) {
                return reject("Missing Sidebar membership view");
            }
            let sidebar: Vec<Placement> = active_parts(&layout.placements, views, Some(bar), false)
                .into_iter()
                .filter(|p| p.region == Region::Sidebar)
                .collect();
            for (i, p) in sidebar.iter().enumerate() {
                if p.y + p.height > MAX_COORDINATE
                    || sidebar[i + 1..]
                        .iter()
                        .any(|q| collides(&p.bounds(), &q.bounds()))
                {
                    return reject("Invalid bar clearance");
                }
            }
        }
    }
    Ok(layout)
}

fn parse_composition(
    item: &Json,
    data_version: f64,
    registry: &Registry,
) -> Result<Composition, CodecError> {
    let invalid = || reject("Invalid saved composition");
    let Some(o) = item.as_object() else {
        return invalid();
    };
    let Some(id) = identifier(o.get("id")) else {
        return invalid();
    };
    if !id.starts_with("composition:") || id.len() <= 12 {
        return invalid();
    }

    if o.has("portable") {
        if data_version != 3.0 || o.keys().any(|k| !["id", "name", "portable"].contains(&k)) {
            return reject("Invalid inert composition");
        }
        let n = name(o.get("name"))?;
        return stored_portable_composition(id, &n, o.get("portable"));
    }
    // A non-string mode is coerced with `String()` by the reference; only strings are read here.
    let mode = o
        .get("mode")
        .and_then(Json::as_str)
        .and_then(CompositionMode::parse);
    let (Some(false), Some(mode)) = (o.get("system").and_then(Json::as_bool), mode) else {
        return invalid();
    };
    let saved_views = parse_views(o.get("views"), registry)?;
    let scope_ids = strings(o.get("scopes"), 3)?;
    let chrome = match o.get("chrome") {
        None => None,
        Some(c) => Some(parse_chrome(Some(c), true)?),
    };
    if (scope_ids.is_empty() && chrome.is_none_or(|c| c.sidebar.is_none() && c.bottom.is_none()))
        || scope_ids.iter().any(|r| r != "main" && r != "bottom")
    {
        return reject("Invalid composition scopes");
    }
    let scopes: Vec<Region> = scope_ids
        .iter()
        .map(|r| Region::parse(r).expect("checked"))
        .collect();
    let saved_groups = parse_groups(o.get("groups"), &saved_views, registry)?;
    let saved = parse_document(
        Some(&nested_document(o.get("reference"), o.get("placements"))),
        &saved_views,
        registry,
        None,
        None,
        saved_groups.as_ref(),
    )?;
    if let Some(groups) = &saved_groups
        && !groups.entries.is_empty()
        && (mode == CompositionMode::Format
            || groups.entries.iter().any(|g| {
                !saved
                    .placements
                    .iter()
                    .any(|p| p.id == g.frame_id && scopes.contains(&p.region))
            }))
    {
        return reject("Invalid scoped tab group");
    }
    let probe = WorkbenchSnapshot {
        reference: saved.reference,
        placements: saved.placements.clone(),
        organization: Organization {
            views: saved_views.clone(),
            bars: Vec::new(),
            active_bar: String::new(),
            compositions: Vec::new(),
            favorites: Vec::new(),
            default_composition: None,
            chrome: default_chrome(),
            presentations: Presentations::default(),
            groups: saved_groups.clone(),
            composition_order: None,
        },
        retired_demos: None,
    };
    validate_groups(&probe, registry)?;
    if saved.placements.iter().any(|p| !scopes.contains(&p.region)) {
        return reject("Invalid scoped placement");
    }
    let mut format = Vec::new();
    for slot in list(o.get("format"), MAX_WIDGETS)? {
        let invalid = || reject("Invalid format geometry");
        let Some(slot_id) = identifier(slot.get("id")) else {
            return invalid();
        };
        let region = slot
            .get("region")
            .and_then(Json::as_str)
            .and_then(Region::parse);
        let Some(region) = region.filter(|r| scopes.contains(r)) else {
            return invalid();
        };
        let n = |k: &str| slot.get(k).and_then(Json::finite);
        let (Some(x), Some(y), Some(width), Some(height)) =
            (n("x"), n("y"), n("width"), n("height"))
        else {
            return invalid();
        };
        let r = saved.reference.get(region);
        if x < 0.0
            || y < 0.0
            || width <= 0.0
            || height <= 0.0
            || x + width > r.width
            || y + height > r.height
        {
            return invalid();
        }
        format.push(FormatSlot {
            id: slot_id.to_owned(),
            region,
            x,
            y,
            width,
            height,
        });
    }
    let format = unique(format, |s| s.id.as_str())?;
    for (i, slot) in format.iter().enumerate() {
        let a = Bounds::new(slot.x, slot.y, slot.width, slot.height);
        if format[i + 1..].iter().any(|other| {
            slot.region == other.region
                && collides(
                    &a,
                    &Bounds::new(other.x, other.y, other.width, other.height),
                )
        }) {
            return reject("Overlapping format slots");
        }
    }
    if mode == CompositionMode::Format && (!saved.placements.is_empty() || !saved_views.is_empty())
    {
        return reject("Format cannot restore executable widget references");
    }
    Ok(Composition {
        id: id.to_owned(),
        name: name(o.get("name"))?,
        system: false,
        scopes,
        reference: saved.reference,
        placements: saved.placements,
        views: saved_views,
        mode,
        format,
        chrome,
        groups: saved_groups,
        portable: None,
    })
}

/// Validates a stored envelope (`parseWorkbench`). Rejections carry the reference message.
pub fn parse_workbench(raw: &str, registry: &Registry) -> Result<WorkbenchSnapshot, CodecError> {
    if oversized(raw) {
        return reject("Workbench exceeds 64 KiB");
    }
    let data = json::parse(raw)?;
    let version = data.get("schemaVersion").and_then(Json::as_f64);
    let (Some(_), Some(version @ (1.0 | 2.0 | 3.0)), Some("geppio-workbench"), Some(source)) = (
        data.as_object(),
        version,
        data.get("kind").and_then(Json::as_str),
        data.get("organization").and_then(Json::as_object),
    ) else {
        return reject("Unsupported workbench");
    };
    let views = parse_views(source.get("views"), registry)?;
    let bars = parse_bars(source.get("bars"), registry)?;
    let presentations = parse_presentations(source.get("presentations"), &views, registry)?;
    let groups = parse_groups(source.get("groups"), &views, registry)?;
    let layout = parse_document(
        data.get("layout"),
        &views,
        registry,
        Some(&bars),
        Some(&presentations),
        groups.as_ref(),
    )?;
    let active_bar = source.get("activeBar").and_then(Json::as_str);
    let Some(active_bar) = active_bar.filter(|a| bars.iter().any(|b| b.id == *a && !b.archived))
    else {
        return reject("Invalid active bar");
    };
    let mut compositions = Vec::new();
    for item in list(source.get("compositions"), limits::COMPOSITIONS)? {
        compositions.push(parse_composition(item, version, registry)?);
    }
    let compositions = unique(compositions, |c| c.id.as_str())?;
    let favorites = strings(source.get("favorites"), limits::FAVORITES)?;
    let known =
        |id: &str| SYSTEM_COMPOSITIONS.contains(&id) || compositions.iter().any(|c| c.id == id);
    let default_value = source.get("defaultComposition");
    let default_composition = match default_value {
        Some(Json::Null) => None,
        Some(Json::String(d)) if favorites.contains(d) => Some(d.clone()),
        _ => return reject("Invalid favorite/default"),
    };
    if favorites.iter().any(|f| !known(f)) {
        return reject("Invalid favorite/default");
    }
    let chrome = match source.get("chrome") {
        None => default_chrome(),
        Some(c) => complete(&parse_chrome(Some(c), false)?),
    };
    let composition_order = match source.get("compositionOrder") {
        None => None,
        Some(value) => {
            let order = strings(Some(value), limits::COMPOSITIONS + 3)?;
            if order.iter().any(|id| !known(id)) {
                return reject("Invalid composition order");
            }
            Some(order)
        }
    };
    let organization = Organization {
        views,
        bars,
        active_bar: active_bar.to_owned(),
        compositions,
        favorites,
        default_composition,
        chrome,
        presentations,
        groups,
        composition_order,
    };
    let mut result = WorkbenchSnapshot {
        reference: layout.reference,
        placements: layout.placements,
        organization,
        retired_demos: None,
    };
    validate_presentation_edges(&result)?;
    validate_groups(&result, registry)?;
    if let Some(archive) = data.get("retiredDemos") {
        let Some(archive) = archive.as_object() else {
            return reject("Invalid retired demo archive");
        };
        let views = parse_views(archive.get("views"), registry)?;
        let mut items = Vec::new();
        for item in list(archive.get("bars"), limits::SAVED_BARS + 1)? {
            let Some(o) = item.as_object() else {
                return reject("Invalid retired bar");
            };
            let home = o.get("id").and_then(Json::as_str) == Some(HOME);
            let mut o = o.clone();
            o.insert("name", Json::from("Retired demos"));
            o.insert("userNamed", Json::Bool(false));
            o.insert("icon", Json::from("home"));
            o.insert("archived", Json::Bool(!home));
            items.push(Json::Object(o));
        }
        let bars = parse_bars(Some(&Json::Array(items)), registry)?;
        let fixture = |t: &str| registry.get(t).is_some_and(|t| t.fixture.is_some());
        if views.iter().any(|v| !fixture(&v.type_id))
            || bars.iter().any(|b| b.members.iter().any(|m| !fixture(m)))
        {
            return reject("Invalid retired demo owner");
        }
        let presentations = parse_presentations(archive.get("presentations"), &views, registry)?;
        let saved = parse_document(
            Some(&nested_document(
                archive.get("reference"),
                archive.get("placements"),
            )),
            &views,
            registry,
            Some(&bars),
            Some(&presentations),
            None,
        )?;
        let mut probe = result.clone();
        probe.reference = saved.reference;
        probe.placements = saved.placements.clone();
        probe.organization.presentations = presentations.clone();
        validate_presentation_edges(&probe)?;
        result.retired_demos = Some(DemoArchive {
            reference: saved.reference,
            placements: saved.placements,
            views,
            bars: bars
                .into_iter()
                .map(|b| (b.id, b.members, b.positions))
                .collect(),
            presentations,
            views_first: false,
        });
    }
    retire_demo_views(result, registry)
}

/// Persists only the typed document (`serializeWorkbench`): Sidebar width follows the widest
/// member minimum, the result is validated by [`parse_workbench`] before it is returned.
pub fn serialize_workbench(
    snapshot: &WorkbenchSnapshot,
    registry: &Registry,
) -> Result<String, CodecError> {
    let sidebar: Vec<&Placement> = snapshot
        .placements
        .iter()
        .filter(|p| p.region == Region::Sidebar)
        .collect();
    let mut minima = Vec::with_capacity(sidebar.len());
    for p in &sidebar {
        let t = snapshot.type_of(&p.id).and_then(|t| registry.get(t));
        let Some(t) = t else {
            // The reference throws a TypeError for a placement without a registered view.
            return reject("Invalid snapshot");
        };
        minima.push(
            constraint_in_region(&t.constraint, Region::Sidebar)
                .min
                .width,
        );
    }
    let sidebar_width = js::max_of(std::iter::once(snapshot.reference.sidebar.width).chain(minima));
    let sidebar_height = js::max_of(
        std::iter::once(snapshot.reference.sidebar.height)
            .chain(sidebar.iter().map(|p| p.y + p.height)),
    );
    let mut reference = snapshot.reference;
    reference.sidebar = crate::layout::Size::new(sidebar_width, sidebar_height);
    let placements: Vec<Placement> = snapshot
        .placements
        .iter()
        .map(|p| {
            let mut p = p.clone();
            if p.region == Region::Sidebar {
                p.width = sidebar_width;
            }
            p
        })
        .collect();
    let has_recipes = snapshot
        .organization
        .compositions
        .iter()
        .any(|c| c.portable.is_some());
    let mut raw = String::new();
    let mut w = ObjectWriter::new(&mut raw);
    w.number("schemaVersion", if has_recipes { 3.0 } else { 2.0 })
        .string("kind", "geppio-workbench")
        .raw("layout", |o| write_layout(o, &reference, &placements))
        .raw("organization", |o| {
            write_organization(o, &snapshot.organization, has_recipes)
        });
    if let Some(archive) = &snapshot.retired_demos {
        w.raw("retiredDemos", |o| write_archive(o, archive));
    }
    w.end();
    parse_workbench(&raw, registry)?;
    Ok(raw)
}

/// `JSON.stringify(snapshot)` of the in-memory document (history and dirty signatures).
pub fn snapshot_json(snapshot: &WorkbenchSnapshot) -> String {
    let mut out = String::new();
    write_snapshot(&mut out, snapshot);
    out
}

pub(crate) fn write_snapshot(out: &mut String, snapshot: &WorkbenchSnapshot) {
    let mut w = ObjectWriter::new(out);
    w.number("schemaVersion", 1.0)
        .string("engine", "freeform")
        .number("constraintVersion", 1.0)
        .raw("reference", |o| write_reference(o, &snapshot.reference))
        .raw("placements", |o| write_placements(o, &snapshot.placements))
        .raw("organization", |o| {
            write_organization(o, &snapshot.organization, false)
        });
    if let Some(archive) = &snapshot.retired_demos {
        w.raw("retiredDemos", |o| write_archive(o, archive));
    }
    w.end();
}

fn write_layout(out: &mut String, reference: &References, placements: &[Placement]) {
    let mut w = ObjectWriter::new(out);
    w.number("schemaVersion", 1.0)
        .string("engine", "freeform")
        .number("constraintVersion", 1.0)
        .raw("reference", |o| write_reference(o, reference))
        .raw("placements", |o| write_placements(o, placements));
    w.end();
}

pub(crate) fn write_size(out: &mut String, size: crate::layout::Size) {
    let mut w = ObjectWriter::new(out);
    w.number("width", size.width).number("height", size.height);
    w.end();
}

pub(crate) fn write_reference(out: &mut String, reference: &References) {
    let mut w = ObjectWriter::new(out);
    w.raw("main", |o| write_size(o, reference.main))
        .raw("sidebar", |o| write_size(o, reference.sidebar))
        .raw("bottom", |o| write_size(o, reference.bottom));
    w.end();
}

pub(crate) fn write_placement(out: &mut String, p: &Placement) {
    let mut w = ObjectWriter::new(out);
    w.string("id", &p.id)
        .string("region", p.region.as_str())
        .number("x", p.x)
        .number("y", p.y)
        .number("width", p.width)
        .number("height", p.height)
        .raw("preferred", |o| write_size(o, p.preferred));
    w.end();
}

pub(crate) fn write_placements(out: &mut String, placements: &[Placement]) {
    write_array(out, placements, write_placement);
}

pub(crate) fn write_views(out: &mut String, views: &[View]) {
    write_array(out, views, |o, v| {
        let mut w = ObjectWriter::new(o);
        w.string("id", &v.id)
            .string("typeId", &v.type_id)
            .string("modelId", &v.model_id);
        w.end();
    });
}

pub(crate) fn write_positions(out: &mut String, positions: &Positions) {
    let mut w = ObjectWriter::new(out);
    for (k, y) in positions.iter() {
        w.number(k, y);
    }
    w.end();
}

pub(crate) fn write_bars(out: &mut String, bars: &[UserBar]) {
    write_array(out, bars, |o, b| {
        let mut w = ObjectWriter::new(o);
        w.string("id", &b.id)
            .string("name", &b.name)
            .bool("userNamed", b.user_named)
            .string("icon", &b.icon)
            .bool("archived", b.archived)
            .strings("members", &b.members)
            .raw("positions", |o| write_positions(o, &b.positions));
        w.end();
    });
}

pub(crate) fn write_groups(out: &mut String, groups: &WidgetGroups) {
    let mut w = ObjectWriter::new(out);
    w.number("version", 1.0).raw("entries", |o| {
        write_array(o, &groups.entries, |o, g| {
            let mut w = ObjectWriter::new(o);
            w.string("id", &g.id)
                .string("frameId", &g.frame_id)
                .strings("members", &g.members)
                .string("active", &g.active);
            w.end();
        })
    });
    w.end();
}

fn write_format(out: &mut String, format: &[FormatSlot], id_last: bool) {
    write_array(out, format, |o, s| {
        let mut w = ObjectWriter::new(o);
        if !id_last {
            w.string("id", &s.id);
        }
        w.string("region", s.region.as_str())
            .number("x", s.x)
            .number("y", s.y)
            .number("width", s.width)
            .number("height", s.height);
        if id_last {
            w.string("id", &s.id);
        }
        w.end();
    });
}

fn write_scopes(out: &mut String, scopes: &[Region]) {
    write_string_array(out, &scopes.iter().map(|r| r.as_str()).collect::<Vec<_>>());
}

fn write_composition(out: &mut String, c: &Composition, stored: bool) {
    let mut w = ObjectWriter::new(out);
    match &c.portable {
        Some(recipe) if stored => {
            w.string("id", &c.id)
                .string("name", &c.name)
                .raw("portable", |o| write_portable(o, recipe));
        }
        Some(recipe) => {
            w.string("id", &c.id)
                .string("name", &c.name)
                .bool("system", c.system)
                .string("mode", c.mode.as_str())
                .raw("scopes", |o| write_scopes(o, &c.scopes))
                .raw("reference", |o| write_reference(o, &c.reference))
                .raw("format", |o| write_format(o, &c.format, true))
                .raw("chrome", |o| write_patch(o, &c.chrome.unwrap_or_default()))
                .raw("views", |o| write_views(o, &c.views))
                .raw("placements", |o| write_placements(o, &c.placements))
                .raw("portable", |o| write_portable(o, recipe));
        }
        None => {
            w.string("id", &c.id)
                .string("name", &c.name)
                .bool("system", c.system)
                .raw("scopes", |o| write_scopes(o, &c.scopes))
                .raw("reference", |o| write_reference(o, &c.reference))
                .raw("placements", |o| write_placements(o, &c.placements))
                .raw("views", |o| write_views(o, &c.views))
                .string("mode", c.mode.as_str())
                .raw("format", |o| write_format(o, &c.format, false));
            if let Some(chrome) = &c.chrome {
                w.raw("chrome", |o| write_patch(o, chrome));
            }
            if let Some(groups) = &c.groups {
                w.raw("groups", |o| write_groups(o, groups));
            }
        }
    }
    w.end();
}

pub(crate) fn write_organization(out: &mut String, org: &Organization, stored: bool) {
    let mut w = ObjectWriter::new(out);
    w.raw("views", |o| write_views(o, &org.views))
        .raw("bars", |o| write_bars(o, &org.bars))
        .string("activeBar", &org.active_bar)
        .raw("compositions", |o| {
            write_array(o, &org.compositions, |o, c| write_composition(o, c, stored))
        })
        .strings("favorites", &org.favorites)
        .nullable_string("defaultComposition", org.default_composition.as_deref())
        .raw("chrome", |o| write_chrome(o, &org.chrome))
        .raw("presentations", |o| {
            write_presentations(o, &org.presentations)
        });
    if let Some(groups) = &org.groups {
        w.raw("groups", |o| write_groups(o, groups));
    }
    if let Some(order) = &org.composition_order {
        w.strings("compositionOrder", order);
    }
    w.end();
}

fn write_archive(out: &mut String, archive: &DemoArchive) {
    let mut w = ObjectWriter::new(out);
    w.raw("reference", |o| write_reference(o, &archive.reference));
    if archive.views_first {
        w.raw("views", |o| write_views(o, &archive.views))
            .raw("placements", |o| write_placements(o, &archive.placements));
    } else {
        w.raw("placements", |o| write_placements(o, &archive.placements))
            .raw("views", |o| write_views(o, &archive.views));
    }
    w.raw("bars", |o| {
        write_array(o, &archive.bars, |o, (id, members, positions)| {
            let mut w = ObjectWriter::new(o);
            w.string("id", id)
                .strings("members", members)
                .raw("positions", |o| write_positions(o, positions));
            w.end();
        })
    })
    .raw("presentations", |o| {
        write_presentations(o, &archive.presentations)
    });
    w.end();
}
