//! Persistent widget presentations (`shared/workbench/presentations.ts`): the codec,
//! edge validation and the lookups commands use. Panel arrangement stays with the host UI.
use super::model::{Registry, View, WidgetType, WorkbenchSnapshot};
use crate::freeform::CodecError;
use crate::freeform::schema::reject;
use crate::json::{Json, JsonObject, ObjectWriter};
use crate::layout::Region;
use crate::layout::policy::{MAX_COORDINATE, MAX_SIZE, MAX_WIDGETS};

/// The pilot view of version-1 presentation documents.
pub const PILOT_VIEW: &str = "properties";
/// Minimum panel size.
pub const PANEL_MIN: (f64, f64) = (240.0, 220.0);

/// How a widget is presented in Main.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presentation {
    /// An ordinary frame.
    Normal,
    /// Docked to an edge, reserving space.
    Docked,
    /// Floating over the scene.
    Overlay,
}

impl Presentation {
    /// `'normal' | 'docked' | 'overlay'`.
    pub fn as_str(self) -> &'static str {
        match self {
            Presentation::Normal => "normal",
            Presentation::Docked => "docked",
            Presentation::Overlay => "overlay",
        }
    }
    /// Parses a presentation.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "normal" => Some(Presentation::Normal),
            "docked" => Some(Presentation::Docked),
            "overlay" => Some(Presentation::Overlay),
            _ => None,
        }
    }
}

/// A panel anchor edge.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    /// Top.
    Top,
    /// Bottom.
    Bottom,
    /// Left.
    Left,
    /// Right.
    Right,
}

impl Edge {
    /// `'top' | 'bottom' | 'left' | 'right'`.
    pub fn as_str(self) -> &'static str {
        match self {
            Edge::Top => "top",
            Edge::Bottom => "bottom",
            Edge::Left => "left",
            Edge::Right => "right",
        }
    }
    /// Parses an edge.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "top" => Some(Edge::Top),
            "bottom" => Some(Edge::Bottom),
            "left" => Some(Edge::Left),
            "right" => Some(Edge::Right),
            _ => None,
        }
    }
}

/// The presentation preference of one view. `preferred` and `position` keep the validated
/// document objects verbatim: the reference copies them with a spread, so any extra keys and
/// their order survive a round trip.
#[derive(Clone, Debug, PartialEq)]
pub struct WidgetPresentation {
    /// View.
    pub view_id: String,
    /// Type of the view.
    pub type_id: String,
    /// Model of the view.
    pub model_id: String,
    /// Owner of the type.
    pub owner: String,
    /// Presentation.
    pub presentation: Presentation,
    /// Whether a docked/overlay panel is open.
    pub open: bool,
    /// Anchor edge (`None` for Normal and free overlays).
    pub anchor: Option<Edge>,
    /// Preferred panel size (`width`, `height` validated).
    pub preferred: JsonObject,
    /// Free overlay position (`x`, `y` validated).
    pub position: JsonObject,
}

impl WidgetPresentation {
    /// Preferred panel size.
    pub fn preferred_size(&self) -> (f64, f64) {
        let n = |k: &str| self.preferred.get(k).and_then(Json::as_f64).unwrap_or(0.0);
        (n("width"), n("height"))
    }
}

/// Presentation preferences (`{ version: 2, entries }`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Presentations {
    /// Entries in order.
    pub entries: Vec<WidgetPresentation>,
}

/// Presentations a type offers in a region (`availablePresentations`).
pub fn available_presentations(t: &WidgetType, region: Region) -> Vec<Presentation> {
    if t.constraint.allows(region) && region == Region::Main {
        t.presentations
            .clone()
            .unwrap_or_else(|| vec![Presentation::Normal])
    } else {
        vec![Presentation::Normal]
    }
}

/// The current presentation of a view (`presentationFor(...).presentation`); views without
/// an entry are Normal.
pub fn presentation_of(snapshot: &WorkbenchSnapshot, id: &str) -> Presentation {
    snapshot
        .organization
        .presentations
        .entries
        .iter()
        .find(|e| e.view_id == id)
        .map_or(Presentation::Normal, |e| e.presentation)
}

/// Views shown as active Main panels (`panelIds`).
pub fn panel_ids(source: &WorkbenchSnapshot) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in &source.organization.presentations.entries {
        if e.presentation != Presentation::Normal
            && source
                .placements
                .iter()
                .any(|p| p.id == e.view_id && p.region == Region::Main)
            && !out.contains(&e.view_id)
        {
            out.push(e.view_id.clone());
        }
    }
    out
}

/// Validates presentation preferences (`parsePresentations`); version 1 is read as 2.
pub fn parse_presentations(
    value: Option<&Json>,
    views: &[View],
    registry: &Registry,
) -> Result<Presentations, CodecError> {
    let Some(value) = value else {
        return Ok(Presentations::default());
    };
    let version = value.get("version").and_then(Json::as_f64);
    let entries = value.get("entries").and_then(Json::as_array);
    let (Some(version @ (1.0 | 2.0)), Some(entries)) = (version, entries) else {
        return reject("Unsupported presentations");
    };
    let v1 = version == 1.0;
    if entries.len() > if v1 { 1 } else { MAX_WIDGETS } {
        return reject("Unsupported presentations");
    }
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::with_capacity(entries.len());
    for item in entries {
        let invalid = || reject("Invalid presentation association or geometry");
        if !item.truthy() {
            return invalid();
        }
        let view_id = item.get("viewId");
        let view = views
            .iter()
            .find(|v| view_id.and_then(Json::as_str) == Some(v.id.as_str()));
        let Some(view) = view else {
            return invalid();
        };
        let Some(t) = registry.get(&view.type_id) else {
            return invalid();
        };
        let presentation = item
            .get("presentation")
            .and_then(Json::as_str)
            .and_then(Presentation::parse);
        let anchor_value = item.get("anchor");
        let anchor = anchor_value.and_then(Json::as_str).and_then(Edge::parse);
        let anchor_null = anchor_value == Some(&Json::Null);
        let preferred = item.get("preferred").and_then(Json::as_object);
        let position = item.get("position").and_then(Json::as_object);
        let panel = |o: Option<&JsonObject>| {
            o.is_some_and(|o| {
                [("width", PANEL_MIN.0), ("height", PANEL_MIN.1)]
                    .iter()
                    .all(|&(axis, min)| {
                        o.get(axis)
                            .and_then(Json::finite)
                            .is_some_and(|n| n >= min && n <= MAX_SIZE)
                    })
            })
        };
        let point = |o: Option<&JsonObject>| {
            o.is_some_and(|o| {
                ["x", "y"].iter().all(|k| {
                    o.get(k)
                        .and_then(Json::finite)
                        .is_some_and(|n| (0.0..=MAX_COORDINATE).contains(&n))
                })
            })
        };
        let Some(presentation) = presentation else {
            return invalid();
        };
        if item.get("typeId").and_then(Json::as_str) != Some(view.type_id.as_str())
            || item.get("modelId").and_then(Json::as_str) != Some(view.model_id.as_str())
            || item.get("owner").and_then(Json::as_str) != Some(t.owner.as_str())
            || !available_presentations(t, Region::Main).contains(&presentation)
            || t.presentations.is_none()
            || seen.contains(&view.id)
            || item.get("open").and_then(Json::as_bool).is_none()
            || (if v1 {
                view.id != PILOT_VIEW || anchor != Some(Edge::Bottom)
            } else {
                !anchor_null && anchor.is_none()
            })
            || (presentation == Presentation::Docked && anchor_null)
            || (!v1 && presentation == Presentation::Normal && !anchor_null)
            || !panel(preferred)
            || (!v1 && !point(position))
        {
            return invalid();
        }
        seen.push(view.id.clone());
        out.push(WidgetPresentation {
            view_id: view.id.clone(),
            type_id: view.type_id.clone(),
            model_id: view.model_id.clone(),
            owner: t.owner.clone(),
            presentation,
            open: item.get("open").and_then(Json::as_bool).expect("checked"),
            anchor: if presentation == Presentation::Normal {
                None
            } else {
                anchor
            },
            preferred: preferred.expect("checked").clone(),
            position: if v1 {
                JsonObject::new()
                    .with("x", Json::Number(24.0))
                    .with("y", Json::Number(24.0))
            } else {
                position.expect("checked").clone()
            },
        });
    }
    Ok(Presentations { entries: out })
}

/// Active panels may not share an anchor edge (`validatePresentationEdges`).
pub fn validate_presentation_edges(source: &WorkbenchSnapshot) -> Result<(), CodecError> {
    let mut used: Vec<Edge> = Vec::new();
    for entry in &source.organization.presentations.entries {
        if entry.presentation != Presentation::Normal
            && let Some(anchor) = entry.anchor
            && source
                .placements
                .iter()
                .any(|p| p.id == entry.view_id && p.region == Region::Main)
        {
            if used.contains(&anchor) {
                return reject("Occupied presentation edge");
            }
            used.push(anchor);
        }
    }
    Ok(())
}

pub(crate) fn write_presentations(out: &mut String, presentations: &Presentations) {
    let mut w = ObjectWriter::new(out);
    w.number("version", 2.0);
    w.raw("entries", |o| {
        crate::json::write_array(o, &presentations.entries, |o, e| {
            let mut w = ObjectWriter::new(o);
            w.string("viewId", &e.view_id)
                .string("typeId", &e.type_id)
                .string("modelId", &e.model_id)
                .string("owner", &e.owner)
                .string("presentation", e.presentation.as_str())
                .bool("open", e.open)
                .nullable_string("anchor", e.anchor.map(Edge::as_str))
                .raw("preferred", |o| Json::Object(e.preferred.clone()).write(o))
                .raw("position", |o| Json::Object(e.position.clone()).write(o));
            w.end();
        });
    });
    w.end();
}
