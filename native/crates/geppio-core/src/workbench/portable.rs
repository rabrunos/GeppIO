//! Portable composition recipes (`portable-format.ts` and `storedPortableComposition`).
//! A foreign association never enters the executable view registry during recovery.
use super::chrome::{ChromePatch, ChromePatchEntry, ChromeRegion};
use super::model::{Composition, CompositionMode, FormatSlot};
use crate::freeform::CodecError;
use crate::freeform::default_freeform;
use crate::freeform::schema::reject;
use crate::json::{Json, JsonObject, ObjectWriter, write_array, write_string_array};
use crate::layout::policy::{MAX_BYTES, MAX_COORDINATE, MAX_SIZE, MAX_WIDGETS};
use crate::layout::{Bounds, EPSILON, Region, Size, collides};

const INVALID: &str = "Arquivo de composição inválido ou incompatível.";
const OFFICIAL: [&str; 4] = [
    "host:file-editor",
    "host:file-explorer",
    "host:terminal",
    "host:git-changes",
];

/// A widget reference inside a recipe.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PortableRef {
    /// An official host type.
    Host(String),
    /// A plugin widget.
    Plugin {
        /// Plugin identity.
        plugin_id: String,
        /// Widget identity.
        widget_id: String,
    },
}

impl PortableRef {
    /// The registry type identity (`portableType`).
    pub fn type_id(&self) -> String {
        match self {
            PortableRef::Host(host) => host.clone(),
            PortableRef::Plugin {
                plugin_id,
                widget_id,
            } => format!("plugin:{plugin_id}:{widget_id}"),
        }
    }
}

/// A recipe rectangle.
#[derive(Clone, Debug, PartialEq)]
pub struct PortableRect {
    /// File-local key (`s1…` for slots, `v1…` view key for placements).
    pub key: String,
    /// Region (Main or Bottom).
    pub region: Region,
    /// Rectangle.
    pub bounds: Bounds,
    /// Preferred size (placements only).
    pub preferred: Option<Size>,
}

/// A recipe tab group.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortableGroup {
    /// Frame view key.
    pub frame: String,
    /// Member view keys.
    pub members: Vec<String>,
    /// Active view key.
    pub active: String,
}

/// A validated `.geppio-layout.json` recipe (version 1).
#[derive(Clone, Debug, PartialEq)]
pub struct PortableLayout {
    /// Recipe name (user content).
    pub name: String,
    /// Mode.
    pub mode: CompositionMode,
    /// Scopes (Main/Bottom).
    pub scopes: Vec<Region>,
    /// Reference size per scope, in scope order.
    pub reference: Vec<(Region, Size)>,
    /// Captured chrome sizes.
    pub chrome: (Option<f64>, Option<f64>),
    /// Format slots.
    pub format: Vec<PortableRect>,
    /// Views `(key, ref)`.
    pub views: Vec<(String, PortableRef)>,
    /// Placements.
    pub placements: Vec<PortableRect>,
    /// Groups.
    pub groups: Vec<PortableGroup>,
}

fn invalid<T>() -> Result<T, CodecError> {
    reject(INVALID)
}

fn record(value: Option<&Json>) -> Result<&JsonObject, CodecError> {
    match value.and_then(Json::as_object) {
        Some(o) => Ok(o),
        None => invalid(),
    }
}

fn shape<'a>(
    value: Option<&'a Json>,
    fields: &[&str],
    required: &[&str],
) -> Result<&'a JsonObject, CodecError> {
    let obj = record(value)?;
    if obj.keys().any(|k| !fields.contains(&k)) || required.iter().any(|k| !obj.has(k)) {
        return invalid();
    }
    Ok(obj)
}

fn list(value: Option<&Json>) -> Result<&Vec<Json>, CodecError> {
    match value.and_then(Json::as_array) {
        Some(a) if a.len() <= MAX_WIDGETS => Ok(a),
        _ => invalid(),
    }
}

fn number(value: Option<&Json>, min: f64, max: f64) -> Result<f64, CodecError> {
    match value.and_then(Json::finite) {
        Some(n) if n >= min && n <= max => Ok(n),
        _ => invalid(),
    }
}

fn size(value: &JsonObject, max: f64) -> Result<Size, CodecError> {
    Ok(Size::new(
        number(value.get("width"), f64::from_bits(1), max)?,
        number(value.get("height"), f64::from_bits(1), max)?,
    ))
}

/// ECMAScript `String.prototype.trim` whitespace and line terminators.
pub(crate) fn js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// UTF-16 length (`string.length`).
pub(crate) fn js_length(value: &str) -> usize {
    value.encode_utf16().count()
}

/// A recipe or composition name (`portableName`): non-blank, at most 100 UTF-16 units and
/// no control characters.
pub fn portable_name(value: Option<&Json>) -> Result<String, CodecError> {
    match value.and_then(Json::as_str) {
        Some(s)
            if !s.chars().all(js_space)
                && js_length(s) <= 100
                && !s
                    .chars()
                    .any(|c| matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}')) =>
        {
            Ok(s.to_owned())
        }
        _ => invalid(),
    }
}

/// A plugin or widget identity (`pluginId`).
pub fn plugin_id(value: &str) -> bool {
    const PROTOTYPE: [&str; 12] = [
        "constructor",
        "__defineGetter__",
        "__defineSetter__",
        "hasOwnProperty",
        "__lookupGetter__",
        "__lookupSetter__",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toString",
        "valueOf",
        "__proto__",
        "toLocaleString",
    ];
    let bytes = value.as_bytes();
    let shape = !bytes.is_empty() && bytes[0].is_ascii_lowercase() && {
        // [a-z][a-z0-9]*(?:[.-][a-z0-9]+)*
        let mut previous_separator = false;
        let mut ok = true;
        for &b in &bytes[1..] {
            if b == b'.' || b == b'-' {
                if previous_separator {
                    ok = false;
                    break;
                }
                previous_separator = true;
            } else if b.is_ascii_lowercase() || b.is_ascii_digit() {
                previous_separator = false;
            } else {
                ok = false;
                break;
            }
        }
        ok && !previous_separator
    };
    let reserved = {
        let head = value.split('.').next().unwrap_or("");
        matches!(head, "con" | "prn" | "aux" | "nul")
            || (head.len() == 4
                && (head.starts_with("com") || head.starts_with("lpt"))
                && matches!(head.as_bytes()[3], b'1'..=b'9'))
    };
    shape && value.len() <= 64 && !PROTOTYPE.contains(&value) && !reserved
}

fn region(value: Option<&Json>) -> Result<Region, CodecError> {
    match value.and_then(Json::as_str) {
        Some("main") => Ok(Region::Main),
        Some("bottom") => Ok(Region::Bottom),
        _ => invalid(),
    }
}

fn distinct<T: PartialEq>(values: &[T]) -> Result<(), CodecError> {
    for (i, v) in values.iter().enumerate() {
        if values[..i].contains(v) {
            return invalid();
        }
    }
    Ok(())
}

fn clearance(cells: &[PortableRect]) -> Result<(), CodecError> {
    for (i, cell) in cells.iter().enumerate() {
        if cells[i + 1..]
            .iter()
            .any(|other| other.region == cell.region && collides(&cell.bounds, &other.bounds))
        {
            return invalid();
        }
    }
    Ok(())
}

/// Validates a recipe object (`parsePortableLayout`). Every rejection has the same message.
pub fn parse_portable_layout(value: Option<&Json>) -> Result<PortableLayout, CodecError> {
    const TOP: [&str; 11] = [
        "kind",
        "version",
        "name",
        "mode",
        "scopes",
        "reference",
        "chrome",
        "format",
        "views",
        "placements",
        "groups",
    ];
    let obj = shape(value, &TOP, &TOP)?;
    let mode = obj
        .get("mode")
        .and_then(Json::as_str)
        .and_then(CompositionMode::parse);
    let (Some("geppio-layout"), Some(1.0), Some(mode)) = (
        obj.get("kind").and_then(Json::as_str),
        obj.get("version").and_then(Json::as_f64),
        mode,
    ) else {
        return invalid();
    };
    let scopes = list(obj.get("scopes"))?
        .iter()
        .map(|v| region(Some(v)))
        .collect::<Result<Vec<_>, _>>()?;
    distinct(&scopes)?;
    let scope_names: Vec<&str> = scopes.iter().map(|r| r.as_str()).collect();
    let dimensions = shape(obj.get("reference"), &scope_names, &scope_names)?;
    let mut reference: Vec<(Region, Size)> = Vec::new();
    for &scope in &scopes {
        let dims = shape(
            dimensions.get(scope.as_str()),
            &["width", "height"],
            &["width", "height"],
        )?;
        reference.push((scope, size(dims, MAX_COORDINATE)?));
    }
    let sizes = shape(obj.get("chrome"), &["sidebar", "bottom"], &[])?;
    let mut chrome = (None, None);
    for part in ChromeRegion::ALL {
        if !sizes.has(part.as_str()) {
            continue;
        }
        if part == ChromeRegion::Bottom && !scopes.contains(&Region::Bottom) {
            return invalid();
        }
        let limits = part.limits();
        let entry = shape(sizes.get(part.as_str()), &["size"], &["size"])?;
        let value = number(entry.get("size"), limits.min, limits.max)?;
        match part {
            ChromeRegion::Sidebar => chrome.0 = Some(value),
            ChromeRegion::Bottom => chrome.1 = Some(value),
        }
    }
    if scopes.is_empty() && chrome.0.is_none() {
        return invalid();
    }
    let bounds_of = |r: Region| reference.iter().find(|(s, _)| *s == r).map(|(_, b)| *b);
    let rect = |item: &JsonObject, slot: bool| -> Result<(Region, Bounds), CodecError> {
        let area = region(item.get("region"))?;
        let Some(limit) = bounds_of(area) else {
            return invalid();
        };
        let dims = size(item, if slot { MAX_COORDINATE } else { MAX_SIZE })?;
        let x = number(item.get("x"), 0.0, MAX_COORDINATE)?;
        let y = number(item.get("y"), 0.0, MAX_COORDINATE)?;
        let max_x = if !slot && area == Region::Main {
            MAX_COORDINATE
        } else {
            limit.width
        };
        if x + dims.width > max_x
            || y + dims.height > limit.height + if slot { 0.0 } else { EPSILON }
        {
            return invalid();
        }
        Ok((area, Bounds::new(x, y, dims.width, dims.height)))
    };
    const FIELDS: [&str; 5] = ["region", "x", "y", "width", "height"];
    let mut format = Vec::new();
    for (i, value) in list(obj.get("format"))?.iter().enumerate() {
        let fields: Vec<&str> = FIELDS.iter().copied().chain(["key"]).collect();
        let item = shape(Some(value), &fields, &fields)?;
        let key = format!("s{}", i + 1);
        if item.get("key").and_then(Json::as_str) != Some(key.as_str()) {
            return invalid();
        }
        let (region, bounds) = rect(item, true)?;
        format.push(PortableRect {
            key,
            region,
            bounds,
            preferred: None,
        });
    }
    let mut views: Vec<(String, PortableRef)> = Vec::new();
    for (i, value) in list(obj.get("views"))?.iter().enumerate() {
        let item = shape(Some(value), &["key", "ref"], &["key", "ref"])?;
        let key = format!("v{}", i + 1);
        if item.get("key").and_then(Json::as_str) != Some(key.as_str()) {
            return invalid();
        }
        let r = record(item.get("ref"))?;
        let reference = if r.has("host") {
            shape(item.get("ref"), &["host"], &["host"])?;
            match r.get("host").and_then(Json::as_str) {
                Some(host) if OFFICIAL.contains(&host) => PortableRef::Host(host.to_owned()),
                _ => return invalid(),
            }
        } else {
            shape(
                item.get("ref"),
                &["pluginId", "widgetId"],
                &["pluginId", "widgetId"],
            )?;
            match (
                r.get("pluginId").and_then(Json::as_str),
                r.get("widgetId").and_then(Json::as_str),
            ) {
                (Some(p), Some(w)) if plugin_id(p) && plugin_id(w) => PortableRef::Plugin {
                    plugin_id: p.to_owned(),
                    widget_id: w.to_owned(),
                },
                _ => return invalid(),
            }
        };
        views.push((key, reference));
    }
    let types: Vec<(String, String)> = views
        .iter()
        .map(|(k, r)| (k.clone(), r.type_id()))
        .collect();
    let type_of = |key: &str| {
        types
            .iter()
            .rev()
            .find(|(k, _)| k == key)
            .map(|(_, t)| t.clone())
    };
    let view_key = |value: Option<&Json>| -> Result<String, CodecError> {
        match value.and_then(Json::as_str) {
            Some(k) if type_of(k).is_some() => Ok(k.to_owned()),
            _ => invalid(),
        }
    };
    let mut placements = Vec::new();
    for value in list(obj.get("placements"))? {
        let fields: Vec<&str> = FIELDS
            .iter()
            .copied()
            .chain(["view", "preferred"])
            .collect();
        let item = shape(Some(value), &fields, &fields)?;
        let (region, bounds) = rect(item, false)?;
        if region == Region::Bottom
            && (bounds.y != 0.0
                || Some(bounds.height) != bounds_of(Region::Bottom).map(|b| b.height))
        {
            return invalid();
        }
        let key = view_key(item.get("view"))?;
        let preferred = size(
            shape(
                item.get("preferred"),
                &["width", "height"],
                &["width", "height"],
            )?,
            MAX_SIZE,
        )?;
        placements.push(PortableRect {
            key,
            region,
            bounds,
            preferred: Some(preferred),
        });
    }
    distinct(&placements.iter().map(|p| p.key.clone()).collect::<Vec<_>>())?;
    distinct(
        &placements
            .iter()
            .map(|p| {
                format!(
                    "{}:{}",
                    p.region.as_str(),
                    type_of(&p.key).unwrap_or_default()
                )
            })
            .collect::<Vec<_>>(),
    )?;
    clearance(&placements)?;
    clearance(&format)?;
    let placed: Vec<&str> = placements.iter().map(|p| p.key.as_str()).collect();
    let mut members: Vec<String> = Vec::new();
    let mut groups = Vec::new();
    for value in list(obj.get("groups"))? {
        let item = shape(
            Some(value),
            &["frame", "members", "active"],
            &["frame", "members", "active"],
        )?;
        let frame = view_key(item.get("frame"))?;
        let active = view_key(item.get("active"))?;
        let order = list(item.get("members"))?
            .iter()
            .map(|v| view_key(Some(v)))
            .collect::<Result<Vec<_>, _>>()?;
        if order.len() < 2
            || !order.contains(&active)
            || !order.contains(&frame)
            || !placed.contains(&frame.as_str())
        {
            return invalid();
        }
        for key in &order {
            if members.contains(key)
                || (*key != frame
                    && (placed.contains(&key.as_str())
                        || views
                            .iter()
                            .any(|(other, _)| other != key && type_of(other) == type_of(key))))
            {
                return invalid();
            }
            members.push(key.clone());
        }
        groups.push(PortableGroup {
            frame,
            members: order,
            active,
        });
    }
    if views
        .iter()
        .any(|(k, _)| !placed.contains(&k.as_str()) && !members.contains(k))
        || (mode == CompositionMode::Format && !views.is_empty())
    {
        return invalid();
    }
    let recipe = PortableLayout {
        name: portable_name(obj.get("name"))?,
        mode,
        scopes,
        reference,
        chrome,
        format,
        views,
        placements,
        groups,
    };
    let mut text = String::new();
    write_portable(&mut text, &recipe);
    if text.len() > MAX_BYTES {
        return invalid();
    }
    Ok(recipe)
}

/// A library record holding an inert recipe (`storedPortableComposition`).
pub fn stored_portable_composition(
    id: &str,
    name: &str,
    input: Option<&Json>,
) -> Result<Composition, CodecError> {
    let portable = parse_portable_layout(input)?;
    let name = portable_name(Some(&Json::String(name.to_owned())))?;
    let mut reference = default_freeform().reference;
    for (region, size) in &portable.reference {
        *reference.get_mut(*region) = *size;
    }
    Ok(Composition {
        id: id.to_owned(),
        name,
        system: false,
        scopes: portable.scopes.clone(),
        reference,
        placements: Vec::new(),
        views: Vec::new(),
        mode: portable.mode,
        format: portable
            .format
            .iter()
            .map(|slot| FormatSlot {
                id: slot.key.clone(),
                region: slot.region,
                x: slot.bounds.x,
                y: slot.bounds.y,
                width: slot.bounds.width,
                height: slot.bounds.height,
            })
            .collect(),
        chrome: Some(ChromePatch {
            sidebar: portable.chrome.0.map(|size| ChromePatchEntry {
                size: Some(size),
                visible: None,
            }),
            bottom: portable.chrome.1.map(|size| ChromePatchEntry {
                size: Some(size),
                visible: None,
            }),
        }),
        groups: None,
        portable: Some(portable),
    })
}

fn write_size(out: &mut String, size: Size) {
    let mut w = ObjectWriter::new(out);
    w.number("width", size.width).number("height", size.height);
    w.end();
}

/// `JSON.stringify(recipe)`.
pub(crate) fn write_portable(out: &mut String, recipe: &PortableLayout) {
    let mut w = ObjectWriter::new(out);
    w.string("kind", "geppio-layout")
        .number("version", 1.0)
        .string("name", &recipe.name)
        .string("mode", recipe.mode.as_str())
        .raw("scopes", |o| {
            write_string_array(
                o,
                &recipe.scopes.iter().map(|r| r.as_str()).collect::<Vec<_>>(),
            )
        })
        .raw("reference", |o| {
            let mut w = ObjectWriter::new(o);
            for (region, size) in &recipe.reference {
                w.raw(region.as_str(), |o| write_size(o, *size));
            }
            w.end();
        })
        .raw("chrome", |o| {
            let mut w = ObjectWriter::new(o);
            for (name, value) in [("sidebar", recipe.chrome.0), ("bottom", recipe.chrome.1)] {
                if let Some(size) = value {
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
            write_array(o, &recipe.format, |o, slot| {
                let mut w = ObjectWriter::new(o);
                w.string("key", &slot.key)
                    .string("region", slot.region.as_str())
                    .number("x", slot.bounds.x)
                    .number("y", slot.bounds.y)
                    .number("width", slot.bounds.width)
                    .number("height", slot.bounds.height);
                w.end();
            })
        })
        .raw("views", |o| {
            write_array(o, &recipe.views, |o, (key, r)| {
                let mut w = ObjectWriter::new(o);
                w.string("key", key).raw("ref", |o| {
                    let mut w = ObjectWriter::new(o);
                    match r {
                        PortableRef::Host(host) => {
                            w.string("host", host);
                        }
                        PortableRef::Plugin {
                            plugin_id,
                            widget_id,
                        } => {
                            w.string("pluginId", plugin_id)
                                .string("widgetId", widget_id);
                        }
                    }
                    w.end();
                });
                w.end();
            })
        })
        .raw("placements", |o| {
            write_array(o, &recipe.placements, |o, p| {
                let mut w = ObjectWriter::new(o);
                w.string("view", &p.key)
                    .string("region", p.region.as_str())
                    .number("x", p.bounds.x)
                    .number("y", p.bounds.y)
                    .number("width", p.bounds.width)
                    .number("height", p.bounds.height)
                    .raw("preferred", |o| {
                        write_size(o, p.preferred.unwrap_or_default())
                    });
                w.end();
            })
        })
        .raw("groups", |o| {
            write_array(o, &recipe.groups, |o, g| {
                let mut w = ObjectWriter::new(o);
                w.string("frame", &g.frame)
                    .strings("members", &g.members)
                    .string("active", &g.active);
                w.end();
            })
        });
    w.end();
}
