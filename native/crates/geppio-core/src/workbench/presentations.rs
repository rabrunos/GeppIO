//! Widget presentations (`shared/workbench/presentations.ts`): the codec, edge validation,
//! presentation changes, the panel arrangement and the return to Normal.
use super::model::{Registry, View, WidgetType, WorkbenchSnapshot};
use crate::freeform::CodecError;
use crate::freeform::project_region;
use crate::freeform::schema::reject;
use crate::js;
use crate::json::{Json, JsonObject, ObjectWriter};
use crate::layout::geometry::{clamp, collides, valid_layout, valid_rect};
use crate::layout::policy::{MAX_COORDINATE, MAX_SIZE, MAX_WIDGETS};
use crate::layout::{Bounds, Constraints, Placement, Region, Size, Surface};

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

// ---- presentation changes and panel arrangement --------------------------------------------

/// Height of a collapsed panel bar.
pub const PANEL_BAR_HEIGHT: f64 = 31.0;
/// Gap between a panel reservation and Normal widgets.
pub const PANEL_GAP: f64 = 10.0;
/// Anchor edges in priority order (`EDGES`).
pub const EDGES: [Edge; 4] = [Edge::Top, Edge::Bottom, Edge::Left, Edge::Right];
/// Width of a free overlay trigger.
const FREE_TRIGGER_WIDTH: f64 = 208.0;

/// Whether an anchor is a horizontal edge (`horizontal`).
pub fn horizontal(anchor: Option<Edge>) -> bool {
    matches!(anchor, Some(Edge::Top | Edge::Bottom))
}

fn size_object(width: f64, height: f64) -> JsonObject {
    JsonObject::new()
        .with("width", Json::Number(width))
        .with("height", Json::Number(height))
}

/// A point object (`{ x, y }`).
pub fn point_object(x: f64, y: f64) -> JsonObject {
    JsonObject::new()
        .with("x", Json::Number(x))
        .with("y", Json::Number(y))
}

/// The preference of a view that has none yet (`defaultPresentation`).
pub fn default_presentation(view: &View, registry: &Registry) -> WidgetPresentation {
    let order = [
        "host:summary",
        "host:queue",
        "host:properties",
        "host:activity",
    ];
    let index = order.iter().position(|t| *t == view.type_id).unwrap_or(0) as f64;
    WidgetPresentation {
        view_id: view.id.clone(),
        type_id: view.type_id.clone(),
        model_id: view.model_id.clone(),
        owner: registry
            .get(&view.type_id)
            .map_or_else(|| "host".to_owned(), |t| t.owner.clone()),
        presentation: Presentation::Normal,
        open: true,
        anchor: None,
        preferred: size_object(320.0, 260.0),
        position: point_object(24.0, 24.0 + index * 41.0),
    }
}

/// The stored preference of a view, or its default (`presentationFor`).
pub fn presentation_for(
    snapshot: &WorkbenchSnapshot,
    id: &str,
    registry: &Registry,
) -> Option<WidgetPresentation> {
    if let Some(e) = snapshot
        .organization
        .presentations
        .entries
        .iter()
        .find(|e| e.view_id == id)
    {
        return Some(e.clone());
    }
    let view = snapshot.organization.views.iter().find(|v| v.id == id)?;
    Some(default_presentation(view, registry))
}

/// A partial preference (`PresentationPatch`). `anchor: Some(None)` asks for a free overlay;
/// `preferred` and `position` replace the stored objects.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PresentationPatch {
    /// New presentation.
    pub presentation: Option<Presentation>,
    /// Docked/overlay open state.
    pub open: Option<bool>,
    /// Anchor edge (`Some(None)` = no anchor).
    pub anchor: Option<Option<Edge>>,
    /// Preferred panel size object.
    pub preferred: Option<JsonObject>,
    /// Free overlay position object.
    pub position: Option<JsonObject>,
}

fn reparse(
    entries: Vec<WidgetPresentation>,
    views: &[View],
    registry: &Registry,
) -> Result<Presentations, CodecError> {
    let mut text = String::new();
    write_presentations(&mut text, &Presentations { entries });
    let Ok(value) = crate::json::parse(&text) else {
        return reject("Unsupported presentations");
    };
    parse_presentations(Some(&value), views, registry)
}

/// Changes one view's presentation (`changePresentation`); errors name the refusal.
pub fn change_presentation(
    source: &WorkbenchSnapshot,
    patch: &PresentationPatch,
    registry: &Registry,
    id: &str,
) -> Result<WorkbenchSnapshot, CodecError> {
    let view = source.organization.views.iter().find(|v| v.id == id);
    let placement = source.placements.iter().find(|p| p.id == id);
    let t = view.and_then(|v| registry.get(&v.type_id));
    let (Some(_), Some(t), Some(placement), Some(before)) =
        (view, t, placement, presentation_for(source, id, registry))
    else {
        return reject("Unavailable presentation");
    };
    let wanted = patch.presentation.unwrap_or(before.presentation);
    if t.presentations.is_none()
        || placement.region != Region::Main
        || !available_presentations(t, placement.region).contains(&wanted)
    {
        return reject("Unavailable presentation");
    }
    let mut entry = before.clone();
    if let Some(p) = patch.presentation {
        entry.presentation = p;
    }
    if let Some(open) = patch.open {
        entry.open = open;
    }
    if let Some(anchor) = patch.anchor {
        entry.anchor = anchor;
    }
    if let Some(preferred) = &patch.preferred {
        entry.preferred = preferred.clone();
    }
    if let Some(position) = &patch.position {
        entry.position = position.clone();
    }
    if entry.presentation != Presentation::Normal && super::model::group_for(source, id).is_some() {
        return reject("Grouped widgets require Normal presentation");
    }
    if patch.presentation.is_some_and(|p| p != before.presentation) && patch.open.is_none() {
        entry.open = true;
    }
    if patch.presentation == Some(Presentation::Normal) {
        entry.open = true;
        entry.anchor = None;
    }
    if patch
        .presentation
        .is_some_and(|p| p != Presentation::Normal)
        && patch.anchor.is_none()
    {
        return reject("Anchor required");
    }
    let previous = &source.organization.presentations.entries;
    let entries = if previous.iter().any(|e| e.view_id == id) {
        previous
            .iter()
            .map(|e| {
                if e.view_id == id {
                    entry.clone()
                } else {
                    e.clone()
                }
            })
            .collect()
    } else {
        let mut all = previous.clone();
        all.push(entry);
        all
    };
    let presentations = reparse(entries, &source.organization.views, registry)?;
    let mut next = source.clone();
    next.organization.presentations = presentations;
    validate_presentation_edges(&next)?;
    Ok(next)
}

/// The space each edge reserves (`reservations`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Reservations {
    /// Top.
    pub top: f64,
    /// Bottom.
    pub bottom: f64,
    /// Left.
    pub left: f64,
    /// Right.
    pub right: f64,
}

impl Reservations {
    fn set(&mut self, edge: Edge, value: f64) {
        match edge {
            Edge::Top => self.top = value,
            Edge::Bottom => self.bottom = value,
            Edge::Left => self.left = value,
            Edge::Right => self.right = value,
        }
    }
}

/// The geometry of one panel (`PanelGeometry`).
#[derive(Clone, Debug, PartialEq)]
pub struct PanelGeometry {
    /// The open panel.
    pub expanded: Bounds,
    /// The collapsed bar or trigger.
    pub collapsed: Bounds,
    /// Whether the panel shows open now.
    pub shown: bool,
    /// Whether the viewport forced a smaller or closed panel.
    pub adapted: bool,
    /// The panel's preference.
    pub state: WidgetPresentation,
}

/// One arrangement of the Main panels (`PresentationLayout`).
#[derive(Clone, Debug, PartialEq)]
pub struct PresentationLayout {
    /// Panels by view, in preference order.
    pub panels: Vec<(String, PanelGeometry)>,
    /// The area left to Normal widgets.
    pub normal: Bounds,
    /// What each edge reserves.
    pub reservations: Reservations,
    /// Some panel is adapted.
    pub adapted: bool,
    /// Normal widgets fit the remaining area.
    pub feasible: bool,
}

impl PresentationLayout {
    /// The geometry of a view's panel.
    pub fn panel(&self, id: &str) -> Option<&PanelGeometry> {
        self.panels.iter().find(|(v, _)| v == id).map(|(_, p)| p)
    }
}

fn pref(e: &WidgetPresentation, height: bool) -> f64 {
    let (w, h) = e.preferred_size();
    if height { h } else { w }
}

fn position(e: &WidgetPresentation) -> (f64, f64) {
    let n = |k: &str| e.position.get(k).and_then(Json::as_f64).unwrap_or(0.0);
    (n("x"), n("y"))
}

/// One pure arrangement (`arrangePresentations`): horizontal edges own the corners, absent
/// edges reserve nothing; requested extents shrink together, then docked panels collapse in
/// reverse edge priority. Preferences stay untouched.
pub fn arrange_presentations(
    source: &WorkbenchSnapshot,
    size: Size,
    constraints: &Constraints,
    expanded: bool,
    scrollbar_height: f64,
    hypothetical: bool,
) -> PresentationLayout {
    let width = js::max(0.0, size.width);
    let height = js::max(0.0, size.height);
    let ids = panel_ids(source);
    let entries: Vec<&WidgetPresentation> = source
        .organization
        .presentations
        .entries
        .iter()
        .filter(|e| ids.contains(&e.view_id))
        .collect();
    let anchored: Vec<&WidgetPresentation> = EDGES
        .iter()
        .flat_map(|edge| {
            entries
                .iter()
                .copied()
                .filter(move |e| e.anchor == Some(*edge))
        })
        .collect();
    let docked: Vec<&WidgetPresentation> = anchored
        .iter()
        .copied()
        .filter(|e| e.presentation == Presentation::Docked)
        .collect();
    let floating: Vec<&WidgetPresentation> = entries
        .iter()
        .copied()
        .filter(|e| e.presentation == Presentation::Overlay)
        .collect();
    let free: Vec<&WidgetPresentation> = floating
        .iter()
        .copied()
        .filter(|e| e.anchor.is_none())
        .collect();
    let peers: Vec<Placement> = source
        .placements
        .iter()
        .filter(|p| !ids.contains(&p.id) && constraints.get(&p.id).is_some())
        .cloned()
        .collect();
    let mut open: Vec<String> = docked
        .iter()
        .filter(|e| e.open)
        .map(|e| e.view_id.clone())
        .collect();
    let extent = |open: &[String], e: &WidgetPresentation, factor: f64| {
        let h = horizontal(e.anchor);
        if open.contains(&e.view_id) {
            let min = if h { PANEL_MIN.1 } else { PANEL_MIN.0 };
            min + (pref(e, h) - min) * factor
        } else {
            PANEL_BAR_HEIGHT
        }
    };
    let budget = |open: &[String], factor: f64| {
        let mut r = Reservations::default();
        for e in &anchored {
            r.set(
                e.anchor.expect("anchored"),
                extent(open, e, factor) + PANEL_GAP,
            );
        }
        let normal = Bounds::new(
            r.left,
            r.top,
            js::max(0.0, width - r.left - r.right),
            js::max(0.0, height - r.top - r.bottom),
        );
        (r, normal)
    };
    let fits = |open: &[String], factor: f64| {
        let (r, normal) = budget(open, factor);
        if normal.width < 32.0 || normal.height < 32.0 {
            return false;
        }
        if floating
            .iter()
            .any(|e| e.anchor.is_some() && !horizontal(e.anchor))
            && normal.height < 150.0
        {
            return false;
        }
        if floating.iter().any(|e| horizontal(e.anchor)) && normal.width < 160.0 {
            return false;
        }
        if !free.is_empty()
            && (normal.width < 160.0
                || normal.height < free.len() as f64 * (PANEL_BAR_HEIGHT + PANEL_GAP) - PANEL_GAP)
        {
            return false;
        }
        if anchored.iter().any(|e| !horizontal(e.anchor)) && height - r.top - r.bottom < 150.0 {
            return false;
        }
        if docked.iter().any(|e| {
            open.contains(&e.view_id)
                && if horizontal(e.anchor) {
                    width < PANEL_MIN.0
                } else {
                    height - r.top - r.bottom < PANEL_MIN.1
                }
        }) {
            return false;
        }
        let extra = if scrollbar_height > 0.0 { 1.0 } else { 0.0 };
        project_region(
            &peers,
            &source.reference,
            Region::Main,
            Size::new(
                normal.width.floor(),
                (normal.height - scrollbar_height - extra).floor(),
            ),
            expanded,
            constraints,
        )
        .feasible
    };
    for e in docked.iter().rev() {
        if fits(&open, 0.0) {
            break;
        }
        open.retain(|v| *v != e.view_id);
    }
    let mut factor = 1.0;
    if !fits(&open, 1.0) {
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..30 {
            let mid = (lo + hi) / 2.0;
            if fits(&open, mid) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        factor = lo;
    }
    let (r, normal) = budget(&open, factor);
    let mut panels: Vec<(String, PanelGeometry)> = Vec::new();
    for state in &entries {
        let is_docked = state.presentation == Presentation::Docked;
        let axis_horizontal = horizontal(state.anchor);
        let area = if state.anchor.is_some() {
            Bounds::new(0.0, r.top, width, js::max(0.0, height - r.top - r.bottom))
        } else {
            normal
        };
        let (pw, ph) = state.preferred_size();
        let mut w = js::min(area.width, pw);
        let mut h = js::min(area.height, ph);
        if state.anchor.is_some() && axis_horizontal {
            w = width;
            let other = if state.anchor == Some(Edge::Top) {
                r.bottom
            } else {
                r.top
            };
            h = js::min(height - other, ph);
        }
        if state.anchor.is_some() && !axis_horizontal {
            let other = if state.anchor == Some(Edge::Left) {
                r.right
            } else {
                r.left
            };
            w = js::min(width - other, pw);
            h = area.height;
        }
        if is_docked && open.contains(&state.view_id) {
            if axis_horizontal {
                h = extent(&open, state, factor);
            } else {
                w = extent(&open, state, factor);
            }
        }
        let (mut x, mut y) = (area.x, area.y);
        if state.anchor.is_some() && axis_horizontal {
            y = if state.anchor == Some(Edge::Top) {
                0.0
            } else {
                height - h
            };
        }
        if state.anchor == Some(Edge::Right) {
            x = area.x + area.width - w;
        }
        if state.anchor.is_none() {
            let (px, py) = position(state);
            x = clamp(px, area.x, area.x + area.width - w);
            y = clamp(py, area.y, area.y + area.height - h);
        }
        let rect = Bounds::new(x, y, w, h);
        let mut collapsed = rect;
        if state.anchor.is_none() {
            collapsed.width = js::min(FREE_TRIGGER_WIDTH, area.width);
            collapsed.height = js::min(PANEL_BAR_HEIGHT, area.height);
        } else if axis_horizontal {
            collapsed.height = js::min(PANEL_BAR_HEIGHT, height);
            if state.anchor == Some(Edge::Bottom) {
                collapsed.y = height - collapsed.height;
            }
        } else {
            collapsed.width = js::min(PANEL_BAR_HEIGHT, width);
            if state.anchor == Some(Edge::Right) {
                collapsed.x = area.x + area.width - collapsed.width;
            }
        }
        let shown = if is_docked {
            open.contains(&state.view_id)
        } else {
            w >= PANEL_MIN.0 && h >= PANEL_MIN.1
        };
        let adapted = (if is_docked {
            state.open && !shown
        } else {
            !shown
        }) || (shown
            && if axis_horizontal {
                h < ph
            } else if state.anchor.is_some() {
                w < pw
            } else {
                w < pw || h < ph
            });
        let mut geometry = PanelGeometry {
            expanded: rect,
            collapsed,
            shown,
            adapted,
            state: (*state).clone(),
        };
        if hypothetical && is_docked && !state.open {
            // The same joint policy as an actual reopen, with bounded recursion.
            let mut reopening = source.clone();
            for e in &mut reopening.organization.presentations.entries {
                if e.view_id == state.view_id {
                    e.open = true;
                }
            }
            let again = arrange_presentations(
                &reopening,
                size,
                constraints,
                expanded,
                scrollbar_height,
                false,
            );
            if let Some(p) = again.panel(&state.view_id) {
                geometry.expanded = p.expanded;
            }
        }
        panels.push((state.view_id.clone(), geometry));
    }
    // Free triggers stay apart even when clamping coalesces saved positions.
    let mut parked: Vec<Bounds> = Vec::new();
    let area = normal;
    let mut sorted = free.clone();
    sorted.sort_by(|a, b| js::locale_compare(&a.view_id, &b.view_id));
    for state in sorted {
        let w = js::min(FREE_TRIGGER_WIDTH, area.width);
        let h = js::min(PANEL_BAR_HEIGHT, area.height);
        let (px, py) = position(state);
        let x = clamp(px, area.x, area.x + area.width - w);
        let y = clamp(py, area.y, area.y + area.height - h);
        let mut candidates = vec![y];
        candidates.extend((0..free.len()).map(|i| area.y + i as f64 * (h + PANEL_GAP)));
        candidates.extend(parked.iter().map(|p| p.y + p.height + PANEL_GAP));
        let trigger = candidates
            .into_iter()
            .map(|at| Bounds::new(x, at, w, h))
            .filter(|p| p.y + h <= area.y + area.height)
            .find(|c| parked.iter().all(|o| !collides(c, o)))
            .unwrap_or(Bounds::new(x, y, w, h));
        parked.push(trigger);
        if let Some((_, panel)) = panels.iter_mut().find(|(v, _)| *v == state.view_id) {
            panel.collapsed = trigger;
            let e = panel.expanded;
            panel.expanded = Bounds::new(
                clamp(trigger.x, normal.x, normal.x + normal.width - e.width),
                clamp(trigger.y, normal.y, normal.y + normal.height - e.height),
                e.width,
                e.height,
            );
        }
    }
    let adapted = panels.iter().any(|(_, p)| p.adapted);
    PresentationLayout {
        panels,
        normal,
        reservations: r,
        adapted,
        feasible: fits(&open, factor),
    }
}

/// Back to Normal (`returnToNormal`): visible peers are frozen before the reservation is
/// released, and the exact candidate must be valid; `Ok(None)` when it does not fit.
pub fn return_to_normal(
    source: &WorkbenchSnapshot,
    id: &str,
    size: Size,
    registry: &Registry,
    expanded: bool,
    scrollbar_height: f64,
) -> Result<Option<WorkbenchSnapshot>, CodecError> {
    let constraints = super::model::snapshot_constraints(source, registry);
    let before =
        arrange_presentations(source, size, &constraints, expanded, scrollbar_height, true);
    let Some(panel) = before.panel(id).cloned() else {
        return Ok(None);
    };
    let mut next = change_presentation(
        source,
        &PresentationPatch {
            presentation: Some(Presentation::Normal),
            ..Default::default()
        },
        registry,
        id,
    )?;
    let ids = panel_ids(source);
    let preserve = source
        .type_of(id)
        .and_then(|t| registry.get(t))
        .is_some_and(|t| t.preserve_normal_geometry);
    if preserve {
        // A real widget reuses its existing Normal seed, never the panel's rectangle.
        let next_ids = panel_ids(&next);
        let normals: Vec<Placement> = next
            .placements
            .iter()
            .filter(|p| p.region == Region::Main && !next_ids.contains(&p.id))
            .cloned()
            .collect();
        let main = next.reference.main;
        if !valid_layout(
            &normals,
            &Surface::new(Region::Main, main.width, main.height, expanded),
            &constraints,
        ) || !arrange_presentations(&next, size, &constraints, expanded, scrollbar_height, true)
            .feasible
        {
            return Ok(None);
        }
        return Ok(Some(next));
    }
    let peers: Vec<Placement> = source
        .placements
        .iter()
        .filter(|p| !ids.contains(&p.id))
        .cloned()
        .collect();
    let normals = project_region(
        &peers,
        &source.reference,
        Region::Main,
        Size::new(before.normal.width, before.normal.height - scrollbar_height),
        expanded,
        &constraints,
    );
    if !normals.feasible {
        return Ok(None);
    }
    let mut absolute: Vec<Placement> = normals
        .placements
        .iter()
        .map(|p| {
            let mut q = p.clone();
            q.x = p.x + before.normal.x;
            q.y = p.y + before.normal.y;
            q
        })
        .collect();
    let Some(mut own) = source.placements.iter().find(|p| p.id == id).cloned() else {
        return Ok(None);
    };
    own.set_bounds(panel.expanded);
    absolute.push(own);
    let mut candidate = next.clone();
    candidate.reference.main = size;
    for p in &mut candidate.placements {
        if let Some(q) = absolute.iter().find(|q| q.id == p.id) {
            *p = q.clone();
        }
    }
    let mut after = arrange_presentations(
        &candidate,
        size,
        &constraints,
        expanded,
        scrollbar_height,
        true,
    );
    let mut after_scrollbar = scrollbar_height;
    for _ in 0..2 {
        after_scrollbar = if expanded
            && absolute
                .iter()
                .any(|p| p.x + p.width > after.normal.x + after.normal.width)
        {
            scrollbar_height
        } else {
            0.0
        };
        after = arrange_presentations(
            &candidate,
            size,
            &constraints,
            expanded,
            after_scrollbar,
            true,
        );
    }
    let converted: Vec<Placement> = absolute
        .iter()
        .map(|p| {
            let mut q = p.clone();
            q.x = p.x - after.normal.x;
            q.y = p.y - after.normal.y;
            q.preferred = Size::new(p.width, p.height);
            q
        })
        .collect();
    let available = Surface::new(
        Region::Main,
        after.normal.width,
        after.normal.height - after_scrollbar,
        expanded,
    );
    let own_converted = converted.iter().find(|p| p.id == id);
    let own_valid = match (own_converted, constraints.get(id)) {
        (Some(p), Some(c)) => valid_rect(
            &p.bounds(),
            &Surface::new(Region::Main, available.width, available.height, false),
            c,
        ),
        _ => false,
    };
    if !valid_layout(&converted, &available, &constraints) || !own_valid {
        return Ok(None);
    }
    next.reference.main = Size::new(available.width, available.height);
    for p in &mut next.placements {
        if let Some(q) = converted.iter().find(|q| q.id == p.id) {
            *p = q.clone();
        }
    }
    Ok(Some(next))
}
