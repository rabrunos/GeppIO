//! Library operations on portable recipes (`shared/workbench/portable.ts`): export a saved
//! composition, import a recipe as a new inert record, list its widget dependencies and
//! resolve them against local views before the widgets are applied.
use std::collections::HashSet;

use super::codec::{write_groups, write_size};
use super::compositions::{ApplyMode, apply_composition, system_compositions};
use super::groups::{parse_groups, validate_groups};
use super::model::{
    Composition, Presence, Registry, View, WidgetGroup, WidgetGroups, WorkbenchSnapshot,
    group_constraint, limits, model_id, surface_placements,
};
use super::portable::{
    PortableLayout, js_space, parse_portable_layout, portable_name, serialize_portable_layout,
    stored_portable_composition,
};
use super::presentations::{Presentation, presentation_of};
use crate::freeform::schema::reject;
use crate::freeform::{CodecError, constraint_in_region};
use crate::json::{self, Json, ObjectWriter, write_array, write_string_array};
use crate::layout::{Placement, Region, Size};

/// A recipe as the JSON value the reference passes around.
fn recipe_json(recipe: &PortableLayout) -> Json {
    json::parse(&serialize_portable_layout(recipe)).expect("recipe bytes are JSON")
}

/// The recipe of a saved composition (`exportPortableComposition`).
pub fn export_portable_composition(
    saved: &Composition,
    registry: &Registry,
) -> Result<PortableLayout, CodecError> {
    if saved.system {
        return reject("Selecione uma composição salva para exportar.");
    }
    if let Some(recipe) = &saved.portable {
        let renamed = PortableLayout {
            name: saved.name.clone(),
            ..recipe.clone()
        };
        return parse_portable_layout(Some(&recipe_json(&renamed)));
    }
    let key = |id: &str| {
        saved
            .views
            .iter()
            .position(|v| v.id == id)
            .map(|i| format!("v{}", i + 1))
    };
    let mut refs = Vec::with_capacity(saved.views.len());
    for view in &saved.views {
        match registry.get(&view.type_id) {
            Some(t) if t.fixture.is_none() && !t.retired && !t.missing => refs.push(t),
            _ => return reject("A composição contém um widget indisponível para exportação."),
        }
    }
    let mut raw = String::new();
    let mut w = ObjectWriter::new(&mut raw);
    w.string("kind", "geppio-layout")
        .number("version", 1.0)
        .string("name", &saved.name)
        .string("mode", saved.mode.as_str())
        .raw("scopes", |o| {
            write_string_array(
                o,
                &saved.scopes.iter().map(|r| r.as_str()).collect::<Vec<_>>(),
            )
        })
        .raw("reference", |o| {
            let mut w = ObjectWriter::new(o);
            for &region in &saved.scopes {
                w.raw(region.as_str(), |o| {
                    write_size(o, *saved.reference.get(region))
                });
            }
            w.end();
        })
        .raw("chrome", |o| {
            let mut w = ObjectWriter::new(o);
            let side = saved.chrome.and_then(|c| c.sidebar).and_then(|e| e.size);
            let bottom = saved.chrome.and_then(|c| c.bottom).and_then(|e| e.size);
            let bottom = bottom.filter(|_| saved.scopes.contains(&Region::Bottom));
            for (name, size) in [("sidebar", side), ("bottom", bottom)] {
                if let Some(size) = size {
                    w.raw(name, |o| {
                        let mut w = ObjectWriter::new(o);
                        w.number("size", size);
                        w.end();
                    });
                }
            }
            w.end();
        })
        .raw("format", |o| {
            let indexed: Vec<_> = saved.format.iter().enumerate().collect();
            write_array(o, &indexed, |o, (i, slot)| {
                let mut w = ObjectWriter::new(o);
                w.string("key", &format!("s{}", i + 1))
                    .string("region", slot.region.as_str())
                    .number("x", slot.x)
                    .number("y", slot.y)
                    .number("width", slot.width)
                    .number("height", slot.height);
                w.end();
            })
        })
        .raw("views", |o| {
            let indexed: Vec<_> = refs.iter().enumerate().collect();
            write_array(o, &indexed, |o, (i, t)| {
                let mut w = ObjectWriter::new(o);
                w.string("key", &format!("v{}", i + 1)).raw("ref", |o| {
                    let mut w = ObjectWriter::new(o);
                    if t.owner == "host" {
                        w.string("host", &t.id);
                    } else {
                        if let Some(plugin) = &t.plugin_id {
                            w.string("pluginId", plugin);
                        }
                        if let Some(widget) = &t.widget_id {
                            w.string("widgetId", widget);
                        }
                    }
                    w.end();
                });
                w.end();
            })
        })
        .raw("placements", |o| {
            write_array(o, &saved.placements, |o, p| {
                let mut w = ObjectWriter::new(o);
                if let Some(key) = key(&p.id) {
                    w.string("view", &key);
                }
                w.string("region", p.region.as_str())
                    .number("x", p.x)
                    .number("y", p.y)
                    .number("width", p.width)
                    .number("height", p.height)
                    .raw("preferred", |o| write_size(o, p.preferred));
                w.end();
            })
        })
        .raw("groups", |o| {
            let entries = saved.groups.as_ref().map_or(&[][..], |g| &g.entries[..]);
            write_array(o, entries, |o, group| {
                let mut w = ObjectWriter::new(o);
                if let Some(frame) = key(&group.frame_id) {
                    w.string("frame", &frame);
                }
                w.raw("members", |o| {
                    let members: Vec<Json> = group
                        .members
                        .iter()
                        .map(|m| key(m).map_or(Json::Null, Json::String))
                        .collect();
                    Json::Array(members).write(o);
                });
                if let Some(active) = key(&group.active) {
                    w.string("active", &active);
                }
                w.end();
            })
        });
    w.end();
    let value = json::parse(&raw).expect("export bytes are JSON");
    parse_portable_layout(Some(&value))
}

/// The UTF-16 prefix of `value` with at most `units` code units, never ending inside a
/// surrogate pair (`slice(0, n).replace(/[\ud800-\udbff]$/, '')`).
fn utf16_prefix(value: &str, units: usize) -> String {
    let code: Vec<u16> = value.encode_utf16().collect();
    let mut cut = units.min(code.len());
    if cut > 0 && (0xd800..=0xdbff).contains(&code[cut - 1]) {
        cut -= 1;
    }
    String::from_utf16_lossy(&code[..cut])
}

/// A recipe added to the library as a new inert record (`importPortableComposition`). The
/// name gains " (2)", " (3)"… until it differs, ignoring case, from every library name.
/// `id` is the new identity (the reference draws `composition:<uuid>`).
pub fn import_portable_composition(
    source: &WorkbenchSnapshot,
    input: &PortableLayout,
    requested_name: &str,
    id: &str,
) -> Result<Composition, CodecError> {
    if source.organization.compositions.len() >= limits::COMPOSITIONS {
        return reject("Limite de composições salvas atingido.");
    }
    let names: HashSet<String> = system_compositions(false)
        .iter()
        .map(|c| c.name.to_lowercase())
        .chain(
            source
                .organization
                .compositions
                .iter()
                .map(|c| c.name.to_lowercase()),
        )
        .collect();
    let base = portable_name(Some(&Json::String(
        requested_name.trim_matches(js_space).to_owned(),
    )))?;
    let mut name = base.clone();
    let mut i = 2;
    while names.contains(&name.to_lowercase()) {
        let suffix = format!(" ({i})");
        name = utf16_prefix(&base, 100usize.saturating_sub(suffix.len())) + &suffix;
        i += 1;
    }
    stored_portable_composition(id, &name, Some(&recipe_json(input)))
}

/// A local view a recipe view can bind to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortableCandidate {
    /// Local view identity.
    pub id: String,
    /// "{title} · {region} · {n}".
    pub label: String,
}

/// One recipe view and how it can be satisfied (`PortableDependency`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortableDependency {
    /// Recipe view key.
    pub key: String,
    /// Widget title (or type identity when unknown).
    pub label: String,
    /// Compatible local views.
    pub candidates: Vec<PortableCandidate>,
    /// Why the dependency cannot be satisfied (pt-BR), if it cannot.
    pub reason: Option<&'static str>,
}

/// The widget dependencies of a portable record (`portableDependencies`). `disabled` lists
/// owners whose widgets are paused.
pub fn portable_dependencies(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    item: &Composition,
    disabled: &[String],
) -> Vec<PortableDependency> {
    let Some(recipe) = &item.portable else {
        return Vec::new();
    };
    let placements = surface_placements(source);
    let mut dependencies: Vec<PortableDependency> = recipe
        .views
        .iter()
        .map(|(key, entry)| {
            let id = entry.type_id();
            let t = registry.get(&id);
            let label = t.map_or_else(|| id.clone(), |t| t.title.clone());
            let mut dependency = PortableDependency {
                key: key.clone(),
                label: label.clone(),
                candidates: Vec::new(),
                reason: None,
            };
            let group = recipe.groups.iter().find(|g| g.members.contains(key));
            let frame_key = group.map_or(key.as_str(), |g| g.frame.as_str());
            let Some(frame) = recipe.placements.iter().find(|p| p.key == frame_key) else {
                dependency.reason = Some("O widget é incompatível com a região ou o grupo.");
                return dependency;
            };
            let region = frame.region;
            let Some(t) = t.filter(|t| !t.missing && !t.retired && !disabled.contains(&t.owner))
            else {
                dependency.reason = Some("Widget ausente, desativado ou indisponível.");
                return dependency;
            };
            if t.presence == Presence::SingleView
                && recipe
                    .views
                    .iter()
                    .any(|(other, r)| other != key && r.type_id() == id)
            {
                dependency.reason =
                    Some("O widget permite apenas uma apresentação nessa instalação.");
                return dependency;
            }
            if !t.constraint.allows(region)
                || group.is_some_and(|g| !t.tab_member || (g.frame == *key && !t.tab_host))
            {
                dependency.reason = Some("O widget é incompatível com a região ou o grupo.");
                return dependency;
            }
            let member_types: Option<Vec<String>> = group.map(|g| {
                g.members
                    .iter()
                    .map(|m| {
                        recipe
                            .views
                            .iter()
                            .find(|(k, _)| k == m)
                            .map_or_else(String::new, |(_, r)| r.type_id())
                    })
                    .collect()
            });
            let constraint = match &member_types {
                Some(types) if types.iter().all(|t| registry.has(t)) => {
                    let refs: Vec<&str> = types.iter().map(String::as_str).collect();
                    group_constraint(&refs, registry)
                }
                _ => t.constraint.clone(),
            };
            let limits = constraint_in_region(&constraint, region);
            let (min, max) = (limits.min, limits.max);
            let size = Size::new(frame.bounds.width, frame.bounds.height);
            if [size, frame.preferred.unwrap_or(size)].iter().any(|s| {
                s.width < min.width
                    || s.height < min.height
                    || s.width > max.width
                    || s.height > max.height
            }) {
                dependency.reason = Some(
                    "A geometria salva é incompatível com os limites atuais do widget ou grupo.",
                );
                return dependency;
            }
            let model = model_id(&id);
            let instances: Vec<&View> = source
                .organization
                .views
                .iter()
                .filter(|v| v.type_id == id && v.model_id == model)
                .collect();
            let omitted: Vec<&str> = instances
                .iter()
                .filter(|v| {
                    placements
                        .iter()
                        .any(|p| p.id == v.id && !item.scopes.contains(&p.region))
                })
                .map(|v| v.id.as_str())
                .collect();
            if !omitted.is_empty() && t.presence == Presence::SingleView {
                dependency.reason = Some("O widget já ocupa uma região fora da composição.");
                return dependency;
            }
            for view in instances {
                if omitted.contains(&view.id.as_str())
                    || (presentation_of(source, &view.id) != Presentation::Normal
                        && group.is_some())
                {
                    continue;
                }
                let place =
                    placements
                        .iter()
                        .find(|p| p.id == view.id)
                        .map_or("sem posição", |p| match p.region {
                            Region::Main => "Main",
                            Region::Bottom => "Bottom",
                            Region::Sidebar => "Sidebar",
                        });
                let n = dependency.candidates.len() + 1;
                dependency.candidates.push(PortableCandidate {
                    id: view.id.clone(),
                    label: format!("{label} · {place} · {n}"),
                });
            }
            if dependency.candidates.is_empty() {
                dependency.reason = Some("Nenhuma instância local compatível está disponível.");
            }
            dependency
        })
        .collect();
    // There are at most two placements for a public type (one per portable region). If both
    // can only use the same presentation, a complete binding is impossible.
    let unique: Vec<(usize, String)> = dependencies
        .iter()
        .enumerate()
        .filter(|(_, d)| d.candidates.len() == 1)
        .map(|(i, d)| (i, d.candidates[0].id.clone()))
        .collect();
    for (i, id) in &unique {
        if unique.iter().any(|(j, other)| j != i && other == id) {
            dependencies[*i].reason =
                Some("A composição requer apresentações locais distintas deste widget.");
        }
    }
    dependencies
}

/// A local application candidate, only after every binding is resolved together
/// (`resolvePortableWidgets`). `choices` maps recipe view keys to chosen local views;
/// `group_id` draws the identity of a group that does not exist yet.
pub fn resolve_portable_widgets(
    source: &WorkbenchSnapshot,
    registry: &Registry,
    item: &Composition,
    disabled: &[String],
    choices: &[(String, String)],
    group_id: &mut dyn FnMut() -> String,
) -> Option<Composition> {
    let recipe = item.portable.as_ref()?;
    if recipe.mode != super::model::CompositionMode::FormatWidgets || recipe.views.is_empty() {
        return None;
    }
    let refs = portable_dependencies(source, registry, item, disabled);
    if choices
        .iter()
        .any(|(key, _)| !refs.iter().any(|r| r.key == *key))
    {
        return None;
    }
    let mut bindings: Vec<(String, View)> = Vec::with_capacity(refs.len());
    for r in &refs {
        let chosen = choices
            .iter()
            .rev()
            .find(|(key, _)| *key == r.key)
            .map(|(_, id)| id.clone())
            .or_else(|| (r.candidates.len() == 1).then(|| r.candidates[0].id.clone()));
        let id = chosen.filter(|id| !id.is_empty())?;
        if r.reason.is_some()
            || bindings.iter().any(|(_, v)| v.id == id)
            || !r.candidates.iter().any(|c| c.id == id)
        {
            return None;
        }
        let view = source.organization.views.iter().find(|v| v.id == id)?;
        bindings.push((r.key.clone(), view.clone()));
    }
    let local = |key: &str| {
        bindings
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.id.clone())
    };
    let mut groups = Vec::with_capacity(recipe.groups.len());
    for group in &recipe.groups {
        let frame_id = local(&group.frame)?;
        let members = group
            .members
            .iter()
            .map(|m| local(m))
            .collect::<Option<Vec<_>>>()?;
        let existing = source
            .organization
            .groups
            .as_ref()
            .and_then(|g| g.entries.iter().find(|e| e.frame_id == frame_id))
            .map(|e| e.id.clone());
        groups.push(WidgetGroup {
            id: existing.unwrap_or_else(&mut *group_id),
            frame_id,
            members,
            active: local(&group.active)?,
        });
    }
    let placements = recipe
        .placements
        .iter()
        .map(|p| {
            let size = Size::new(p.bounds.width, p.bounds.height);
            Some(Placement {
                id: local(&p.key)?,
                region: p.region,
                x: p.bounds.x,
                y: p.bounds.y,
                width: p.bounds.width,
                height: p.bounds.height,
                preferred: p.preferred.unwrap_or(size),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let resolved = Composition {
        views: bindings.iter().map(|(_, v)| v.clone()).collect(),
        placements,
        portable: None,
        groups: if groups.is_empty() {
            item.groups.clone()
        } else {
            Some(WidgetGroups { entries: groups })
        },
        ..item.clone()
    };
    let applied = apply_composition(source, registry, &resolved, ApplyMode::Widgets)?;
    let groups_json = applied.organization.groups.as_ref().map(|g| {
        let mut raw = String::new();
        write_groups(&mut raw, g);
        json::parse(&raw).expect("group bytes are JSON")
    });
    parse_groups(groups_json.as_ref(), &applied.organization.views, registry).ok()?;
    validate_groups(&applied, registry).ok()?;
    Some(resolved)
}
