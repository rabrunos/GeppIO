//! Freeform geometry codec (`freeform/schema.ts`). Imported data cannot change executable
//! widget minima, permissions or registry membership; future versions fail closed.
use super::policy::{CONSTRAINTS_IDS, constraint_in_region, constraints};
use crate::json::{self, Json, JsonSyntaxError};
use crate::layout::policy::{MAX_BYTES, MAX_COORDINATE, MAX_SIZE, MAX_WIDGETS};
use crate::layout::{
    Constraints, EPSILON, PerRegion, Placement, References, Region, Size, collides,
};

/// A validated freeform layout (`Snapshot` with `schemaVersion: 1`, `engine: 'freeform'`,
/// `constraintVersion: 1`).
#[derive(Clone, Debug, PartialEq)]
pub struct Layout {
    /// Recorded inner reference size per region.
    pub reference: References,
    /// Placements in document order.
    pub placements: Vec<Placement>,
}

/// Why a document was rejected.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CodecError {
    /// The text is not JSON (the reference throws a `SyntaxError`).
    Syntax(JsonSyntaxError),
    /// The reference's `Error` message for a rejected document.
    Rejected(&'static str),
}

impl CodecError {
    /// The reference error message (`"Invalid JSON"` for syntax errors).
    pub fn message(&self) -> &str {
        match self {
            CodecError::Syntax(_) => "Invalid JSON",
            CodecError::Rejected(message) => message,
        }
    }
}

impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CodecError::Syntax(e) => e.fmt(f),
            CodecError::Rejected(message) => f.write_str(message),
        }
    }
}
impl std::error::Error for CodecError {}

impl From<JsonSyntaxError> for CodecError {
    fn from(e: JsonSyntaxError) -> Self {
        CodecError::Syntax(e)
    }
}

/// Shorthand for a rejection.
pub(crate) fn reject<T>(message: &'static str) -> Result<T, CodecError> {
    Err(CodecError::Rejected(message))
}

/// `text.length > max || new TextEncoder().encode(text).length > max`. UTF-8 is never
/// shorter than UTF-16, so the byte length decides.
pub(crate) fn oversized(text: &str) -> bool {
    text.len() > MAX_BYTES
}

/// `typeof v === 'number' && Number.isFinite(v)`.
pub(crate) fn number(v: Option<&Json>) -> Option<f64> {
    v.and_then(Json::finite)
}

/// A non-array object.
pub(crate) fn object(v: Option<&Json>) -> Option<&json::JsonObject> {
    v.and_then(Json::as_object)
}

fn size(v: Option<&Json>, max: f64) -> Result<Size, CodecError> {
    let Some(o) = object(v) else {
        return reject("Invalid pixel size");
    };
    match (number(o.get("width")), number(o.get("height"))) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 && w <= max && h <= max => Ok(Size::new(w, h)),
        _ => reject("Invalid pixel size"),
    }
}

/// The legacy alpha.12 document with exactly the seven fixture identities (`parseFreeform`).
pub fn parse_freeform(text: &str) -> Result<Layout, CodecError> {
    parse_geometry(text, &constraints(), Some(&CONSTRAINTS_IDS), |_, _| true)
}

/// Validates freeform geometry against host-owned constraints (`parseGeometry`).
/// `required_ids` demands exactly those identities and reorders to them; `coexist`
/// decides whether a same-region pair must satisfy clearance.
pub fn parse_geometry(
    text: &str,
    constraints: &Constraints,
    required_ids: Option<&[&str]>,
    coexist: impl Fn(&Placement, &Placement) -> bool,
) -> Result<Layout, CodecError> {
    if oversized(text) {
        return reject("Layout exceeds 64 KiB");
    }
    let data = json::parse(text)?;
    let unsupported = || reject("Unsupported freeform layout");
    let Some(root) = data.as_object() else {
        return unsupported();
    };
    let raw_placements = root.get("placements").and_then(Json::as_array);
    if root.get("schemaVersion").and_then(Json::as_f64) != Some(1.0)
        || root.get("engine").and_then(Json::as_str) != Some("freeform")
        || root.get("constraintVersion").and_then(Json::as_f64) != Some(1.0)
        || object(root.get("reference")).is_none()
    {
        return unsupported();
    }
    let Some(raw_placements) = raw_placements else {
        return unsupported();
    };
    if raw_placements.len() > MAX_WIDGETS
        || required_ids.is_some_and(|ids| raw_placements.len() != ids.len())
    {
        return unsupported();
    }
    let raw_reference = root.get("reference");
    let reference = PerRegion {
        main: size(raw_reference.and_then(|r| r.get("main")), MAX_COORDINATE)?,
        sidebar: size(raw_reference.and_then(|r| r.get("sidebar")), MAX_COORDINATE)?,
        bottom: size(raw_reference.and_then(|r| r.get("bottom")), MAX_COORDINATE)?,
    };
    let mut seen: Vec<String> = Vec::new();
    let mut placements = Vec::with_capacity(raw_placements.len());
    for raw in raw_placements {
        let identity = || reject("Invalid widget identity/region/position");
        let Some(p) = raw.as_object() else {
            return identity();
        };
        let Some(id) = p.get("id").and_then(Json::as_str) else {
            return identity();
        };
        let region = p
            .get("region")
            .and_then(Json::as_str)
            .and_then(Region::parse);
        let (x, y) = (number(p.get("x")), number(p.get("y")));
        let (Some(declared), true, false, Some(region), Some(x), Some(y)) = (
            constraints.get(id),
            required_ids.is_none_or(|ids| ids.contains(&id)),
            seen.iter().any(|s| s == id),
            region,
            x,
            y,
        ) else {
            return identity();
        };
        if x < 0.0 || y < 0.0 {
            return identity();
        }
        seen.push(id.to_owned());
        let c = constraint_in_region(declared, region);
        let dimensions = size(Some(raw), MAX_SIZE)?;
        let preferred = size(p.get("preferred"), MAX_SIZE)?;
        if !c.allows(region)
            || dimensions.width < c.min.width
            || dimensions.height < c.min.height
            || preferred.width < c.min.width
            || preferred.height < c.min.height
            || dimensions.width > c.max.width
            || dimensions.height > c.max.height
            || x + dimensions.width > MAX_COORDINATE
            || y + dimensions.height > reference.get(region).height + EPSILON
            || (region == Region::Sidebar
                && (x != 0.0 || dimensions.width != reference.sidebar.width))
            || (region == Region::Bottom
                && (y != 0.0 || dimensions.height != reference.bottom.height))
        {
            return reject("Invalid widget constraints");
        }
        placements.push(Placement {
            id: id.to_owned(),
            region,
            x,
            y,
            width: dimensions.width,
            height: dimensions.height,
            preferred,
        });
    }
    for (i, p) in placements.iter().enumerate() {
        if placements[i + 1..]
            .iter()
            .any(|q| p.region == q.region && coexist(p, q) && collides(&p.bounds(), &q.bounds()))
        {
            return reject("Invalid widget clearance");
        }
    }
    let placements = match required_ids {
        Some(ids) => ids
            .iter()
            .map(|id| {
                placements
                    .iter()
                    .find(|p| p.id == *id)
                    .cloned()
                    .expect("every required identity was validated")
            })
            .collect(),
        None => placements,
    };
    Ok(Layout {
        reference,
        placements,
    })
}
