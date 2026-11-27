//! Edit-mode UI state around `geppio_core::workbench::EditSession`: pointer gestures with the
//! 5px lift threshold, the pickup lerp, drop flights, FLIP after committed actions, the
//! catalog column and transaction toasts. The core owns geometry, transactions and history;
//! this module only turns pointer input into core calls and frames into motion.
use std::collections::HashMap;
use std::path::PathBuf;

use geppio_core::layout::{AlignmentGuide, Direction, Region};
use geppio_core::workbench::WorkbenchStore;
use geppui::{AnchorHandle, Rect, TextField, Transition, Tween, motion};
use gpui::{Entity, ScrollHandle};

use crate::catalog::{Area, CatalogState};

/// The native profile file holding the `geppio:workbench:v1` envelope bytes.
const FILE: &str = "workbench.json";
const MAX_BYTES: u64 = 512 * 1024;

/// File-backed store in the native profile (never the Electron profile). Writes use a
/// fresh, uniquely named temporary file, `sync_all` and a rename.
#[derive(Clone, Debug)]
pub struct FileStore {
    pub dir: Option<PathBuf>,
}

impl WorkbenchStore for FileStore {
    /// Only a missing file is "no document"; any other failure, an oversized file or invalid
    /// UTF-8 is an error, so the caller keeps the file instead of starting over it.
    fn get(&self) -> Result<Option<String>, String> {
        use std::io::Read as _;
        let Some(dir) = &self.dir else {
            return Ok(None);
        };
        let file = match std::fs::File::open(dir.join(FILE)) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        // One handle, bounded read: a file that grows after the open cannot exceed the cap.
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Documento de layout grande demais.".into());
        }
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "Documento de layout com UTF-8 inválido.".into())
    }
    fn set(&mut self, raw: &str) -> Result<(), String> {
        use std::io::Write as _;
        let Some(dir) = &self.dir else {
            return Err("Perfil nativo indisponível.".into());
        };
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let temp = dir.join(format!("{FILE}.{}-{stamp}.tmp", std::process::id()));
        // `create_new` never opens an existing file; only a file this call created is removed.
        let mut file = std::fs::File::options()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        let result = (|| -> std::io::Result<()> {
            file.write_all(raw.as_bytes())?;
            file.sync_all()
        })();
        drop(file);
        let result = result.and_then(|()| std::fs::rename(&temp, dir.join(FILE)));
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result.map_err(|e| e.to_string())
    }
}

pub fn area(region: Region) -> Area {
    match region {
        Region::Main => Area::Main,
        Region::Sidebar => Area::Sidebar,
        Region::Bottom => Area::Bottom,
    }
}

pub fn region(area: Area) -> Region {
    match area {
        Area::Main => Region::Main,
        Area::Sidebar => Region::Sidebar,
        Area::Bottom => Region::Bottom,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum GestureKind {
    Move,
    Resize(Direction),
    /// A catalog tile: the widget type id.
    Catalog(String),
}

#[derive(Clone, Debug)]
pub struct UiGesture {
    pub kind: GestureKind,
    /// View id (move/resize) or type id (catalog).
    pub id: String,
    /// Widget fixture rendered in the picture.
    pub fixture: String,
    pub region: Option<Region>,
    pub down: (f32, f32),
    pub pointer: (f32, f32),
    pub lifted: bool,
    pub lifted_at: f64,
    /// Picture start rectangle (window CSS pixels).
    pub origin: Rect,
    pub zones: Vec<Region>,
    pub guides: Vec<AlignmentGuide>,
    /// A catalog drag: the tile's rectangle (a refusal shrinks back into it).
    pub tile: Option<Rect>,
    /// A catalog drag of a single-view widget that is already placed: that view moves
    /// (its frame is ghosted and the label names its region).
    pub moving: Option<String>,
    /// Pressed on the grip: a short click opens the catalog's move mode.
    pub grip: bool,
    /// The region's scroll at the press (scrolling during the gesture moves the frame).
    pub scroll0: (f32, f32),
    /// Pointer travel the expanded Main could not scroll (the occupied extent grows).
    pub extension: f32,
    /// The last horizontal direction of the pointer (−1, 0, 1).
    pub dir_x: f32,
    /// The format slot under the pointer and whether it accepts the drag.
    pub hover_slot: Option<(String, bool)>,
}

impl UiGesture {
    pub fn distance(&self) -> f32 {
        ((self.pointer.0 - self.down.0).powi(2) + (self.pointer.1 - self.down.1).powi(2)).sqrt()
    }
    /// Picture rectangle at `now`: lerp from the origin to pointer − 4px over 220ms.
    pub fn picture(&self, now: f64, reduced: bool) -> Rect {
        let rest = Rect::new(
            self.pointer.0 - 4.0,
            self.pointer.1 - 4.0,
            self.origin.w,
            self.origin.h,
        );
        let elapsed = if reduced {
            1.0
        } else {
            ((now - self.lifted_at) / motion::duration::PICKUP).clamp(0.0, 1.0)
        };
        Rect::lerp(self.origin, rest, motion::FLIGHT.ease(elapsed) as f32)
    }
    pub fn label(&self) -> &'static str {
        match (&self.kind, self.region) {
            (GestureKind::Catalog(_), _) if self.moving.is_none() => "Adicionando widget",
            (_, Some(Region::Sidebar)) => "Movendo da barra lateral",
            (_, Some(Region::Bottom)) => "Movendo da barra inferior",
            _ => "Movendo da área principal",
        }
    }
}

/// The picture flying to its destination (accepted) or back (rejected).
#[derive(Clone, Debug)]
pub struct Flight {
    /// The view revealed when the flight completes.
    pub view: Option<String>,
    pub fixture: String,
    pub compact: bool,
    pub tween: Tween,
    /// A rejected catalog drag shrinks and fades instead of resizing.
    pub shrink: bool,
}

/// A FLIP of a frame after a committed action (undo/redo, add, transfer).
#[derive(Clone, Debug)]
pub struct Flip {
    pub id: String,
    pub tween: Tween,
}

pub struct EditUi {
    pub catalog_open: bool,
    pub catalog_track: Transition,
    pub catalog: CatalogState,
    /// The catalog search (`input[type=search]`).
    pub search: Entity<TextField>,
    /// Whether the search field holds focus (read at render).
    pub search_focused: bool,
    pub gesture: Option<UiGesture>,
    pub flight: Option<Flight>,
    pub flips: Vec<Flip>,
    /// The last frame that received a pointer press while editing.
    pub selected: Option<String>,
    /// The frame whose last preview or drop was refused (`.widget-frame.invalid`).
    pub blocked: Option<String>,
    pub toast: Option<(String, f64)>,
    pub over: Option<Region>,
    pub zone_over: [Transition; 3],
    /// The catalog's plugin filter button.
    pub filter_anchor: geppui::AnchorHandle,
    /// Layout bounds of each catalog tile.
    pub tile_anchors: HashMap<&'static str, AnchorHandle>,
    pub grid_scroll: ScrollHandle,
    pub category_scroll: ScrollHandle,
    /// The filters the grid scroll was last reset for.
    pub filter_key: String,
    /// The tile shaking after a refused lift, and since when.
    pub shake: Option<(&'static str, f64)>,
    /// When the chosen slot's entry motion started.
    pub slot_motion: Option<f64>,
    /// The rail bar hovered during a drag, and since when (`dwell`, 250ms).
    pub dwell: Option<(String, f64)>,
    /// The Sidebar insertion line (content y) while a drag is over the Sidebar.
    pub insertion: Option<f32>,
    /// Undo/redo pressed during a drop flight run when it lands (`visual.after`).
    pub queued: Vec<&'static str>,
    /// Focus requests applied at the next render.
    pub focus: Option<FocusRequest>,
    /// A catalog press that moved 5px is a drag: its click must not open the destination.
    pub suppress_click: bool,
    /// New frames of an applied composition fading in: start, duration and view ids.
    pub entering: Option<(f64, f64, Vec<String>)>,
    /// The current click landed on a tile or the destination box (read by the browser's
    /// outside-click handler, which runs after it).
    pub keep_destination: bool,
}

/// A focus move the edit UI asks for at the next render.
#[derive(Clone, Debug, PartialEq)]
pub enum FocusRequest {
    /// The catalog search (a slot was chosen).
    Search,
    /// Back to the workbench (the search was left with Escape).
    Workbench,
    /// The first enabled destination button.
    Destination,
    /// A catalog control by element id (a tile after a removal, a slot after a cancel).
    Control(String),
}

impl EditUi {
    pub fn new(search: Entity<TextField>) -> Self {
        Self {
            catalog_open: false,
            catalog_track: Transition::new(0.0),
            catalog: CatalogState::default(),
            search,
            search_focused: false,
            gesture: None,
            flight: None,
            flips: Vec::new(),
            selected: None,
            blocked: None,
            toast: None,
            over: None,
            filter_anchor: geppui::AnchorHandle::default(),
            zone_over: [
                Transition::new(0.0),
                Transition::new(0.0),
                Transition::new(0.0),
            ],
            tile_anchors: HashMap::new(),
            grid_scroll: ScrollHandle::new(),
            category_scroll: ScrollHandle::new(),
            filter_key: String::new(),
            shake: None,
            slot_motion: None,
            dwell: None,
            insertion: None,
            queued: Vec::new(),
            focus: None,
            suppress_click: false,
            entering: None,
            keep_destination: false,
        }
    }
}

pub fn zone_index(region: Region) -> usize {
    match region {
        Region::Main => 0,
        Region::Sidebar => 1,
        Region::Bottom => 2,
    }
}

impl EditUi {
    /// Toast lifetime of the reference (3.2s).
    pub const TOAST_MS: f64 = 3200.0;

    /// Shows a transaction message. The same text again does not restart it (the
    /// reference toast follows changes of `tx.message`).
    pub fn toast(&mut self, message: &str, now: f64) {
        if message.is_empty() || self.toast.as_ref().is_some_and(|(m, _)| m == message) {
            return;
        }
        self.toast = Some((message.to_owned(), now));
    }
    /// Shows `message` again from `now`: a gesture just ended (the toast stays hidden while
    /// one runs and the latest message appears when it ends).
    pub fn rearm(&mut self, message: &str, now: f64) {
        if !message.is_empty() {
            self.toast = Some((message.to_owned(), now));
        }
    }
    /// Whether a pointer gesture or the rejection shake is running (`feedbackActive`).
    pub fn feedback_active(&self, now: f64) -> bool {
        self.gesture.is_some() || self.shake.is_some_and(|(_, at)| now - at < 280.0)
    }
    pub fn toast_text(&self, now: f64) -> Option<&str> {
        if self.feedback_active(now) {
            return None;
        }
        self.toast
            .as_ref()
            .filter(|(_, at)| now - at < Self::TOAST_MS)
            .map(|(m, _)| m.as_str())
    }
    pub fn set_catalog(&mut self, open: bool, now: f64, reduced: bool) {
        self.catalog_open = open;
        // Reduced motion: `--catalog-track-motion: 0s`.
        let d = if reduced {
            0.0
        } else {
            motion::duration::REGION
        };
        self.catalog_track
            .set(now, if open { 480.0 } else { 0.0 }, d, motion::REGION);
    }
    /// Frame rectangle at `now`, following a running FLIP.
    pub fn flipped(&self, id: &str, rect: Rect, now: f64) -> Rect {
        match self.flips.iter().find(|f| f.id == id) {
            Some(f) if !f.tween.done(now) => {
                let mut tween = f.tween;
                tween.to = rect;
                tween.at(now)
            }
            _ => rect,
        }
    }
    pub fn settle(&mut self, now: f64) {
        self.flips.retain(|f| !f.tween.done(now));
        if self.shake.is_some_and(|(_, at)| now - at >= 280.0) {
            self.shake = None;
        }
        if self.slot_motion.is_some_and(|at| now - at >= 520.0) {
            self.slot_motion = None;
        }
        if self
            .entering
            .as_ref()
            .is_some_and(|(at, duration, _)| now - at >= *duration)
        {
            self.entering = None;
        }
        if self.flight.as_ref().is_some_and(|f| f.tween.done(now)) {
            self.flight = None;
        }
    }
    pub fn animating(&self, now: f64) -> bool {
        !self.flips.is_empty()
            || self.flight.is_some()
            || self.catalog_track.animating(now)
            || self.shake.is_some()
            || self.slot_motion.is_some()
            || self.entering.is_some()
            || self.dwell.as_ref().is_some_and(|(_, at)| at.is_finite())
            || self.zone_over.iter().any(|z| z.animating(now))
            || self
                .gesture
                .as_ref()
                .is_some_and(|g| g.lifted && now - g.lifted_at < motion::duration::PICKUP)
            || self
                .toast
                .as_ref()
                .is_some_and(|(_, at)| now - at < Self::TOAST_MS)
    }
}

/// Flips for every frame whose rectangle changed between two renders of the scene.
pub fn flips_between(
    before: &[(String, Rect)],
    after: &[(String, Rect)],
    now: f64,
    reduced: bool,
    skip: Option<&str>,
) -> Vec<Flip> {
    if reduced {
        return Vec::new();
    }
    after
        .iter()
        .filter(|(id, _)| Some(id.as_str()) != skip)
        .filter_map(|(id, to)| {
            let (_, from) = before.iter().find(|(b, _)| b == id)?;
            (from != to).then(|| Flip {
                id: id.clone(),
                tween: Tween {
                    from: *from,
                    to: *to,
                    start_ms: now,
                    duration_ms: motion::duration::FLIGHT,
                    easing: motion::FLIGHT,
                },
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_round_trips_in_the_native_profile() {
        let dir =
            std::env::temp_dir().join(format!("geppio-native-test-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = FileStore {
            dir: Some(dir.clone()),
        };
        assert_eq!(store.get().unwrap(), None);
        store.set("{\"a\":1}").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("{\"a\":1}"));
        // Replacing an existing document leaves no temporary file behind.
        store.set("{\"a\":2}").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("{\"a\":2}"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        // Unreadable documents are errors (kept by recovery), never "no document".
        std::fs::write(dir.join(FILE), [0x7b, 0xff, 0x7d]).unwrap();
        assert!(store.get().is_err(), "invalid UTF-8");
        std::fs::write(dir.join(FILE), vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert!(store.get().is_err(), "over the cap");
        std::fs::write(dir.join(FILE), vec![b' '; MAX_BYTES as usize]).unwrap();
        assert!(store.get().unwrap().is_some(), "exactly at the cap");
        std::fs::remove_dir_all(&dir).unwrap();
        // Without a profile nothing is read and a save is refused, not reported as done.
        let mut none = FileStore { dir: None };
        assert_eq!(none.get().unwrap(), None);
        assert!(none.set("{}").is_err());
    }

    #[test]
    fn pickup_rests_at_pointer_minus_four_and_flips_only_changed_frames() {
        let g = UiGesture {
            kind: GestureKind::Move,
            id: "v".into(),
            fixture: "summary".into(),
            region: Some(Region::Main),
            down: (0.0, 0.0),
            pointer: (100.0, 60.0),
            lifted: true,
            lifted_at: 0.0,
            origin: Rect::new(10.0, 10.0, 50.0, 40.0),
            zones: vec![],
            guides: vec![],
            tile: None,
            moving: None,
            grip: false,
            scroll0: (0.0, 0.0),
            extension: 0.0,
            dir_x: 0.0,
            hover_slot: None,
        };
        assert_eq!(g.picture(1000.0, false), Rect::new(96.0, 56.0, 50.0, 40.0));
        assert_eq!(g.picture(0.0, false), g.origin);
        let before = vec![
            ("a".to_string(), Rect::new(0.0, 0.0, 1.0, 1.0)),
            ("b".to_string(), Rect::new(5.0, 5.0, 1.0, 1.0)),
        ];
        let after = vec![
            ("a".to_string(), Rect::new(0.0, 0.0, 1.0, 1.0)),
            ("b".to_string(), Rect::new(9.0, 5.0, 1.0, 1.0)),
        ];
        let flips = flips_between(&before, &after, 0.0, false, None);
        assert_eq!(flips.len(), 1);
        assert_eq!(flips[0].id, "b");
        assert!(flips_between(&before, &after, 0.0, true, None).is_empty());
    }
}
