//! Differential tests: every fixture under `tests/fixtures/` was produced by the TypeScript
//! reference (`tools/native-fixtures.ts`). The Rust port must reproduce rectangles within
//! 1e-9, identical statuses, reasons, counters, locks, guides and serialized bytes.
use geppio_core::json::{self, Json};
use geppio_core::layout::{
    AlignedGesture, AlignmentLocks, Axis, Bounds, Budget, Constraint, Constraints, Gesture,
    PerRegion, Placement, ReflowResult, Region, Size, Surface, aligned_gesture, candidate, reflow,
};

const TOLERANCE: f64 = 1e-9;

fn fixture(name: &str) -> Json {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    json::parse(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn get<'a>(v: &'a Json, key: &str) -> &'a Json {
    v.get(key)
        .unwrap_or_else(|| panic!("missing {key} in {}", short(v)))
}
fn num(v: &Json, key: &str) -> f64 {
    get(v, key)
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is not a number"))
}
fn text<'a>(v: &'a Json, key: &str) -> &'a str {
    get(v, key)
        .as_str()
        .unwrap_or_else(|| panic!("{key} is not a string"))
}
fn array<'a>(v: &'a Json, key: &str) -> &'a [Json] {
    get(v, key)
        .as_array()
        .unwrap_or_else(|| panic!("{key} is not an array"))
}
fn short(v: &Json) -> String {
    let s = v.stringify();
    s.chars().take(200).collect()
}

pub fn size(v: &Json) -> Size {
    Size::new(num(v, "width"), num(v, "height"))
}
pub fn bounds(v: &Json) -> Bounds {
    Bounds::new(num(v, "x"), num(v, "y"), num(v, "width"), num(v, "height"))
}
pub fn region(v: &Json) -> Region {
    Region::parse(v.as_str().expect("region string")).expect("known region")
}
pub fn placement(v: &Json) -> Placement {
    Placement {
        id: text(v, "id").to_owned(),
        region: region(get(v, "region")),
        x: num(v, "x"),
        y: num(v, "y"),
        width: num(v, "width"),
        height: num(v, "height"),
        preferred: size(get(v, "preferred")),
    }
}
pub fn placements(v: &Json) -> Vec<Placement> {
    v.as_array()
        .expect("placements array")
        .iter()
        .map(placement)
        .collect()
}
pub fn surface(v: &Json) -> Surface {
    Surface::new(
        region(get(v, "region")),
        num(v, "width"),
        num(v, "height"),
        get(v, "expanded").as_bool().expect("expanded"),
    )
}
pub fn constraint(v: &Json) -> Constraint {
    let mut region_min = PerRegion::<Option<Size>>::default();
    if let Some(min) = v.get("regionMin").and_then(Json::as_object) {
        for (key, value) in min.iter() {
            *region_min.get_mut(Region::parse(key).expect("region")) = Some(size(value));
        }
    }
    Constraint {
        min: size(get(v, "min")),
        default: size(get(v, "default")),
        max: size(get(v, "max")),
        resize_x: get(v, "resizeX").as_bool().unwrap(),
        resize_y: get(v, "resizeY").as_bool().unwrap(),
        region_min,
        regions: array(v, "regions").iter().map(region).collect(),
    }
}
pub fn constraints(v: &Json) -> Constraints {
    v.as_object()
        .expect("constraints object")
        .iter()
        .map(|(id, c)| (id.to_owned(), constraint(c)))
        .collect()
}
fn gesture(v: &Json) -> Gesture {
    Gesture::parse(v.as_str().unwrap()).expect("known gesture")
}

fn close(context: &str, field: &str, a: f64, b: f64) {
    assert!(
        (a - b).abs() <= TOLERANCE || (a.is_infinite() && a == b),
        "{context}: {field} {a} != expected {b}"
    );
}
pub fn same_bounds(context: &str, actual: Bounds, expected: &Json) {
    let e = bounds(expected);
    close(context, "x", actual.x, e.x);
    close(context, "y", actual.y, e.y);
    close(context, "width", actual.width, e.width);
    close(context, "height", actual.height, e.height);
}
pub fn same_placements(context: &str, actual: &[Placement], expected: &Json) {
    let expected = expected.as_array().expect("placements");
    assert_eq!(actual.len(), expected.len(), "{context}: placement count");
    for (a, e) in actual.iter().zip(expected) {
        let context = format!("{context}/{}", a.id);
        assert_eq!(a.id, text(e, "id"), "{context}: identity order");
        assert_eq!(a.region.as_str(), text(e, "region"), "{context}: region");
        same_bounds(&context, a.bounds(), e);
        close(
            &context,
            "preferred.width",
            a.preferred.width,
            num(get(e, "preferred"), "width"),
        );
        close(
            &context,
            "preferred.height",
            a.preferred.height,
            num(get(e, "preferred"), "height"),
        );
    }
}
fn same_result(context: &str, actual: &ReflowResult, expected: &Json) {
    assert_eq!(
        actual.status.as_str(),
        text(expected, "status"),
        "{context}: status"
    );
    assert_eq!(
        actual.reason.map(|r| r.as_str()),
        expected.get("reason").and_then(Json::as_str),
        "{context}: reason"
    );
    assert_eq!(
        actual.states as f64,
        num(expected, "states"),
        "{context}: states"
    );
    assert_eq!(
        actual.probes as f64,
        num(expected, "probes"),
        "{context}: probes"
    );
    assert_eq!(
        actual.candidates as f64,
        num(expected, "candidates"),
        "{context}: candidates"
    );
    same_placements(context, &actual.placements, get(expected, "placements"));
}
fn locks(v: Option<&Json>) -> AlignmentLocks {
    AlignmentLocks {
        x: v.and_then(|l| l.get("x"))
            .and_then(Json::as_str)
            .map(str::to_owned),
        y: v.and_then(|l| l.get("y"))
            .and_then(Json::as_str)
            .map(str::to_owned),
    }
}
fn same_aligned(context: &str, actual: &AlignedGesture, frame: &Json) {
    same_result(context, &actual.result, get(frame, "result"));
    assert_eq!(actual.locks, locks(frame.get("locks")), "{context}: locks");
    let guides = array(frame, "guides");
    assert_eq!(actual.guides.len(), guides.len(), "{context}: guide count");
    for (g, e) in actual.guides.iter().zip(guides) {
        assert_eq!(
            g.axis,
            Axis::parse(text(e, "axis")).unwrap(),
            "{context}: guide axis"
        );
        assert_eq!(g.peer, text(e, "peer"), "{context}: guide peer");
        assert_eq!(g.kind.as_str(), text(e, "kind"), "{context}: guide kind");
        close(context, "guide.line", g.line, num(e, "line"));
        close(context, "guide.from", g.from, num(e, "from"));
        close(context, "guide.to", g.to, num(e, "to"));
        close(context, "guide.peerLine", g.peer_line, num(e, "peerLine"));
        close(context, "guide.gap", g.gap, num(e, "gap"));
    }
}

struct Scene {
    source: Vec<Placement>,
    surface: Surface,
    constraints: Constraints,
}
fn scenes(data: &Json) -> Vec<(String, Scene)> {
    array(data, "scenes")
        .iter()
        .map(|s| {
            (
                text(s, "name").to_owned(),
                Scene {
                    source: placements(get(s, "source")),
                    surface: surface(get(s, "surface")),
                    constraints: constraints(get(s, "constraints")),
                },
            )
        })
        .collect()
}

#[test]
fn collation_matches_locale_compare() {
    let data = fixture("layout.json");
    let expected: Vec<&str> = array(&data, "collation")
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    let mut sorted = expected.clone();
    sorted.reverse();
    sorted.sort_by(|a, b| geppio_core::js::locale_compare(a, b));
    assert_eq!(sorted, expected);
}

#[test]
fn reflow_cases_match() {
    let data = fixture("layout.json");
    let scenes = scenes(&data);
    let cases = array(&data, "reflow");
    for case in cases {
        let name = text(case, "name");
        let scene = &scenes
            .iter()
            .find(|(n, _)| n == text(case, "scene"))
            .unwrap()
            .1;
        let budget = case
            .get("budget")
            .filter(|b| **b != Json::Null)
            .map(|b| Budget {
                probes: num(b, "probes") as i64,
                states: num(b, "states") as i64,
            })
            .unwrap_or_default();
        let result = reflow(
            &placements(get(case, "source")),
            text(case, "id"),
            bounds(get(case, "rect")),
            &scene.surface,
            &scene.constraints,
            gesture(get(case, "gesture")),
            budget,
        );
        same_result(name, &result, get(case, "expected"));
    }
    assert!(cases.len() >= 10);
}

#[test]
fn alignment_scripts_match() {
    let data = fixture("layout.json");
    let scenes = scenes(&data);
    let scripts = array(&data, "scripts");
    let mut frames = 0;
    for script in scripts {
        let scene_name = text(script, "scene");
        let scene = &scenes.iter().find(|(n, _)| n == scene_name).unwrap().1;
        let id = text(script, "id");
        let kind = gesture(get(script, "kind"));
        let original = scene.source.iter().find(|p| p.id == id).unwrap();
        let mut held = AlignmentLocks::default();
        for (i, frame) in array(script, "frames").iter().enumerate() {
            let context = format!("{scene_name}/{id}/{}/frame {i}", kind.name());
            let requested = candidate(
                original,
                num(frame, "dx"),
                num(frame, "dy"),
                kind,
                &scene.surface,
                scene.constraints.get(id).unwrap(),
            )
            .unwrap();
            same_bounds(&context, requested, get(frame, "requested"));
            let aligned = aligned_gesture(
                &scene.source,
                id,
                requested,
                &scene.surface,
                &scene.constraints,
                kind,
                &held,
                Budget::default(),
            );
            same_aligned(&context, &aligned, frame);
            held = if aligned.result.status == geppio_core::layout::Status::Valid {
                aligned.locks.clone()
            } else {
                AlignmentLocks::default()
            };
            frames += 1;
        }
    }
    assert!(
        scripts.len() >= 40 && frames >= 150,
        "{} scripts, {frames} frames",
        scripts.len()
    );
}

#[test]
fn projections_match() {
    use geppio_core::freeform::project_region;
    let data = fixture("projection.json");
    let sources: Vec<(String, PerRegion<Size>, Vec<Placement>, Constraints)> =
        array(&data, "sources")
            .iter()
            .map(|s| {
                let r = get(s, "reference");
                (
                    text(s, "name").to_owned(),
                    PerRegion {
                        main: size(get(r, "main")),
                        sidebar: size(get(r, "sidebar")),
                        bottom: size(get(r, "bottom")),
                    },
                    placements(get(s, "placements")),
                    constraints(get(s, "constraints")),
                )
            })
            .collect();
    let cases = array(&data, "cases");
    for case in cases {
        let name = text(case, "name");
        let (_, reference, source, cs) = sources
            .iter()
            .find(|s| s.0 == text(case, "source"))
            .unwrap();
        let region = region(get(case, "region"));
        let available = size(get(case, "available"));
        let expanded = get(case, "expanded").as_bool().unwrap();
        let projection = project_region(source, reference, region, available, expanded, cs);
        let expected = get(case, "expected");
        assert_eq!(
            projection.feasible,
            get(expected, "feasible").as_bool().unwrap(),
            "{name}: feasible"
        );
        same_placements(name, &projection.placements, get(expected, "placements"));
        close(
            name,
            "world.width",
            projection.world.width,
            num(get(expected, "world"), "width"),
        );
        close(
            name,
            "world.height",
            projection.world.height,
            num(get(expected, "world"), "height"),
        );
        if let Some(back) = case.get("back").filter(|b| **b != Json::Null) {
            let mut moved = *reference;
            *moved.get_mut(region) = available;
            // The reference passes the projected placements as the whole source.
            let returned = project_region(
                &projection.placements,
                &moved,
                region,
                *reference.get(region),
                expanded,
                cs,
            );
            let context = format!("{name}/back");
            assert_eq!(
                returned.feasible,
                get(back, "feasible").as_bool().unwrap(),
                "{context}: feasible"
            );
            same_placements(&context, &returned.placements, get(back, "placements"));
        }
    }
    assert!(cases.len() >= 20);
}

// ---------------------------------------------------------------- workbench

use geppio_core::freeform::CodecError;
use geppio_core::workbench::{
    EditHistory, InstalledPlugin, PluginWidget, Positions, Registry, ResizePair, SessionDraft,
    UserBar, WorkbenchSnapshot, add_widget, configure_bar, delete_bar, fit_targets,
    format_signature, initial_workbench, move_view, parse_workbench, remove_presence, reorder_bar,
    resize_pair, serialize_workbench, snapshot_json, swap_views, update_bar, widget_registry,
};

fn plugins() -> Vec<InstalledPlugin> {
    let data = fixture("registry.json");
    array(&data, "plugins")
        .iter()
        .map(|p| {
            let widgets = |key: &str| {
                array(p, key)
                    .iter()
                    .map(|w| PluginWidget {
                        id: text(w, "id").to_owned(),
                        title: text(w, "title").to_owned(),
                    })
                    .collect()
            };
            InstalledPlugin {
                id: text(p, "id").to_owned(),
                name: text(p, "name").to_owned(),
                api_version: num(p, "apiVersion") as u32,
                widgets: widgets("widgets"),
                recovery_widgets: widgets("recoveryWidgets"),
            }
        })
        .collect()
}

fn registry(name: &str) -> Registry {
    let all = plugins();
    match name {
        "demo" => widget_registry(&[], true),
        "production" => widget_registry(&[], false),
        "plugins" => widget_registry(&all, true),
        "plugins-production" => widget_registry(&all, false),
        other => panic!("unknown registry {other}"),
    }
}

fn flag(v: &Json, key: &str) -> bool {
    v.get(key).and_then(Json::as_bool).unwrap_or(false)
}
fn optional<'a>(v: &'a Json, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Json::as_str)
}

#[test]
fn registries_match() {
    let data = fixture("registry.json");
    for entry in array(&data, "registries") {
        let name = text(entry, "name");
        let rust = registry(name);
        let types = array(entry, "types");
        assert_eq!(rust.types().len(), types.len(), "{name}: type count");
        for (t, e) in rust.types().iter().zip(types) {
            let context = format!("{name}/{}", t.id);
            assert_eq!(t.id, text(e, "id"), "{context}: order");
            assert_eq!(t.owner, text(e, "owner"), "{context}: owner");
            assert_eq!(t.title, text(e, "title"), "{context}: title");
            assert_eq!(t.category, text(e, "category"), "{context}: category");
            assert_eq!(
                t.description,
                text(e, "description"),
                "{context}: description"
            );
            assert_eq!(text(e, "appearance"), "card", "{context}: appearance");
            assert_eq!(
                text(e, "presence"),
                match t.presence {
                    geppio_core::workbench::Presence::SingleView => "single-view",
                    geppio_core::workbench::Presence::MultipleAreas => "multiple-areas",
                },
                "{context}: presence"
            );
            assert_eq!(
                t.constraint,
                constraint(get(e, "constraint")),
                "{context}: constraint"
            );
            assert_eq!(
                t.fixture.as_deref(),
                optional(e, "fixture"),
                "{context}: fixture"
            );
            assert_eq!(
                t.widget_id.as_deref(),
                optional(e, "widgetId"),
                "{context}: widgetId"
            );
            assert_eq!(
                t.plugin_id.as_deref(),
                optional(e, "pluginId"),
                "{context}: pluginId"
            );
            assert_eq!(t.retired, flag(e, "retired"), "{context}: retired");
            assert_eq!(t.missing, flag(e, "missing"), "{context}: missing");
            assert_eq!(
                t.preserve_normal_geometry,
                flag(e, "preserveNormalGeometry"),
                "{context}"
            );
            assert_eq!(t.maximize, flag(e, "maximize"), "{context}: maximize");
            assert_eq!(t.tab_host, flag(e, "tabHost"), "{context}: tabHost");
            assert_eq!(t.tab_member, flag(e, "tabMember"), "{context}: tabMember");
            let presentations: Option<Vec<&str>> = e.get("presentations").map(|p| {
                array(p, "main")
                    .iter()
                    .map(|v| v.as_str().unwrap())
                    .collect()
            });
            assert_eq!(
                t.presentations
                    .as_ref()
                    .map(|p| p.iter().map(|p| p.as_str()).collect::<Vec<_>>()),
                presentations,
                "{context}: presentations"
            );
        }
    }
    for item in array(&data, "initial") {
        let name = text(item, "name");
        let rust = match name {
            "demo" => initial_workbench(true),
            "production" => initial_workbench(false),
            "adopted-default" => {
                geppio_core::workbench::adopt_layout(&geppio_core::freeform::default_freeform())
            }
            other => panic!("unknown initial {other}"),
        };
        if name == "adopted-default" {
            // Known representational divergence: the reference's DEFAULT_FREEFORM literal
            // writes placement keys as {id,x,y,width,height,region,preferred}; the port always
            // writes the canonical {id,region,x,y,width,height,preferred}. Values are identical.
            assert_eq!(
                canonical(&json::parse(&snapshot_json(&rust)).unwrap()),
                canonical(&json::parse(text(item, "snapshot")).unwrap()),
                "initial {name}"
            );
            assert_ne!(
                snapshot_json(&rust),
                text(item, "snapshot"),
                "divergence still documented"
            );
        } else {
            assert_eq!(
                snapshot_json(&rust),
                text(item, "snapshot"),
                "initial {name}"
            );
        }
    }
}

/// The value with every object's keys sorted (order-insensitive comparison).
fn canonical(v: &Json) -> String {
    match v {
        Json::Object(o) => {
            let mut keys: Vec<&str> = o.keys().collect();
            keys.sort_unstable();
            let parts: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", json::quote(k), canonical(o.get(k).unwrap())))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Json::Array(items) => {
            format!(
                "[{}]",
                items.iter().map(canonical).collect::<Vec<_>>().join(",")
            )
        }
        other => other.stringify(),
    }
}

fn check_rejection(context: &str, actual: &CodecError, expected: &Json) {
    match text(expected, "errorName") {
        "SyntaxError" => assert!(
            matches!(actual, CodecError::Syntax(_)),
            "{context}: expected a syntax error, got {actual}"
        ),
        "Error" => assert_eq!(
            actual.message(),
            text(expected, "error"),
            "{context}: rejection message"
        ),
        // A TypeError in the reference: only the outcome is contractual.
        _ => {}
    }
}

#[test]
fn codec_cases_match() {
    let data = fixture("codec.json");
    let cases = array(&data, "cases");
    let (mut accepted, mut rejected) = (0, 0);
    for case in cases {
        let name = text(case, "name");
        let registry = registry(text(case, "registry"));
        let expected = get(case, "expected");
        let parsed = parse_workbench(text(case, "raw"), &registry);
        if !get(expected, "ok").as_bool().unwrap() {
            let error = parsed.expect_err(name);
            check_rejection(name, &error, expected);
            rejected += 1;
            continue;
        }
        let parsed = parsed.unwrap_or_else(|e| panic!("{name}: rejected with {e}"));
        assert_eq!(
            snapshot_json(&parsed),
            text(expected, "snapshot"),
            "{name}: parsed snapshot"
        );
        match (
            serialize_workbench(&parsed, &registry),
            get(expected, "serialized"),
        ) {
            (Ok(raw), Json::String(expected_raw)) => {
                assert_eq!(&raw, expected_raw, "{name}: serialized bytes");
                let reparsed = parse_workbench(&raw, &registry).unwrap();
                assert_eq!(
                    snapshot_json(&reparsed),
                    text(expected, "reparsed"),
                    "{name}: round trip"
                );
            }
            (Err(e), Json::Null) => {
                assert_eq!(e.message(), text(expected, "serializeError"), "{name}")
            }
            (actual, _) => panic!("{name}: serialize outcome {actual:?}"),
        }
        accepted += 1;
    }
    assert!(
        accepted >= 20 && rejected >= 60,
        "{accepted} accepted, {rejected} rejected"
    );
}

fn at(v: &Json, key: &str) -> Option<(f64, f64)> {
    v.get(key)
        .filter(|a| **a != Json::Null)
        .map(|a| (num(a, "x"), num(a, "y")))
}
fn slot(v: &Json) -> Option<Size> {
    v.get("slot").filter(|a| **a != Json::Null).map(size)
}

fn run_command(
    command: &Json,
    source: &WorkbenchSnapshot,
    registry: &Registry,
) -> Option<WorkbenchSnapshot> {
    match text(command, "kind") {
        "add" => {
            let disabled: Vec<String> = array(command, "disabled")
                .iter()
                .map(|v| v.as_str().unwrap().to_owned())
                .collect();
            add_widget(
                source,
                registry,
                text(command, "typeId"),
                &surface(get(command, "surface")),
                at(command, "at"),
                &disabled,
                slot(command),
            )
        }
        "move" => move_view(
            source,
            registry,
            text(command, "id"),
            &surface(get(command, "surface")),
            at(command, "at"),
            command.get("sourceBar").and_then(Json::as_str),
            slot(command),
            &[],
        ),
        "swap" => swap_views(source, registry, text(command, "a"), text(command, "b")),
        "remove" => Some(remove_presence(source, text(command, "id"), Some(registry))),
        "resizePair" => resize_pair(
            source,
            registry,
            &ResizePair {
                first: text(command, "first").to_owned(),
                second: text(command, "second").to_owned(),
                axis: Axis::parse(text(command, "axis")).unwrap(),
                delta: num(command, "delta"),
            },
        ),
        "fit" => {
            let r = get(command, "reference");
            let reference = PerRegion {
                main: size(get(r, "main")),
                sidebar: size(get(r, "sidebar")),
                bottom: size(get(r, "bottom")),
            };
            let scopes: Vec<Region> = array(command, "scopes").iter().map(region).collect();
            fit_targets(
                source,
                registry,
                &placements(get(command, "targets")),
                &reference,
                &scopes,
            )
        }
        "updateBar" => update_bar(source, &user_bar(get(command, "bar"))),
        "configureBar" => {
            let disabled: Vec<String> = array(command, "disabled")
                .iter()
                .map(|v| v.as_str().unwrap().to_owned())
                .collect();
            configure_bar(
                source,
                registry,
                &user_bar(get(command, "bar")),
                &surface(get(command, "surface")),
                &disabled,
            )
        }
        "deleteBar" => delete_bar(source, text(command, "id")),
        "reorderBar" => reorder_bar(source, text(command, "id"), num(command, "offset") as i64),
        other => panic!("unknown command {other}"),
    }
}

fn user_bar(v: &Json) -> UserBar {
    let mut positions = Positions::new();
    for (k, y) in get(v, "positions").as_object().unwrap().iter() {
        positions.set(k, y.as_f64().unwrap());
    }
    UserBar {
        id: text(v, "id").to_owned(),
        name: text(v, "name").to_owned(),
        user_named: flag(v, "userNamed"),
        icon: text(v, "icon").to_owned(),
        archived: flag(v, "archived"),
        members: array(v, "members")
            .iter()
            .map(|m| m.as_str().unwrap().to_owned())
            .collect(),
        positions,
    }
}

#[test]
fn commands_match() {
    let data = fixture("commands.json");
    let documents = array(&data, "documents");
    let cases = array(&data, "cases");
    let mut results = 0;
    for case in cases {
        let name = text(case, "name");
        let document = documents
            .iter()
            .find(|d| text(d, "name") == text(case, "document"))
            .unwrap();
        let registry = registry(text(document, "registry"));
        let source = parse_workbench(text(document, "raw"), &registry).unwrap();
        let before = snapshot_json(&source);
        let result = run_command(get(case, "command"), &source, &registry);
        assert_eq!(snapshot_json(&source), before, "{name}: source mutated");
        match (result, get(case, "expected")) {
            (Some(next), Json::String(expected)) => {
                assert_eq!(&snapshot_json(&next), expected, "{name}: result snapshot");
                results += 1;
            }
            (None, Json::Null) => {}
            (actual, _) => panic!(
                "{name}: outcome differs (rust {})",
                actual.map_or("null".into(), |s| snapshot_json(&s))
            ),
        }
    }
    assert!(
        cases.len() >= 40 && results >= 30,
        "{} cases, {results} results",
        cases.len()
    );
}

fn fnv1a(text: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for unit in text.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

#[test]
fn history_matches() {
    let data = fixture("history.json");
    let start = initial_workbench(true);
    assert_eq!(snapshot_json(&start), text(&data, "start"));
    let mut history = EditHistory::new();
    let mut current = SessionDraft::new(start);
    let set = |draft: &SessionDraft, id: &str, x: f64| {
        let mut next = draft.clone();
        next.snapshot
            .placements
            .iter_mut()
            .find(|p| p.id == id)
            .unwrap()
            .x = x;
        next
    };
    let observations = array(&data, "observations");
    for (index, o) in observations.iter().enumerate() {
        let step = get(o, "step");
        let mut returned = None;
        match text(step, "op") {
            "record" => {
                let after = set(&current, text(step, "id"), num(step, "x"));
                history.record(&current, &after);
                current = after;
            }
            "record-same" => history.record(&current, &current.clone()),
            "gesture-set" => current = set(&current, text(step, "id"), num(step, "x")),
            "undo" | "redo" | "abort" => {
                let r = match text(step, "op") {
                    "undo" => history.undo(&current),
                    "redo" => history.redo(&current),
                    _ => history.abort(),
                };
                returned = Some(r.is_some());
                if let Some(r) = r {
                    current = r;
                }
            }
            "begin" => history.begin(&current),
            "finish" => history.finish(&current),
            "clear" => history.clear(),
            other => panic!("unknown step {other}"),
        }
        let context = format!("step {index} ({})", text(step, "op"));
        assert_eq!(
            returned,
            get(o, "returned").as_bool(),
            "{context}: returned"
        );
        assert_eq!(history.can_undo(), flag(o, "canUndo"), "{context}: canUndo");
        assert_eq!(history.can_redo(), flag(o, "canRedo"), "{context}: canRedo");
        assert_eq!(history.active(), flag(o, "active"), "{context}: active");
        let xs: Vec<f64> = array(o, "xs").iter().map(|v| v.as_f64().unwrap()).collect();
        let actual: Vec<f64> = current.snapshot.placements.iter().map(|p| p.x).collect();
        assert_eq!(actual, xs, "{context}: xs");
        let signature = format_signature(&current.snapshot, &current.slots);
        assert_eq!(fnv1a(&signature), text(o, "digest"), "{context}: digest");
        if let Some(expected) = o.get("signature").and_then(Json::as_str) {
            assert_eq!(signature, expected, "{context}: signature");
        }
    }
    assert!(observations.len() >= 590);
    assert_eq!(history.undo_len(), 0);
    for item in array(&data, "signatures") {
        let snapshot = match item.get("document").and_then(Json::as_str) {
            Some(raw) => parse_workbench(raw, &registry(text(item, "registry"))).unwrap(),
            None => initial_workbench(true),
        };
        assert_eq!(
            format_signature(&snapshot, &[]),
            text(item, "signature"),
            "{}",
            text(item, "name")
        );
    }
}

// ---------------------------------------------------------------- edit session

use geppio_core::workbench::{EditSession, MemoryStore, PointerFrame, Preview, SessionSurfaces};

fn session_surfaces(v: &Json) -> SessionSurfaces {
    let sizes = get(v, "sizes");
    SessionSurfaces {
        sizes: PerRegion {
            main: size(get(sizes, "main")),
            sidebar: size(get(sizes, "sidebar")),
            bottom: size(get(sizes, "bottom")),
        },
        expanded: get(v, "expanded").as_bool().unwrap(),
    }
}

fn same_preview(context: &str, preview: &Preview, expected: &Json) {
    assert_eq!(
        preview.status.as_str(),
        text(expected, "status"),
        "{context}: status"
    );
    assert_eq!(
        preview.reason.map(|r| r.as_str()),
        expected.get("reason").and_then(Json::as_str),
        "{context}: reason"
    );
    assert_eq!(
        preview.states as f64,
        num(expected, "states"),
        "{context}: states"
    );
    assert_eq!(
        preview.probes as f64,
        num(expected, "probes"),
        "{context}: probes"
    );
    same_placements(context, &preview.placements, get(expected, "placements"));
    assert_eq!(
        preview.locks,
        locks(expected.get("locks")),
        "{context}: locks"
    );
    let zones: Vec<&str> = array(expected, "zones")
        .iter()
        .map(|z| z.as_str().unwrap())
        .collect();
    assert_eq!(
        preview
            .drop_zones
            .iter()
            .map(|r| r.as_str())
            .collect::<Vec<_>>(),
        zones,
        "{context}: drop zones"
    );
    let guides = array(expected, "guides");
    assert_eq!(preview.guides.len(), guides.len(), "{context}: guide count");
    for (g, e) in preview.guides.iter().zip(guides) {
        assert_eq!(g.peer, text(e, "peer"), "{context}: guide peer");
        close(context, "guide.line", g.line, num(e, "line"));
        close(context, "guide.from", g.from, num(e, "from"));
        close(context, "guide.to", g.to, num(e, "to"));
    }
}

#[test]
fn session_scripts_match() {
    let data = fixture("session.json");
    let scripts = array(&data, "scripts");
    let mut steps = 0;
    for script in scripts {
        let name = text(script, "name");
        let registry = registry(text(script, "registry"));
        let stored = script.get("stored").and_then(Json::as_str);
        let mut store = MemoryStore {
            raw: stored.map(str::to_owned),
        };
        let mut session =
            EditSession::open(registry, stored, get(script, "demo").as_bool().unwrap());
        let start = get(script, "start");
        assert_eq!(
            session.message(),
            text(start, "message"),
            "{name}: open message"
        );
        assert_eq!(
            snapshot_json(session.draft()),
            text(start, "draft"),
            "{name}: open draft"
        );
        assert_eq!(
            session.recovery(),
            flag(start, "recovery"),
            "{name}: recovery"
        );
        let mut surfaces = session_surfaces(get(script, "surfaces"));
        for o in array(script, "observations") {
            let step = get(o, "step");
            let op = text(step, "op");
            let context = format!("{name}/{} {op}", num(o, "index"));
            let expected = get(o, "result");
            match op {
                "begin" => assert_eq!(
                    Json::Bool(session.begin(&surfaces).is_ok()),
                    *expected,
                    "{context}"
                ),
                "pickup" => {
                    let kind = gesture(get(step, "kind"));
                    match (session.pickup(text(step, "id"), kind, &surfaces), expected) {
                        (Ok(zones), Json::Array(e)) => assert_eq!(
                            zones.iter().map(|r| r.as_str()).collect::<Vec<_>>(),
                            e.iter().map(|z| z.as_str().unwrap()).collect::<Vec<_>>(),
                            "{context}: zones"
                        ),
                        (Err(_), Json::Null) => {}
                        (actual, _) => panic!("{context}: pickup outcome {actual:?}"),
                    }
                }
                "frame" => {
                    let frame = PointerFrame {
                        dx: num(step, "dx"),
                        dy: num(step, "dy"),
                        over_origin: get(step, "over").as_bool().unwrap(),
                    };
                    match (session.preview(frame, &surfaces), expected) {
                        (Ok(preview), Json::Object(_)) => {
                            same_preview(&context, &preview, expected)
                        }
                        (Err(_), Json::Null) => {}
                        (actual, _) => panic!("{context}: frame outcome {actual:?}"),
                    }
                }
                "commit" => assert_eq!(
                    Json::Bool(session.commit_gesture().is_ok()),
                    *expected,
                    "{context}"
                ),
                "cancelGesture" => {
                    assert_eq!(
                        Json::Bool(session.cancel_gesture().is_ok()),
                        *expected,
                        "{context}"
                    )
                }
                "drop" => {
                    let region = region(get(step, "region"));
                    let at = (num(step, "x"), num(step, "y"));
                    assert_eq!(
                        Json::Bool(session.drop_into(region, at, &surfaces).is_ok()),
                        *expected,
                        "{context}"
                    );
                }
                "undo" => assert_eq!(Json::Bool(session.undo()), *expected, "{context}"),
                "redo" => assert_eq!(Json::Bool(session.redo()), *expected, "{context}"),
                "add" => {
                    let at = step.get("x").map(|_| (num(step, "x"), num(step, "y")));
                    let added = session.add_widget(
                        text(step, "typeId"),
                        region(get(step, "region")),
                        at,
                        &surfaces,
                        &[],
                    );
                    assert_eq!(Json::Bool(added.is_ok()), *expected, "{context}");
                }
                "save" => assert_eq!(
                    Json::Bool(session.save(&surfaces, &mut store).is_ok()),
                    *expected,
                    "{context}"
                ),
                "conclude" => {
                    assert_eq!(
                        Json::Bool(session.conclude(&surfaces, &mut store).is_ok()),
                        *expected,
                        "{context}"
                    )
                }
                "cancel" => session.cancel(),
                "external" => {
                    let raw = store.raw.take().unwrap_or_default();
                    store.raw = Some(raw + " ");
                }
                "surfaces" => {
                    surfaces = SessionSurfaces {
                        sizes: PerRegion {
                            main: size(get(step, "main")),
                            sidebar: size(get(step, "sidebar")),
                            bottom: size(get(step, "bottom")),
                        },
                        expanded: get(step, "expanded").as_bool().unwrap(),
                    }
                }
                other => panic!("unknown op {other}"),
            }
            assert_eq!(session.editing(), flag(o, "editing"), "{context}: editing");
            assert_eq!(
                session.recovery(),
                flag(o, "recovery"),
                "{context}: recovery"
            );
            assert_eq!(session.can_undo(), flag(o, "canUndo"), "{context}: canUndo");
            assert_eq!(session.can_redo(), flag(o, "canRedo"), "{context}: canRedo");
            assert_eq!(
                session.gesture_active(),
                flag(o, "gesture"),
                "{context}: gesture"
            );
            assert_eq!(
                session.has_pending(),
                flag(o, "pending"),
                "{context}: pending"
            );
            assert_eq!(session.message(), text(o, "message"), "{context}: message");
            let draft = snapshot_json(session.draft());
            if let Some(expected) = o.get("draft").and_then(Json::as_str) {
                assert_eq!(draft, expected, "{context}: draft");
            }
            assert_eq!(
                fnv1a(&draft),
                text(o, "draftDigest"),
                "{context}: draft digest"
            );
            assert_eq!(
                fnv1a(&snapshot_json(session.committed())),
                text(o, "committed"),
                "{context}: committed"
            );
            assert_eq!(
                fnv1a(&snapshot_json(session.checkpoint())),
                text(o, "checkpoint"),
                "{context}: checkpoint"
            );
            let raw = store.raw.clone().unwrap_or_default();
            if let Some(expected) = o.get("stored").and_then(Json::as_str) {
                assert_eq!(raw, expected, "{context}: stored bytes");
            }
            assert_eq!(
                fnv1a(&raw),
                text(o, "storedDigest"),
                "{context}: stored digest"
            );
            steps += 1;
        }
    }
    assert!(scripts.len() >= 4 && steps >= 80, "{steps} steps");
}

#[test]
fn remove_view_is_one_undoable_intention() {
    use geppio_core::layout::{PerRegion, Size};
    use geppio_core::workbench::{EditSession, SessionSurfaces, widget_registry};
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    let surfaces = SessionSurfaces {
        sizes: PerRegion {
            main: Size::new(927.0, 494.0),
            sidebar: Size::new(253.0, 661.0),
            bottom: Size::new(903.0, 147.0),
        },
        expanded: false,
    };
    assert!(
        session.remove_view("summary").is_err(),
        "needs an edit session"
    );
    session.begin(&surfaces).unwrap();
    let id = session.draft().placements[0].id.clone();
    let count = session.draft().placements.len();
    session.remove_view(&id).unwrap();
    assert_eq!(session.draft().placements.len(), count - 1);
    assert!(session.can_undo());
    assert!(session.undo());
    assert_eq!(session.draft().placements.len(), count);
    assert!(session.remove_view("missing").is_err());
}

#[test]
fn catalog_moves_and_drags_are_whole_intentions() {
    use geppio_core::layout::Region;
    use geppio_core::workbench::{EditSession, widget_registry};
    let surfaces = test_surfaces();
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    // The move mode needs Edit (`transferTo`).
    let first = session.draft().placements[0].id.clone();
    assert!(
        session
            .transfer_view(&first, Region::Main, None, &surfaces)
            .is_err()
    );
    assert_eq!(
        session.message(),
        "Região sem espaço disponível. Reabra ou amplie a região antes de transferir."
    );
    session.begin(&surfaces).unwrap();
    // Every refusal names the region; an accepted move is one undoable intention.
    let mut accepted = 0;
    for p in session.draft().placements.clone() {
        for region in Region::ALL.into_iter().filter(|r| *r != p.region) {
            let mut trial = session.clone();
            let label = geppio_core::freeform::region_label(region);
            match trial.transfer_view(&p.id, region, None, &surfaces) {
                Ok(()) => {
                    accepted += 1;
                    assert_eq!(
                        trial.message(),
                        format!("Widget transferido para {label} na prévia. Salve ou cancele.")
                    );
                    assert_eq!(trial.draft().placement(&p.id).unwrap().region, region);
                    assert!(trial.undo());
                    assert_eq!(trial.draft().placement(&p.id).unwrap().region, p.region);
                }
                Err(_) => assert!(
                    trial
                        .message()
                        .starts_with(&format!("Transferência para {label}"))
                        || trial.message().starts_with("Região sem espaço"),
                    "{}",
                    trial.message()
                ),
            }
        }
    }
    assert!(accepted > 0, "some demo widget can move to another region");
    // A catalog drag opens one history gesture: an accepted drop is one intention, a
    // refused one restores the draft.
    let registry = session.registry().clone();
    let (type_id, region) = registry
        .types()
        .iter()
        .flat_map(|t| Region::ALL.map(|r| (t.id.clone(), r)))
        .find(|(t, r)| {
            session
                .clone()
                .add_widget(t, *r, None, &surfaces, &[])
                .is_ok()
        })
        .expect("a widget that fits");
    let before = session.draft().clone();
    let undo_before = session.can_undo();
    session.begin_catalog_drag();
    session
        .add_widget(&type_id, region, None, &surfaces, &[])
        .unwrap();
    session.finish_catalog_drag(false);
    assert_eq!(session.draft(), &before);
    assert_eq!(session.can_undo(), undo_before);
    session.begin_catalog_drag();
    session
        .add_widget(&type_id, region, None, &surfaces, &[])
        .unwrap();
    session.finish_catalog_drag(true);
    assert_ne!(session.draft(), &before);
    assert!(session.undo());
    assert_eq!(session.draft(), &before);
    // Hovering a bar switches only during a drag, and only to another active bar.
    let active = session.draft().organization.active_bar.clone();
    assert!(!session.hover_bar("bar:missing"));
    session.begin_catalog_drag();
    assert!(!session.hover_bar(&active));
    assert!(!session.hover_bar("bar:missing"));
    session.finish_catalog_drag(false);
}

#[test]
fn unreadable_store_opens_in_recovery_and_never_edits() {
    use geppio_core::layout::{PerRegion, Size};
    use geppio_core::workbench::{EditSession, SessionError, SessionSurfaces, widget_registry};
    let surfaces = SessionSurfaces {
        sizes: PerRegion {
            main: Size::new(927.0, 494.0),
            sidebar: Size::new(253.0, 661.0),
            bottom: Size::new(903.0, 147.0),
        },
        expanded: false,
    };
    let mut session = EditSession::open_unreadable(widget_registry(&[], true));
    assert!(session.recovery());
    assert_eq!(session.stored(), None);
    assert!(matches!(
        session.begin(&surfaces),
        Err(SessionError::Recovery)
    ));
    session.cancel();
    assert!(session.recovery(), "cancel keeps recovery");
    assert!(matches!(
        session.begin(&surfaces),
        Err(SessionError::Recovery)
    ));
}

#[test]
fn more_placements_than_widgets_are_rejected_before_seed_parsing() {
    use geppio_core::workbench::{
        initial_workbench, parse_workbench, serialize_workbench, widget_registry,
    };
    let registry = widget_registry(&[], true);
    let raw = serialize_workbench(&initial_workbench(true), &registry).unwrap();
    assert!(parse_workbench(&raw, &registry).is_ok());
    let root = json::parse(&raw).unwrap();
    let root = root.as_object().unwrap();
    let layout = root.get("layout").and_then(Json::as_object).unwrap();
    let first = layout.get("placements").and_then(Json::as_array).unwrap()[0].clone();
    let layout = layout
        .clone()
        .with("placements", Json::Array(vec![first; 17]));
    let hostile = Json::Object(root.clone().with("layout", Json::Object(layout))).stringify();
    assert!(parse_workbench(&hostile, &registry).is_err());
}

fn test_surfaces() -> geppio_core::workbench::SessionSurfaces {
    use geppio_core::layout::{PerRegion, Size};
    geppio_core::workbench::SessionSurfaces {
        sizes: PerRegion {
            main: Size::new(927.0, 494.0),
            sidebar: Size::new(253.0, 661.0),
            bottom: Size::new(903.0, 147.0),
        },
        expanded: false,
    }
}

#[test]
fn bars_commit_outside_edit_and_record_inside_it() {
    use geppio_core::workbench::{EditSession, HOME, UserBar, update_bar, widget_registry};
    let mut store = MemoryStore::default();
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    let surfaces = test_surfaces();
    // Create a bar from the form: saved at once, active, persisted.
    let bar = UserBar {
        id: "bar:test".into(),
        name: "Foco".into(),
        user_named: true,
        icon: "widgets".into(),
        archived: false,
        members: Vec::new(),
        positions: Default::default(),
    };
    session.save_bar(&bar, &surfaces, &[], &mut store).unwrap();
    assert_eq!(session.message(), "Barra salva.");
    assert!(session.stored().is_some_and(|raw| raw.contains("bar:test")));
    // Activate Home again outside Edit: a committed organization change.
    let mut next = session.draft().clone();
    next.organization.active_bar = HOME.into();
    session.commit_organization(next, &mut store).unwrap();
    assert_eq!(session.message(), "Preferência salva.");
    assert_eq!(session.committed().organization.active_bar, HOME);
    // Inside Edit the form applies to the draft as one undoable intention (`App.saveBar`):
    // nothing is stored until Save, undo removes it and redo brings it back.
    session.begin(&surfaces).unwrap();
    let stored = session.stored().map(str::to_owned);
    let fresh = UserBar {
        id: "bar:edit".into(),
        name: "Em edição".into(),
        ..bar.clone()
    };
    session
        .save_bar(&fresh, &surfaces, &[], &mut store)
        .unwrap();
    let has = |s: &EditSession| {
        s.draft()
            .organization
            .bars
            .iter()
            .any(|b| b.id == "bar:edit")
    };
    assert!(has(&session));
    assert_eq!(session.draft().organization.active_bar, "bar:edit");
    assert_eq!(session.stored().map(str::to_owned), stored);
    assert!(session.undo());
    assert!(!has(&session));
    assert!(session.redo());
    assert!(has(&session));
    session.save(&surfaces, &mut store).unwrap();
    assert!(session.stored().is_some_and(|raw| raw.contains("bar:edit")));
    let archived = update_bar(
        session.draft(),
        &UserBar {
            archived: true,
            ..bar.clone()
        },
    )
    .unwrap();
    session.commit_organization(archived, &mut store).unwrap();
    assert!(session.can_undo());
    assert!(session.undo());
    assert!(
        !session
            .draft()
            .organization
            .bars
            .iter()
            .any(|b| b.id == "bar:test" && b.archived)
    );
}

#[test]
fn recovery_blocks_bars_until_a_settings_preview_is_saved() {
    use geppio_core::workbench::{EditSession, SessionError, WorkbenchStore, widget_registry};
    let mut store = MemoryStore::default();
    let mut session = EditSession::open(widget_registry(&[], true), Some("{not json"), true);
    assert!(session.recovery());
    let mut next = session.draft().clone();
    next.organization.active_bar = "missing".into();
    assert!(matches!(
        session.commit_organization(next, &mut store),
        Err(SessionError::Recovery)
    ));
    // "Prévia da composição inicial" opens Edit without touching the stored bytes…
    session.reset_preview(true);
    assert!(session.editing() && session.recovery());
    assert_eq!(session.stored(), Some("{not json"));
    // …Cancel keeps recovery, and Save adopts the preview and leaves it.
    session.cancel();
    assert!(session.recovery());
    session.reset_preview(true);
    let surfaces = test_surfaces();
    // The stored bytes are the corrupt ones the session observed, so the save goes through.
    store.set("{not json").unwrap();
    session.conclude(&surfaces, &mut store).unwrap();
    assert!(!session.recovery() && !session.editing());
}

#[test]
fn layout_import_previews_envelopes_and_refuses_other_files() {
    use geppio_core::workbench::{
        EditSession, initial_workbench, serialize_workbench, widget_registry,
    };
    let registry = widget_registry(&[], true);
    let raw = serialize_workbench(&initial_workbench(true), &registry).unwrap();
    let mut session = EditSession::open(registry, None, true);
    assert!(!session.import_preview("plain text"));
    assert_eq!(
        session.message(),
        "Arquivo incompatível. Dados anteriores preservados."
    );
    assert!(!session.import_preview(&" ".repeat(64 * 1024 + 1)));
    assert_eq!(session.message(), "A composição deve ter até 64 KiB.");
    assert!(session.import_preview(&raw));
    assert!(session.editing());
    assert_eq!(
        session.message(),
        "Composição importada na prévia. Salvar adota sem alterar originais."
    );
    // A second import is refused while the preview is open.
    assert!(!session.import_preview(&raw));
}

#[test]
fn bar_and_organization_guards_hold() {
    use geppio_core::workbench::{EditSession, SessionError, UserBar, widget_registry};
    let surfaces = test_surfaces();
    let bar = UserBar {
        id: "bar:guard".into(),
        name: "Guarda".into(),
        user_named: true,
        icon: "widgets".into(),
        archived: false,
        members: Vec::new(),
        positions: Default::default(),
    };
    // In recovery the form is refused and nothing is written.
    let mut store = MemoryStore {
        raw: Some("{broken".into()),
    };
    let mut recovering = EditSession::open(widget_registry(&[], true), Some("{broken"), true);
    assert!(
        recovering
            .save_bar(&bar, &surfaces, &[], &mut store)
            .is_err()
    );
    assert_eq!(store.raw.as_deref(), Some("{broken"));
    // An import preview in recovery is cancelled without touching the stored bytes.
    let raw = geppio_core::workbench::serialize_workbench(
        &geppio_core::workbench::initial_workbench(true),
        recovering.registry(),
    )
    .unwrap();
    assert!(recovering.import_preview(&raw));
    recovering.cancel();
    assert!(recovering.recovery());
    assert_eq!(store.raw.as_deref(), Some("{broken"));
    // Outside Edit an organization change that moves placements is refused.
    let mut store = MemoryStore::default();
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    let mut moved = session.draft().clone();
    moved.placements[0].x += 10.0;
    assert!(matches!(
        session.commit_organization(moved, &mut store),
        Err(SessionError::Rejected)
    ));
    assert!(store.raw.is_none());
}

#[test]
fn region_chrome_follows_the_document() {
    use geppio_core::workbench::chrome::default_chrome;
    use geppio_core::workbench::{EditSession, SessionError, widget_registry};
    let surfaces = test_surfaces();
    // Outside Edit a chrome change is committed to the stored document.
    let mut store = MemoryStore::default();
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    let mut next = session.draft().clone();
    next.organization.chrome.sidebar.size = 238.0;
    next.organization.chrome.bottom.visible = false;
    session.commit_organization(next, &mut store).unwrap();
    assert_eq!(session.message(), "Preferência salva.");
    assert_eq!(session.committed().organization.chrome.sidebar.size, 238.0);
    let stored = store.raw.clone().expect("written");
    assert!(stored.contains("238"), "{stored}");
    // Reopening the stored bytes keeps the regions.
    let reopened = EditSession::open(widget_registry(&[], true), Some(&stored), true);
    assert_eq!(reopened.committed().organization.chrome.sidebar.size, 238.0);
    assert!(!reopened.committed().organization.chrome.bottom.visible);
    // Inside Edit it is one more undoable intention and Cancel restores the checkpoint.
    session.begin(&surfaces).unwrap();
    let mut wider = session.draft().clone();
    wider.organization.chrome.sidebar.size = 300.0;
    session.commit_organization(wider, &mut store).unwrap();
    assert_eq!(session.draft().organization.chrome.sidebar.size, 300.0);
    assert_eq!(
        store.raw.as_deref(),
        Some(stored.as_str()),
        "not written in Edit"
    );
    assert!(session.undo());
    assert_eq!(session.draft().organization.chrome.sidebar.size, 238.0);
    assert!(session.redo());
    session.cancel();
    assert_eq!(session.draft().organization.chrome.sidebar.size, 238.0);
    // In recovery the change is refused and the stored bytes stay.
    let mut broken = MemoryStore {
        raw: Some("{broken".into()),
    };
    let mut recovering = EditSession::open(widget_registry(&[], true), Some("{broken"), true);
    let mut next = recovering.draft().clone();
    next.organization.chrome.sidebar.size = 238.0;
    assert!(matches!(
        recovering.commit_organization(next, &mut broken),
        Err(SessionError::Recovery)
    ));
    assert_eq!(broken.raw.as_deref(), Some("{broken"));
    assert_eq!(recovering.draft().organization.chrome, default_chrome());
}

#[test]
fn legacy_region_preferences_are_adopted_once() {
    use geppio_core::workbench::chrome::default_chrome;
    use geppio_core::workbench::{
        ChromeAdoption, EditSession, initial_workbench, serialize_workbench, widget_registry,
    };
    let mut legacy = default_chrome();
    legacy.sidebar.size = 250.0;
    legacy.sidebar.visible = false;
    let shows_legacy = |s: &EditSession| {
        [s.committed(), s.draft(), s.checkpoint()].iter().all(|d| {
            let c = d.organization.chrome;
            !c.sidebar.visible && c.sidebar.size == 250.0 && c.bottom.size == 167.0
        })
    };
    // No document yet: the old values are adopted and written at once, quietly.
    let mut store = MemoryStore::default();
    let mut fresh = EditSession::open(widget_registry(&[], true), None, true);
    let message = fresh.message().to_owned();
    assert_eq!(
        fresh.adopt_initial_chrome(legacy, &mut store),
        ChromeAdoption::Adopted
    );
    assert!(shows_legacy(&fresh));
    assert_eq!(fresh.message(), message);
    let written = store.raw.clone().expect("written");
    let reopened = EditSession::open(widget_registry(&[], true), Some(&written), true);
    assert!(shows_legacy(&reopened));
    // A stored document that still shows the default regions adopts them too (its chrome
    // differs from `default_chrome` only in key order).
    let registry = widget_registry(&[], true);
    let stored = serialize_workbench(&initial_workbench(true), &registry).unwrap();
    let mut store = MemoryStore {
        raw: Some(stored.clone()),
    };
    let mut older = EditSession::open(registry, Some(&stored), true);
    assert_eq!(
        older.adopt_initial_chrome(legacy, &mut store),
        ChromeAdoption::Adopted
    );
    assert!(shows_legacy(&older));
    assert_ne!(store.raw.as_deref(), Some(stored.as_str()));
    // A document with its own regions keeps them; nothing is written.
    let mut store = MemoryStore::default();
    let mut owned = EditSession::open(widget_registry(&[], true), None, true);
    let mut next = owned.draft().clone();
    next.organization.chrome.bottom.size = 200.0;
    owned.commit_organization(next, &mut store).unwrap();
    let raw = store.raw.clone().unwrap();
    let mut reopened = EditSession::open(widget_registry(&[], true), Some(&raw), true);
    assert_eq!(
        reopened.adopt_initial_chrome(legacy, &mut store),
        ChromeAdoption::Kept
    );
    assert_eq!(reopened.committed().organization.chrome.bottom.size, 200.0);
    assert_eq!(store.raw.as_deref(), Some(raw.as_str()));
    // Default values have nothing to adopt.
    let mut plain = EditSession::open(widget_registry(&[], true), None, true);
    let mut empty = MemoryStore::default();
    assert_eq!(
        plain.adopt_initial_chrome(default_chrome(), &mut empty),
        ChromeAdoption::Kept
    );
    assert!(empty.raw.is_none());
    // Recovery defers and keeps the stored bytes.
    let mut broken = MemoryStore {
        raw: Some("{broken".into()),
    };
    let mut recovering = EditSession::open(widget_registry(&[], true), Some("{broken"), true);
    assert_eq!(
        recovering.adopt_initial_chrome(legacy, &mut broken),
        ChromeAdoption::Deferred
    );
    assert_eq!(broken.raw.as_deref(), Some("{broken"));
}

#[test]
fn local_state_is_part_of_the_edit_draft() {
    use geppio_core::workbench::{EditSession, widget_registry};
    let surfaces = test_surfaces();
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    assert_eq!(session.local(), None);
    // Outside Edit it is applied as is, with no history.
    session.change_local("{\"theme\":\"dark\"}".into());
    assert_eq!(session.local(), Some("{\"theme\":\"dark\"}"));
    assert!(!session.can_undo());
    // Inside Edit each change is an intention; undo, redo and Cancel restore it.
    session.begin(&surfaces).unwrap();
    session.change_local("{\"theme\":\"light\"}".into());
    assert!(session.can_undo());
    assert!(session.undo());
    assert_eq!(session.local(), Some("{\"theme\":\"dark\"}"));
    assert!(session.redo());
    assert_eq!(session.local(), Some("{\"theme\":\"light\"}"));
    session.cancel();
    assert_eq!(session.local(), Some("{\"theme\":\"dark\"}"));
    // A saved checkpoint keeps the local state it confirmed.
    let mut store = MemoryStore::default();
    session.begin(&surfaces).unwrap();
    session.change_local("{\"theme\":\"light\"}".into());
    session.save(&surfaces, &mut store).unwrap();
    session.cancel();
    assert_eq!(session.local(), Some("{\"theme\":\"light\"}"));
}

mod compositions {
    use super::*;
    use geppio_core::workbench::chrome::ChromePatchEntry;
    use geppio_core::workbench::compositions::{
        ApplyMode, SlotIntention, apply_composition, apply_to_draft, capture_composition,
        capture_current_composition, composition_order, composition_scene, composition_slots,
        favorite_composition, fill_reservation, reorder_composition, system_compositions,
    };
    use geppio_core::workbench::portable::{parse_portable_text, serialize_portable_layout};
    use geppio_core::workbench::portable_compositions::{
        export_portable_composition, import_portable_composition, portable_dependencies,
        resolve_portable_widgets,
    };
    use geppio_core::workbench::session::project_view;
    use geppio_core::workbench::{
        ChromePatch, Composition, CompositionMode, SessionDraft, SessionSlot,
    };

    /// One `applyLocal` / `reserve` observation of a library script.
    fn same_draft(context: &str, actual: &SessionDraft, expected: &Json) {
        same_json(
            context,
            &snapshot_json(&actual.snapshot),
            text(expected, "snapshot"),
        );
        same_slots(context, &actual.slots, get(expected, "slots"));
        assert_eq!(
            actual.format_id.as_deref(),
            optional(expected, "formatId"),
            "{context}: formatId"
        );
        assert_eq!(
            actual.format_mode.map(|m| m.as_str()),
            optional(expected, "formatMode"),
            "{context}: formatMode"
        );
        match (&actual.format_source, get(expected, "formatSource")) {
            (None, Json::Null) => {}
            (Some(source), Json::String(raw)) => {
                let e = json::parse(raw).unwrap();
                same_placements(context, &source.placements, get(&e, "placements"));
                let r = get(&e, "reference");
                for region in Region::ALL {
                    let want = size(get(r, region.as_str()));
                    let have = source.reference.get(region);
                    close(context, "formatSource.width", have.width, want.width);
                    close(context, "formatSource.height", have.height, want.height);
                }
            }
            (actual, _) => panic!("{context}: formatSource differs (rust {actual:?})"),
        }
    }

    /// `{ ok, value }` / `{ ok: false, error }` outcomes of a throwing reference call.
    fn same_outcome(
        context: &str,
        actual: Result<String, CodecError>,
        expected: &Json,
        value: impl Fn(&str, &str),
    ) -> bool {
        match (actual, flag(expected, "ok")) {
            (Ok(actual), true) => {
                value(&actual, text(expected, "value"));
                true
            }
            (Err(error), false) => {
                assert_eq!(error.message(), text(expected, "error"), "{context}: error");
                false
            }
            (actual, _) => panic!("{context}: outcome differs (rust {actual:?})"),
        }
    }
    fn strings_of(v: &Json) -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_owned())
            .collect()
    }

    /// `JSON.stringify` of compositions, read back through the snapshot writer.
    fn compositions_json(list: Vec<Composition>) -> String {
        let mut holder = initial_workbench(false);
        holder.organization.compositions = list;
        let parsed = json::parse(&snapshot_json(&holder)).unwrap();
        canonical(get(get(&parsed, "organization"), "compositions"))
    }
    fn same_json(context: &str, actual: &str, expected: &str) {
        let actual = canonical(&json::parse(actual).unwrap());
        let expected = canonical(&json::parse(expected).unwrap());
        assert_eq!(actual, expected, "{context}");
    }
    fn lookup(source: &WorkbenchSnapshot, id: &str, demo: bool) -> Composition {
        system_compositions(demo)
            .into_iter()
            .chain(source.organization.compositions.iter().cloned())
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("composition {id}"))
    }
    fn mode(v: &Json) -> ApplyMode {
        match v.as_str().unwrap() {
            "format" => ApplyMode::Format,
            "widgets" => ApplyMode::Widgets,
            other => panic!("mode {other}"),
        }
    }
    fn scopes(v: &Json) -> Vec<Region> {
        v.as_array().unwrap().iter().map(region).collect()
    }
    fn session_slot(v: &Json) -> SessionSlot {
        SessionSlot {
            id: text(v, "id").to_owned(),
            region: region(get(v, "region")),
            x: num(v, "x"),
            y: num(v, "y"),
            width: num(v, "width"),
            height: num(v, "height"),
            sidebar_bar: optional(v, "sidebarBar").map(str::to_owned),
            reference: size(get(v, "reference")),
        }
    }
    fn slots(v: &Json) -> Vec<SessionSlot> {
        v.as_array().unwrap().iter().map(session_slot).collect()
    }
    fn entry(v: Option<&Json>) -> Option<ChromePatchEntry> {
        v.map(|e| ChromePatchEntry {
            size: e.get("size").and_then(Json::as_f64),
            visible: e.get("visible").and_then(Json::as_bool),
        })
    }
    fn chrome(v: &Json) -> Option<ChromePatch> {
        (*v != Json::Null).then(|| ChromePatch {
            sidebar: entry(v.get("sidebar")),
            bottom: entry(v.get("bottom")),
        })
    }
    fn same_slots(context: &str, actual: &[SessionSlot], expected: &Json) {
        let expected = expected.as_array().unwrap();
        assert_eq!(actual.len(), expected.len(), "{context}: slot count");
        for (a, e) in actual.iter().zip(expected) {
            assert_eq!(a.id, text(e, "id"), "{context}");
            assert_eq!(a.region, region(get(e, "region")), "{context}: {}", a.id);
            assert_eq!(
                a.sidebar_bar.as_deref(),
                optional(e, "sidebarBar"),
                "{context}: {}",
                a.id
            );
            same_bounds(
                &format!("{context}: {}", a.id),
                Bounds::new(a.x, a.y, a.width, a.height),
                e,
            );
            let r = get(e, "reference");
            close(
                context,
                "reference.width",
                a.reference.width,
                num(r, "width"),
            );
            close(
                context,
                "reference.height",
                a.reference.height,
                num(r, "height"),
            );
        }
    }
    fn outcome(context: &str, actual: Option<WorkbenchSnapshot>, expected: &Json) -> bool {
        match (actual, expected) {
            (Some(next), Json::String(expected)) => {
                same_json(context, &snapshot_json(&next), expected);
                true
            }
            (None, Json::Null) => false,
            (actual, _) => panic!(
                "{context}: outcome differs (rust {})",
                actual.map_or("null".into(), |s| snapshot_json(&s))
            ),
        }
    }

    #[test]
    fn compositions_match() {
        let data = fixture("compositions.json");
        let documents = array(&data, "documents");
        let load = |name: &str| {
            let document = documents
                .iter()
                .find(|d| text(d, "name") == name)
                .unwrap_or_else(|| panic!("document {name}"));
            let registry = registry(text(document, "registry"));
            let source = parse_workbench(text(document, "raw"), &registry).unwrap();
            (registry, source)
        };
        let cases = array(&data, "cases");
        let mut results = 0;
        for case in cases {
            let name = text(case, "name");
            let expected = case.get("expected").unwrap_or(&Json::Null);
            match text(case, "kind") {
                "system" => {
                    let actual = compositions_json(system_compositions(flag(case, "demo")));
                    let expected = canonical(&json::parse(expected.as_str().unwrap()).unwrap());
                    assert_eq!(actual, expected, "{name}");
                    results += 1;
                }
                "apply" => {
                    let (registry, source) = load(text(case, "document"));
                    let item = lookup(&source, text(case, "composition"), flag(case, "demo"));
                    let before = snapshot_json(&source);
                    let next =
                        apply_composition(&source, &registry, &item, mode(get(case, "mode")));
                    assert_eq!(snapshot_json(&source), before, "{name}: source mutated");
                    results += usize::from(outcome(name, next, expected));
                }
                "scene" => {
                    let (registry, source) = load(text(case, "document"));
                    let item = lookup(&source, text(case, "composition"), true);
                    let displayed =
                        apply_composition(&source, &registry, &item, mode(get(case, "mode")))
                            .unwrap();
                    let next = composition_scene(&source, &displayed, &scopes(get(case, "scopes")));
                    results += usize::from(outcome(name, Some(next), expected));
                }
                "favorite" => {
                    let (_, source) = load(text(case, "document"));
                    let next = favorite_composition(
                        &source,
                        text(case, "id"),
                        flag(case, "favorite"),
                        flag(case, "makeDefault"),
                        optional(case, "replace"),
                    );
                    results += usize::from(outcome(name, next, expected));
                }
                "order" => {
                    let (_, source) = load(text(case, "document"));
                    let actual = composition_order(&source, flag(case, "favorites"));
                    let expected: Vec<&str> = expected
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_str().unwrap())
                        .collect();
                    assert_eq!(actual, expected, "{name}");
                    results += 1;
                }
                "reorder" => {
                    let (_, source) = load(text(case, "document"));
                    let next = reorder_composition(
                        &source,
                        text(case, "id"),
                        optional(case, "before"),
                        flag(case, "favorites"),
                    );
                    results += usize::from(outcome(name, next, expected));
                }
                "slots" => {
                    let (_, source) = load(text(case, "document"));
                    let item = lookup(&source, text(case, "composition"), true);
                    same_slots(name, &composition_slots(&item, &source), expected);
                    results += 1;
                }
                "capture" => {
                    let (_, source) = load(text(case, "document"));
                    let regions = scopes(get(case, "scopes"));
                    let session = slots(get(case, "slots"));
                    let made = match get(case, "current") {
                        Json::Bool(sidebar) => capture_current_composition(
                            &source,
                            "composition:captured",
                            "Capturada",
                            &regions,
                            *sidebar,
                            &session,
                        ),
                        _ => capture_composition(
                            &source,
                            "composition:captured",
                            "Capturada",
                            CompositionMode::parse(text(case, "mode")).unwrap(),
                            &regions,
                            chrome(get(case, "chrome")),
                            &session,
                        ),
                    };
                    let expected = format!("[{}]", expected.as_str().unwrap());
                    assert_eq!(
                        compositions_json(vec![made]),
                        canonical(&json::parse(&expected).unwrap()),
                        "{name}"
                    );
                    results += 1;
                }
                "fill" => {
                    let (registry, source) = load(text(case, "document"));
                    let intention = get(case, "intention");
                    let intention = match text(intention, "kind") {
                        "catalog" => SlotIntention::Catalog(text(intention, "typeId").to_owned()),
                        _ => SlotIntention::Move {
                            view_id: text(intention, "viewId").to_owned(),
                            source_bar: text(intention, "sourceBar").to_owned(),
                        },
                    };
                    let disabled: Vec<String> = array(case, "disabled")
                        .iter()
                        .map(|v| v.as_str().unwrap().to_owned())
                        .collect();
                    let result = fill_reservation(
                        &source,
                        &registry,
                        &slots(get(case, "slots")),
                        text(case, "id"),
                        &surface(get(case, "surface")),
                        &intention,
                        &disabled,
                    );
                    match (result, expected) {
                        (Some((next, remaining)), Json::Object(_)) => {
                            same_json(name, &snapshot_json(&next), text(expected, "snapshot"));
                            let ids: Vec<&str> = remaining.iter().map(|s| s.id.as_str()).collect();
                            let want: Vec<&str> = array(expected, "slots")
                                .iter()
                                .map(|v| v.as_str().unwrap())
                                .collect();
                            assert_eq!(ids, want, "{name}: remaining slots");
                            results += 1;
                        }
                        (None, Json::Null) => {}
                        (actual, _) => panic!(
                            "{name}: outcome differs (rust {})",
                            actual.map_or("null".into(), |(s, _)| snapshot_json(&s))
                        ),
                    }
                }
                "text" => {
                    let actual = parse_portable_text(text(case, "text"))
                        .map(|r| serialize_portable_layout(&r));
                    results += usize::from(same_outcome(name, actual, expected, |a, e| {
                        assert_eq!(a, e, "{name}: serialized recipe");
                    }));
                }
                "export" => {
                    let (registry, source) = load(text(case, "document"));
                    let saved = lookup(&source, text(case, "composition"), true);
                    let actual = export_portable_composition(&saved, &registry)
                        .map(|r| serialize_portable_layout(&r));
                    results += usize::from(same_outcome(name, actual, expected, |a, e| {
                        assert_eq!(a, e, "{name}: exported recipe");
                    }));
                }
                "import" => {
                    let (_, source) = load(text(case, "document"));
                    let recipe = parse_portable_text(text(case, "text")).unwrap();
                    let actual = import_portable_composition(
                        &source,
                        &recipe,
                        text(case, "requested"),
                        "composition:imported",
                    )
                    .map(|c| compositions_json(vec![c]));
                    results += usize::from(same_outcome(name, actual, expected, |a, e| {
                        let e = canonical(&json::parse(&format!("[{e}]")).unwrap());
                        assert_eq!(a, e, "{name}: imported record");
                    }));
                }
                "dependencies" | "resolve" => {
                    let (registry, source) = load(text(case, "document"));
                    let recipe = parse_portable_text(text(case, "text")).unwrap();
                    let record = import_portable_composition(
                        &source,
                        &recipe,
                        "Importada",
                        "composition:imported",
                    )
                    .unwrap();
                    let disabled = strings_of(get(case, "disabled"));
                    if text(case, "kind") == "dependencies" {
                        let actual = portable_dependencies(&source, &registry, &record, &disabled);
                        let expected = expected.as_array().unwrap();
                        assert_eq!(actual.len(), expected.len(), "{name}: dependency count");
                        for (a, e) in actual.iter().zip(expected) {
                            assert_eq!(a.key, text(e, "key"), "{name}");
                            assert_eq!(a.label, text(e, "label"), "{name}: {}", a.key);
                            assert_eq!(a.reason, optional(e, "reason"), "{name}: {}", a.key);
                            let candidates: Vec<(&str, &str)> = array(e, "candidates")
                                .iter()
                                .map(|c| (text(c, "id"), text(c, "label")))
                                .collect();
                            let actual: Vec<(&str, &str)> = a
                                .candidates
                                .iter()
                                .map(|c| (c.id.as_str(), c.label.as_str()))
                                .collect();
                            assert_eq!(actual, candidates, "{name}: {} candidates", a.key);
                        }
                        results += 1;
                        continue;
                    }
                    let choices: Vec<(String, String)> = get(case, "choices")
                        .as_object()
                        .unwrap()
                        .iter()
                        .map(|(k, v)| (k.to_owned(), v.as_str().unwrap().to_owned()))
                        .collect();
                    let mut counter = 0;
                    let mut group_id = || {
                        counter += 1;
                        format!("group:00000000-0000-4000-8000-{counter:012}")
                    };
                    let resolved = resolve_portable_widgets(
                        &source,
                        &registry,
                        &record,
                        &disabled,
                        &choices,
                        &mut group_id,
                    );
                    match (resolved, expected) {
                        (Some(c), Json::String(e)) => {
                            let e = canonical(&json::parse(&format!("[{e}]")).unwrap());
                            assert_eq!(compositions_json(vec![c]), e, "{name}: resolved");
                            results += 1;
                        }
                        (None, Json::Null) => {}
                        (actual, _) => panic!("{name}: outcome differs (rust {actual:?})"),
                    }
                }
                "library" => {
                    let (registry, source) = load(text(case, "document"));
                    let surfaces = session_surfaces(get(case, "surfaces"));
                    let demo = flag(case, "demo");
                    let mut draft = SessionDraft::new(source);
                    for (i, observation) in array(case, "observations").iter().enumerate() {
                        let context = format!("{name}#{i}");
                        let step = get(observation, "step");
                        let expected = get(observation, "expected");
                        let (view, _) = project_view(&draft.snapshot, &registry, &surfaces);
                        let result = if text(step, "op") == "apply" {
                            let item = lookup(&draft.snapshot, text(step, "composition"), demo);
                            apply_to_draft(&draft, &view, &registry, &item, mode(get(step, "mode")))
                        } else {
                            let index = num(step, "slot") as usize;
                            draft
                                .slots
                                .get(index)
                                .and_then(|slot| {
                                    fill_reservation(
                                        &view,
                                        &registry,
                                        &draft.slots,
                                        &slot.id,
                                        &surfaces.surface(slot.region),
                                        &SlotIntention::Catalog(text(step, "typeId").to_owned()),
                                        &[],
                                    )
                                })
                                .map(|(snapshot, slots)| SessionDraft {
                                    snapshot,
                                    slots,
                                    ..draft.clone()
                                })
                                .ok_or("Espaço indisponível.")
                        };
                        match (result, optional(expected, "error")) {
                            (Ok(next), None) => {
                                same_draft(&context, &next, expected);
                                draft = next;
                                results += 1;
                            }
                            (Err(error), Some(want)) => assert_eq!(error, want, "{context}"),
                            (actual, _) => panic!("{context}: outcome differs (rust {actual:?})"),
                        }
                    }
                }
                other => panic!("unknown case kind {other}"),
            }
        }
        assert!(
            cases.len() >= 110 && results >= 100,
            "{} cases, {results} results",
            cases.len()
        );
    }
}

#[test]
fn composition_library_runs_inside_the_edit_session() {
    use geppio_core::layout::{PerRegion, Region, Size};
    use geppio_core::workbench::compositions::{SlotIntention, capture_current_composition};
    use geppio_core::workbench::portable::parse_portable_text;
    use geppio_core::workbench::portable_compositions::import_portable_composition;
    use geppio_core::workbench::{ApplyMode, EditSession, SessionSurfaces, widget_registry};
    let surfaces = SessionSurfaces {
        sizes: PerRegion {
            main: Size::new(1567.0, 774.0),
            sidebar: Size::new(253.0, 950.0),
            bottom: Size::new(1543.0, 147.0),
        },
        expanded: false,
    };
    let mut store = MemoryStore::default();
    let mut session = EditSession::open(widget_registry(&[], true), None, true);
    let focus = session.composition("system:focus").unwrap();
    assert!(
        session
            .apply_composition(&focus, ApplyMode::Format, &surfaces)
            .is_err(),
        "the library acts only inside Edit"
    );
    session.begin(&surfaces).unwrap();
    session
        .apply_composition(&focus, ApplyMode::Format, &surfaces)
        .unwrap();
    assert_eq!(session.format_id(), Some("system:focus"));
    assert_eq!(session.format_mode(), Some(ApplyMode::Format));
    assert!(session.has_pending() && session.can_undo());
    // The same format again empties Main into two reserved slots and holds its widgets.
    session
        .apply_composition(&focus, ApplyMode::Format, &surfaces)
        .unwrap();
    assert_eq!(session.slots().len(), 2);
    assert!(session.format_source().is_some());
    assert!(
        !session
            .draft()
            .placements
            .iter()
            .any(|p| p.region == Region::Main)
    );
    let slot = session.slots()[0].id.clone();
    let editor = SlotIntention::Catalog("host:file-editor".into());
    assert!(session.slot_accepts(&slot, &editor, &surfaces, &[]));
    session
        .fill_slot(&slot, &editor, None, &surfaces, &[])
        .unwrap();
    assert_eq!(session.message(), "Espaço preenchido. Salve ou cancele.");
    assert_eq!(session.slots().len(), 1);
    assert!(session.undo());
    assert_eq!(session.slots().len(), 2);
    assert!(session.redo());
    assert_eq!(session.slots().len(), 1);
    // Save keeps the slots and the applied format; nothing is pending afterwards.
    session.save(&surfaces, &mut store).unwrap();
    assert_eq!(session.slots().len(), 1);
    assert_eq!(session.format_id(), Some("system:focus"));
    assert!(!session.has_pending() && !session.pending_import_checkpoint());
    // "Salvar atual" saves at once and is one undoable intention.
    let (view, _) = session.view(&surfaces);
    let record = capture_current_composition(
        &view,
        "composition:mine",
        "Minha",
        &[Region::Main, Region::Bottom],
        true,
        session.slots(),
    );
    session.save_composition(record, &mut store).unwrap();
    assert_eq!(session.message(), "Composição salva.");
    assert!(
        session
            .stored()
            .is_some_and(|raw| raw.contains("composition:mine"))
    );
    assert!(session.saved_composition("composition:mine").is_some());
    assert!(session.can_undo());
    // A clean checkpoint can import; the record reaches the store, checkpoint and draft.
    let recipe = parse_portable_text(
        r#"{"kind":"geppio-layout","version":1,"name":"Receita","mode":"format","scopes":["main"],"reference":{"main":{"width":1200,"height":700}},"chrome":{},"format":[{"key":"s1","region":"main","x":0,"y":0,"width":590,"height":700}],"views":[],"placements":[],"groups":[]}"#,
    )
    .unwrap();
    assert!(session.can_import_composition());
    let imported =
        import_portable_composition(session.draft(), &recipe, "Minha", "composition:imported")
            .unwrap();
    assert_eq!(imported.name, "Minha (2)");
    let mut favored = session.draft().clone();
    favored
        .organization
        .favorites
        .push("composition:mine".into());
    session.edit_action(favored).unwrap();
    assert!(
        session.pending_import_checkpoint(),
        "library changes need a save first"
    );
    assert!(
        session
            .save_imported_composition(imported.clone(), &mut store)
            .is_err()
    );
    assert!(session.undo());
    assert!(!session.pending_import_checkpoint());
    session
        .save_imported_composition(imported, &mut store)
        .unwrap();
    assert_eq!(session.message(), "Composição importada.");
    assert!(
        session
            .stored()
            .is_some_and(|raw| raw.contains("Minha (2)"))
    );
    assert!(
        session
            .checkpoint()
            .organization
            .compositions
            .iter()
            .any(|c| c.id == "composition:imported")
    );
    // A portable record applies its format; its widgets need the resolved candidate.
    let portable = session.composition("composition:imported").unwrap();
    assert!(
        session
            .apply_composition(&portable, ApplyMode::Widgets, &surfaces)
            .is_err()
    );
    // Conclude clears the slots and the applied format.
    session.conclude(&surfaces, &mut store).unwrap();
    assert!(session.slots().is_empty() && session.format_id().is_none());
    assert!(session.format_mode().is_none() && session.format_source().is_none());
    // Cancel restores the checkpoint without the format.
    session.begin(&surfaces).unwrap();
    session
        .apply_composition(&focus, ApplyMode::Format, &surfaces)
        .unwrap();
    session.cancel();
    assert!(session.format_id().is_none() && session.slots().is_empty());
}
