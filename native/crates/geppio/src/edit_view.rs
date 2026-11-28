//! Widgets and edit mode on the main screen: the scene projected by `geppio-core`, widget
//! frames with their edit chrome (heading move, eight resize zones), gestures, flights, FLIP,
//! drop zones, guides, the catalog column, the banner and keyboard shortcuts.
use std::collections::HashMap;
use std::rc::Rc;

use geppio_core::layout::{Axis, Constraint, Direction, GuideKind, PerRegion, Region, Size};
use geppio_core::shell::{self, ShellLayout};
use geppio_core::workbench::compositions::{SlotIntention, project_session_slot};
use geppio_core::workbench::model::{Operation, PlacementRefusal, evaluate_placement};
use geppio_core::workbench::presentations::panel_ids;
use geppio_core::workbench::{
    EditSession, PointerFrame, Presence, SessionSlot, SessionSurfaces, WorkbenchSnapshot,
    active_placements,
};
use geppui::{Metrics, Rect, Theme, motion};
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, ParentElement, ScrollHandle, SharedString, StatefulInteractiveElement, Styled,
    Window, div, prelude::FluentBuilder,
};

use crate::catalog::{
    self, Area, CatalogActions, CatalogExtra, CatalogMotion, CatalogState, CatalogTab, Destination,
    Tile,
};
use crate::drag_layer::{self, Guide};
use crate::edit::{
    Flight, FocusRequest, GestureKind, UiGesture, area, flips_between, region, zone_index,
};
use crate::edit_chrome::{self, BannerActions};
use crate::widgets::{self, Properties};
use crate::workbench::Workbench;

/// Window-space ports of the three regions and the solver surfaces measured from them.
#[derive(Clone, Copy, Debug)]
pub struct Ports {
    pub main: Rect,
    pub sidebar: Rect,
    pub bottom: Rect,
    pub surfaces: SessionSurfaces,
}

impl Ports {
    pub fn of(s: &ShellLayout, sidebar_width: f64) -> Self {
        let r = |x: f64, y: f64, w: f64, h: f64| {
            Rect::new(x as f32, y as f32, w.max(0.0) as f32, h.max(0.0) as f32)
        };
        let main = r(s.main_port.x, s.main_port.y, s.main_port.w, s.main_port.h);
        let sidebar = r(
            shell::RAIL + shell::SIDEBAR_INSET,
            shell::HEADER + shell::CONTEXT + shell::SPACE_Y,
            sidebar_width - 2.0 * shell::SIDEBAR_INSET,
            s.sidebar_clip.h - shell::CONTEXT - 2.0 * shell::SPACE_Y,
        );
        let tray = s.bottom_surface;
        let bottom = r(
            tray.x + 1.0 + shell::SPACE_X,
            tray.y + 1.0 + shell::SPACE_Y,
            tray.w - 2.0 - 2.0 * shell::SPACE_X,
            tray.h - 2.0 - 2.0 * shell::SPACE_Y,
        );
        let size = |p: Rect| Size::new(p.w as f64, p.h as f64);
        Self {
            main,
            sidebar,
            bottom,
            surfaces: SessionSurfaces {
                sizes: PerRegion {
                    main: size(main),
                    sidebar: size(sidebar),
                    bottom: size(bottom),
                },
                expanded: false,
            },
        }
    }
    pub fn port(&self, region: Region) -> Rect {
        match region {
            Region::Main => self.main,
            Region::Sidebar => self.sidebar,
            Region::Bottom => self.bottom,
        }
    }
}

/// One visible frame of the scene.
#[derive(Clone, Debug)]
pub struct Frame {
    pub id: String,
    pub fixture: String,
    pub region: Region,
    /// Content coordinates inside the region port.
    pub rect: Rect,
}

pub fn scene(
    session: &EditSession,
    surfaces: &SessionSurfaces,
) -> (WorkbenchSnapshot, Vec<Frame>, f32) {
    let (view, _) = session.view(surfaces);
    let registry = session.registry();
    // Saved Docked/Floating presentations stay out of the normal frames (`visible`); their
    // panels arrive with the presentation layer.
    let panels = panel_ids(&view);
    let frames: Vec<Frame> = active_placements(&view, true)
        .into_iter()
        .filter(|p| !panels.contains(&p.id))
        .filter_map(|p| {
            let fixture = view
                .type_of(&p.id)
                .and_then(|t| registry.get(t))
                .and_then(|t| t.fixture.clone())?;
            Some(Frame {
                id: p.id.clone(),
                fixture,
                region: p.region,
                rect: Rect::new(p.x as f32, p.y as f32, p.width as f32, p.height as f32),
            })
        })
        .collect();
    let sidebar_world = frames
        .iter()
        .filter(|f| f.region == Region::Sidebar)
        .map(|f| f.rect.bottom())
        .fold(0.0f32, f32::max);
    (view, frames, sidebar_world)
}

/// The resize zones a frame offers: the directions its region constraint allows
/// (`allowsResize`).
fn zones_for(c: &Constraint) -> Vec<Direction> {
    [
        Direction::N,
        Direction::E,
        Direction::S,
        Direction::W,
        Direction::Ne,
        Direction::Nw,
        Direction::Se,
        Direction::Sw,
    ]
    .into_iter()
    .filter(|d| geppio_core::layout::geometry::allows_resize(*d, c))
    .collect()
}

/// `borda superior` … of a resize zone (`LABELS`).
fn zone_label(d: Direction) -> &'static str {
    match d {
        Direction::N => "borda superior",
        Direction::E => "borda direita",
        Direction::S => "borda inferior",
        Direction::W => "borda esquerda",
        Direction::Ne => "canto superior direito",
        Direction::Nw => "canto superior esquerdo",
        Direction::Se => "canto inferior direito",
        Direction::Sw => "canto inferior esquerdo",
    }
}

impl Workbench {
    pub(crate) fn editing(&self) -> bool {
        self.session.editing()
    }

    pub(crate) fn scroll(&self, region: Region) -> (f32, f32) {
        match region {
            Region::Sidebar => (
                0.0,
                -f32::from(self.sidebar_scroll.offset().y) / self.metrics.zoom,
            ),
            Region::Main => (
                -f32::from(self.main_scroll.offset().x) / self.metrics.zoom,
                -f32::from(self.main_scroll.offset().y) / self.metrics.zoom,
            ),
            Region::Bottom => (0.0, 0.0),
        }
    }

    /// Window rectangle of a frame (content rect + port origin − scroll).
    pub(crate) fn window_rect(&self, f: &Frame) -> Rect {
        let port = self.ports.port(f.region);
        let (sx, sy) = self.scroll(f.region);
        Rect::new(
            port.x + f.rect.x - sx,
            port.y + f.rect.y - sy,
            f.rect.w,
            f.rect.h,
        )
    }

    pub(crate) fn frame_rects(&self) -> Vec<(String, Rect)> {
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        frames
            .iter()
            .map(|f| (f.id.clone(), self.window_rect(f)))
            .collect()
    }

    /// Runs an intention and plays the FLIP of every frame it moved; only a refusal shows a
    /// message (the session's reason), like `tx.action` in the reference.
    pub(crate) fn flip_quietly(
        &mut self,
        now: f64,
        reduced: bool,
        action: impl FnOnce(&mut Self) -> bool,
    ) {
        let before = self.frame_rects();
        let done = action(self);
        let after = self.frame_rects();
        self.edit.flips = flips_between(&before, &after, now, reduced, None);
        if !done {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        }
    }

    /// Applies a composition: frames move over 380ms and the new ones fade in, 8px up
    /// (`{ duration: 380, entering: true }`); only a refusal shows a message.
    pub(crate) fn flip_applied(
        &mut self,
        now: f64,
        reduced: bool,
        action: impl FnOnce(&mut Self) -> bool,
    ) {
        let before = self.frame_rects();
        let done = action(self);
        let after = self.frame_rects();
        let mut flips = flips_between(&before, &after, now, reduced, None);
        for f in &mut flips {
            f.tween.duration_ms = 380.0;
        }
        self.edit.flips = flips;
        let entering: Vec<String> = after
            .iter()
            .filter(|(id, _)| !before.iter().any(|(b, _)| b == id))
            .map(|(id, _)| id.clone())
            .collect();
        if !reduced && !entering.is_empty() {
            self.edit.entering = Some((now, 380.0, entering));
        }
        if !done {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        }
    }

    // ---- format slots -------------------------------------------------------------------

    /// The draft's slots shown now: Sidebar slots only for their bar, projected to the
    /// measured region (`sessionSlots`).
    pub(crate) fn session_slots(&self) -> Vec<SessionSlot> {
        let bar = &self.session.draft().organization.active_bar;
        self.session
            .slots()
            .iter()
            .filter(|s| s.sidebar_bar.as_ref().is_none_or(|b| b == bar))
            .map(|s| project_session_slot(s, *self.ports.surfaces.sizes.get(s.region)))
            .collect()
    }

    /// Window rectangle of a projected slot.
    fn slot_rect(&self, slot: &SessionSlot) -> Rect {
        let port = self.ports.port(slot.region);
        let (sx, sy) = self.scroll(slot.region);
        Rect::new(
            port.x + slot.x as f32 - sx,
            port.y + slot.y as f32 - sy,
            slot.width as f32,
            slot.height as f32,
        )
    }

    fn slot_at(&self, pos: (f32, f32)) -> Option<SessionSlot> {
        self.session_slots()
            .into_iter()
            .find(|s| self.slot_rect(s).contains(pos.0, pos.1))
    }

    /// "Espaço N" of a slot within its region.
    fn slot_index(&self, slot: &SessionSlot) -> usize {
        self.session_slots()
            .iter()
            .filter(|s| s.region == slot.region)
            .position(|s| s.id == slot.id)
            .map_or(1, |i| i + 1)
    }

    /// Chooses (or clears) the slot the catalog fills: the catalog opens on Widgets filtered
    /// by the slot's region with the search focused, and the previous filters return when
    /// the choice ends.
    pub(crate) fn choose_slot(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let catalog = &mut self.edit.catalog;
        catalog.destination = None;
        catalog.moving = None;
        catalog.plugin_menu = false;
        match id {
            None => {
                if catalog.slot.take().is_some()
                    && let Some(saved) = catalog.saved.take()
                {
                    *catalog = CatalogState {
                        slot: None,
                        saved: None,
                        ..*saved
                    };
                    let text = catalog.search.clone();
                    self.edit
                        .search
                        .update(cx, |field, cx| field.set_text(&text, cx));
                }
                self.edit.slot_motion = None;
            }
            Some(id) => {
                let Some(slot) = self.session.slots().iter().find(|s| s.id == id).cloned() else {
                    return;
                };
                if catalog.saved.is_none() {
                    catalog.saved = Some(Box::new(CatalogState {
                        saved: None,
                        slot: None,
                        ..catalog.clone()
                    }));
                }
                catalog.slot = Some(id);
                catalog.tab = CatalogTab::Widgets;
                catalog.search.clear();
                catalog.areas = vec![area(slot.region)];
                catalog.category = None;
                catalog.plugin = None;
                self.edit
                    .search
                    .update(cx, |field, cx| field.set_text("", cx));
                if !self.edit.catalog_open {
                    self.edit.set_catalog(true, now, reduced);
                }
                self.edit.focus = Some(FocusRequest::Search);
                self.edit.slot_motion = (!reduced).then_some(now);
            }
        }
        cx.notify();
    }

    /// Ends a slot choice from its banner or Escape, returning focus to the slot (`cancelChoice`).
    pub(crate) fn cancel_slot_choice(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.edit.catalog.slot.clone() {
            self.choose_slot(None, cx);
            self.edit.focus = Some(FocusRequest::Control(format!("session-slot-{id}")));
        }
    }

    /// Fills the chosen slot (or `slot`) with a catalog widget (`add` with a target).
    fn fill_chosen(
        &mut self,
        slot: &str,
        intention: SlotIntention,
        baseline: Option<&WorkbenchSnapshot>,
        cx: &mut Context<Self>,
    ) -> bool {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let surfaces = self.ports.surfaces;
        let mut ok = false;
        self.flip_quietly(now, reduced, |w| {
            ok = w
                .session
                .fill_slot(slot, &intention, baseline, &surfaces, &[])
                .is_ok();
            ok
        });
        if ok {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
            if self.edit.catalog.slot.as_deref() == Some(slot) || self.edit.catalog.slot.is_some() {
                self.choose_slot(None, cx);
            }
        }
        cx.notify();
        ok
    }

    pub(crate) fn begin_edit(&mut self, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        if self.editing() {
            let open = !self.edit.catalog_open;
            self.edit.set_catalog(open, now, reduced);
        } else if self.session.begin(&self.ports.surfaces).is_ok() {
            self.pending_focus = Some(true);
            self.edit.catalog = Default::default();
            self.edit
                .search
                .update(cx, |field, cx| field.set_text("", cx));
            self.edit.set_catalog(true, now, reduced);
            self.edit.toast("Edite a composição. Salvar edição confirma um checkpoint; Concluir encerra a sessão.", now);
        } else if self.session.recovery() {
            // Edit stays closed: the recovery message keeps showing (`begin` returns).
            let message = self.session.message().to_owned();
            self.edit.rearm(&message, now);
        } else {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        }
        cx.notify();
    }

    fn leave_edit(&mut self, now: f64, reduced: bool) {
        self.edit.catalog.slot = None;
        self.edit.catalog.saved = None;
        self.edit.catalog.destination = None;
        self.edit.catalog.moving = None;
        self.edit.blocked = None;
        self.edit.dwell = None;
        self.edit.insertion = None;
        self.edit.queued.clear();
        self.edit.slot_motion = None;
        let library = &mut self.compositions;
        library.options = None;
        library.drag = None;
        library.form = None;
        library.confirm = None;
        library.replace = None;
        library.import = None;
        library.mapping = None;
        self.pending_focus = Some(false);
        self.removing = None;
        self.edit.selected = None;
        self.edit.set_catalog(false, now, reduced);
        self.edit.gesture = None;
        self.edit.search_focused = false;
    }

    pub(crate) fn edit_command(&mut self, command: &str, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        if matches!(command, "undo" | "redo") {
            // Refused while a gesture or a splitter drag runs; a pending keyboard resize is
            // its own intention first; during a drop flight it waits for the landing.
            if self.edit.gesture.is_some()
                || self.regions.dragging()
                || self.edit.panel.drag.is_some()
                || self.pairs_active()
            {
                return;
            }
            self.clear_swap_selection();
            self.settle_splitter_keyboard(cx);
            if self.edit.flight.is_some() {
                self.edit
                    .queued
                    .push(if command == "undo" { "undo" } else { "redo" });
                return;
            }
            let before = self.frame_rects();
            let done = if command == "undo" {
                self.session.undo()
            } else {
                self.session.redo()
            };
            let after = self.frame_rects();
            self.edit.flips = flips_between(&before, &after, now, reduced, None);
            if done {
                self.edit.blocked = None;
                self.apply_local_state(cx);
            }
            cx.notify();
            return;
        }
        if self.edit.gesture.is_some() || self.edit.flight.is_some() {
            return;
        }
        match command {
            "save" => {
                let surfaces = self.ports.surfaces;
                let _ = self.session.save(&surfaces, &mut self.store);
                let message = self.session.message().to_owned();
                self.edit.toast(&message, now);
            }
            "conclude" => {
                let surfaces = self.ports.surfaces;
                if self.session.conclude(&surfaces, &mut self.store).is_ok() {
                    self.leave_edit(now, reduced);
                }
                let message = self.session.message().to_owned();
                self.edit.toast(&message, now);
            }
            "cancel" => {
                self.session.cancel();
                self.apply_local_state(cx);
                self.leave_edit(now, reduced);
                let message = self.session.message().to_owned();
                self.edit.toast(&message, now);
            }
            _ => {}
        }
        cx.notify();
    }

    // ---- pointer gestures -------------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn frame_down(
        &mut self,
        id: String,
        fixture: String,
        kind: GestureKind,
        grip: bool,
        pos: (f32, f32),
        cx: &mut Context<Self>,
    ) {
        if !self.editing() || self.edit.gesture.is_some() || self.edit.flight.is_some() {
            return;
        }
        self.settle_splitter_keyboard(cx);
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        let Some(frame) = frames.iter().find(|f| f.id == id) else {
            return;
        };
        let origin = self.window_rect(frame);
        let scroll0 = self.scroll(frame.region);
        self.edit.selected = Some(id.clone());
        let mut gesture = UiGesture {
            kind: kind.clone(),
            id: id.clone(),
            fixture,
            region: Some(frame.region),
            down: pos,
            pointer: pos,
            lifted: false,
            lifted_at: 0.0,
            origin,
            zones: Vec::new(),
            guides: Vec::new(),
            tile: None,
            moving: None,
            grip,
            scroll0,
            extension: 0.0,
            dir_x: 0.0,
            hover_slot: None,
        };
        if let GestureKind::Resize(d) = kind {
            // Resizes solve from the first move, without a lift threshold or picture.
            if self
                .session
                .pickup(
                    &id,
                    geppio_core::layout::Gesture::Resize(d),
                    &self.ports.surfaces,
                )
                .is_err()
            {
                return;
            }
            gesture.lifted = true;
            gesture.lifted_at = geppui::now(cx);
        }
        self.edit.gesture = Some(gesture);
        cx.notify();
    }

    pub(crate) fn tile_down(&mut self, type_id: &str, pos: (f32, f32), cx: &mut Context<Self>) {
        if !self.editing() || self.edit.gesture.is_some() || self.edit.flight.is_some() {
            return;
        }
        self.settle_splitter_keyboard(cx);
        self.edit.suppress_click = false;
        let registry = self.session.registry();
        let Some(ty) = registry.get(type_id) else {
            return;
        };
        let fixture = ty.fixture.clone().unwrap_or_default();
        let single = ty.presence == Presence::SingleView;
        let z = self.metrics.zoom;
        let tile = self
            .edit
            .tile_anchors
            .get(type_id)
            .and_then(|a| a.bounds())
            .map(|b| {
                Rect::new(
                    f32::from(b.origin.x) / z,
                    f32::from(b.origin.y) / z,
                    f32::from(b.size.width) / z,
                    f32::from(b.size.height) / z,
                )
            });
        // A single-view widget that is already placed moves: the picture is its frame.
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        let draft = self.session.draft();
        let source = single
            .then(|| {
                frames
                    .iter()
                    .find(|f| draft.type_of(&f.id) == Some(type_id))
                    .cloned()
            })
            .flatten();
        let (origin, region, moving) = match &source {
            Some(f) => (self.window_rect(f), Some(f.region), Some(f.id.clone())),
            None => {
                let at = tile.map_or((pos.0 - 40.0, pos.1 - 30.0), |t| (t.x, t.y));
                (Rect::new(at.0, at.1, 238.0, 200.0), None, None)
            }
        };
        self.edit.gesture = Some(UiGesture {
            kind: GestureKind::Catalog(type_id.to_owned()),
            id: type_id.to_owned(),
            fixture,
            region,
            down: pos,
            pointer: pos,
            lifted: false,
            lifted_at: 0.0,
            origin,
            zones: Vec::new(),
            guides: Vec::new(),
            tile,
            moving,
            grip: false,
            scroll0: (0.0, 0.0),
            extension: 0.0,
            dir_x: 0.0,
            hover_slot: None,
        });
        cx.notify();
    }

    fn region_at(&self, pos: (f32, f32), zones: &[Region]) -> Option<Region> {
        zones.iter().copied().find(|r| {
            let p = self.ports.port(*r);
            Rect::new(p.x - 3.0, p.y - 3.0, p.w + 6.0, p.h + 6.0).contains(pos.0, pos.1)
        })
    }

    /// The region element under a drop (`[data-region]`, the port with its padding).
    fn region_under(&self, pos: (f32, f32)) -> Option<Region> {
        Region::ALL.into_iter().find(|r| {
            let p = self.ports.port(*r);
            Rect::new(p.x - 12.0, p.y - 12.0, p.w + 24.0, p.h + 24.0).contains(pos.0, pos.1)
        })
    }

    /// Content coordinates of a window point inside a region's port.
    fn content_at(&self, region: Region, pos: (f32, f32)) -> (f64, f64) {
        let port = self.ports.port(region);
        let (sx, sy) = self.scroll(region);
        ((pos.0 - port.x + sx) as f64, (pos.1 - port.y + sy) as f64)
    }

    /// The regions a catalog type can be dropped into now.
    fn catalog_zones(&self, type_id: &str) -> Vec<Region> {
        self.tiles()
            .into_iter()
            .find(|t| t.id == type_id)
            .map(|t| t.available.iter().map(|a| region(*a)).collect())
            .unwrap_or_default()
    }

    /// Whether a slot accepts the running drag (`hoverReservation`).
    fn slot_takes(&self, slot: &str, g: &UiGesture) -> bool {
        let intention = match &g.kind {
            GestureKind::Move => SlotIntention::Move {
                view_id: g.id.clone(),
                source_bar: self.session.draft().organization.active_bar.clone(),
            },
            GestureKind::Catalog(type_id) => SlotIntention::Catalog(type_id.clone()),
            GestureKind::Resize(_) => return false,
        };
        self.session
            .slot_accepts(slot, &intention, &self.ports.surfaces, &[])
    }

    /// Pointer move during an edit gesture. `pressed`: the left button is still down (a
    /// release the window never saw ends the gesture like a lost pointer capture).
    pub(crate) fn edit_move(
        &mut self,
        pos: (f32, f32),
        pressed: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut g) = self.edit.gesture.clone() else {
            return false;
        };
        if !pressed {
            self.edit_cancel_gesture(cx);
            return true;
        }
        let now = geppui::now(cx);
        if pos.0 != g.pointer.0 {
            g.dir_x = (pos.0 - g.pointer.0).signum();
        }
        g.pointer = pos;
        if !g.lifted && g.distance() >= 5.0 {
            match &g.kind {
                GestureKind::Move => match self.session.pickup(
                    &g.id,
                    geppio_core::layout::Gesture::Move,
                    &self.ports.surfaces,
                ) {
                    Ok(zones) => {
                        g.zones = zones;
                        g.lifted = true;
                        g.lifted_at = now;
                    }
                    Err(_) => {
                        self.edit.gesture = None;
                        return true;
                    }
                },
                GestureKind::Catalog(type_id) => {
                    self.edit.suppress_click = true;
                    let zones = self.catalog_zones(type_id);
                    if zones.is_empty() {
                        // A refused lift shakes the tile (`rejection`).
                        self.edit.gesture = None;
                        if !geppui::appearance(cx).reduced_motion {
                            let id = self.intern(type_id);
                            self.edit.shake = Some((id, now));
                        }
                        self.edit.toast(
                            "Não há área compatível com espaço disponível para este widget.",
                            now,
                        );
                        cx.notify();
                        return true;
                    }
                    self.session.begin_catalog_drag();
                    g.zones = zones;
                    g.lifted = true;
                    g.lifted_at = now;
                }
                GestureKind::Resize(_) => {}
            }
        }
        if g.lifted {
            let resize = matches!(g.kind, GestureKind::Resize(_));
            if !resize {
                // Hovering another rail bar for 250 ms switches to it (`hoverBar`).
                let bar = self.rail_bar_at(pos);
                if bar.as_deref() != self.edit.dwell.as_ref().map(|(b, _)| b.as_str()) {
                    let active = self.session.draft().organization.active_bar.clone();
                    self.edit.dwell = bar.map(|b| {
                        let at = if b == active { f64::INFINITY } else { now };
                        (b, at)
                    });
                }
            }
            let over = self.region_at(pos, &g.zones);
            for r in Region::ALL {
                let target = if over == Some(r) { 1.0 } else { 0.0 };
                let d = geppui::appearance(cx).duration(motion::duration::DROP_ZONE);
                self.edit.zone_over[zone_index(r)].request(target, d, motion::EASE);
            }
            self.edit.over = over;
            // The slot under the pointer is highlighted only when it accepts the drag.
            let slot = if resize { None } else { self.slot_at(pos) };
            g.hover_slot = match (slot, g.hover_slot.take()) {
                (Some(s), Some(prev)) if prev.0 == s.id => Some(prev),
                (Some(s), _) => {
                    let takes = self.slot_takes(&s.id, &g);
                    Some((s.id, takes))
                }
                (None, _) => None,
            };
            self.edit.insertion =
                if over == Some(Region::Sidebar) && g.hover_slot.is_none() && !resize {
                    let (_, y) = self.content_at(Region::Sidebar, pos);
                    Some(self.session.sidebar_insertion_line(y) as f32)
                } else {
                    None
                };
            let (sx, sy) = g.region.map_or((0.0, 0.0), |r| self.scroll(r));
            let (dx, dy) = (
                (pos.0 - g.down.0 + sx - g.scroll0.0 + g.extension) as f64,
                (pos.1 - g.down.1 + sy - g.scroll0.1) as f64,
            );
            let over_origin = over.is_none() || over == g.region;
            let frame = PointerFrame {
                dx,
                dy,
                over_origin,
            };
            let preview = match &g.kind {
                GestureKind::Move if g.region != Some(Region::Sidebar) => {
                    self.session.preview_move(frame, &self.ports.surfaces).ok()
                }
                GestureKind::Resize(_) => self
                    .session
                    .preview_resize(frame, &self.ports.surfaces)
                    .ok(),
                _ => None,
            };
            if let Some(p) = &preview {
                self.edit.blocked =
                    (p.status == geppio_core::layout::Status::Blocked).then(|| g.id.clone());
            }
            g.guides = preview.map(|p| p.guides).unwrap_or_default();
        }
        self.edit.gesture = Some(g);
        cx.notify();
        true
    }

    /// Per frame while a drag is lifted: the 250 ms bar switch, the Sidebar edge scroll
    /// (28px band, 7px) and the expanded Main edge scroll (30px band, up to 20px). Returns
    /// whether it scrolled, so the host keeps requesting frames.
    pub(crate) fn edit_tick(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(g) = self.edit.gesture.clone().filter(|g| g.lifted) else {
            return false;
        };
        let now = geppui::now(cx);
        if let Some((bar, since)) = self.edit.dwell.clone()
            && since.is_finite()
            && now - since >= 250.0
        {
            self.edit.dwell = Some((bar.clone(), f64::INFINITY));
            if self.session.hover_bar(&bar) {
                let zones = match &g.kind {
                    GestureKind::Move => self.session.move_zones(&self.ports.surfaces),
                    GestureKind::Catalog(type_id) => self.catalog_zones(type_id),
                    GestureKind::Resize(_) => g.zones.clone(),
                };
                if let Some(live) = &mut self.edit.gesture {
                    live.zones = zones;
                }
                self.edit_move(g.pointer, true, cx);
            }
        }
        let resize = matches!(g.kind, GestureKind::Resize(_));
        let m = self.metrics;
        if !resize && self.edit.over == Some(Region::Sidebar) && g.hover_slot.is_none() {
            let port = self.ports.sidebar;
            let (top, bottom) = (
                port.y - shell::SPACE_Y as f32,
                port.bottom() + shell::SPACE_Y as f32,
            );
            let delta = if g.pointer.1 < top + 28.0 {
                -7.0
            } else if g.pointer.1 > bottom - 28.0 {
                7.0
            } else {
                0.0
            };
            if delta != 0.0 {
                let max = m.css(self.sidebar_scroll.max_offset().y).max(0.0);
                let current = -m.css(self.sidebar_scroll.offset().y);
                let next = (current + delta).clamp(0.0, max);
                if (next - current).abs() > 0.01 {
                    self.sidebar_scroll
                        .set_offset(gpui::point(gpui::px(0.0), -m.px(next)));
                    self.edit_move(g.pointer, true, cx);
                    return true;
                }
            }
        }
        let horizontal = match &g.kind {
            GestureKind::Move => true,
            GestureKind::Resize(d) => d.as_str().contains(['e', 'w']),
            GestureKind::Catalog(_) => false,
        };
        if self.ports.surfaces.expanded && g.region == Some(Region::Main) && horizontal {
            let r = self.ports.main;
            let (x, y) = g.pointer;
            if y >= r.y && y <= r.bottom() {
                let right = r.right();
                let delta = if x > right - 30.0 && x <= right + 30.0 {
                    ((x - right + 30.0) / 2.0).min(20.0)
                } else if x < r.x + 30.0 && x >= r.x - 30.0 {
                    -((r.x + 30.0 - x) / 2.0).min(20.0)
                } else {
                    0.0
                };
                if delta != 0.0 && delta.signum() == g.dir_x {
                    let max = m.css(self.main_scroll.max_offset().x).max(0.0);
                    let current = -m.css(self.main_scroll.offset().x);
                    let next = (current + delta).clamp(0.0, max);
                    let unscrolled = delta - (next - current);
                    let y_offset = self.main_scroll.offset().y;
                    self.main_scroll
                        .set_offset(gpui::point(-m.px(next), y_offset));
                    let limit = geppio_core::layout::policy::MAX_COORDINATE as f32;
                    if let Some(live) = &mut self.edit.gesture {
                        live.extension = (live.extension + unscrolled).clamp(-limit, limit);
                    }
                    let before = self.frame_rects();
                    self.edit_move(g.pointer, true, cx);
                    let moved = self.frame_rects() != before;
                    return (next - current).abs() > 0.01 || moved;
                }
            }
        }
        false
    }

    /// The flight of a drag that ends: to its frame when accepted, back otherwise (a
    /// catalog insertion shrinks into its tile).
    fn fly(&mut self, g: &UiGesture, accepted: Option<(String, Rect)>, now: f64, reduced: bool) {
        if reduced {
            return;
        }
        let from = g.picture(now, reduced);
        let (view, to, shrink) = match accepted {
            Some((id, rect)) => (Some(id), rect, false),
            None if matches!(g.kind, GestureKind::Catalog(_)) && g.moving.is_none() => {
                let tile = g.tile.unwrap_or(Rect::new(
                    from.x + from.w / 2.0,
                    from.y + from.h / 2.0,
                    1.0,
                    1.0,
                ));
                let k = (tile.w / from.w).min(tile.h / from.h).max(0.01);
                (
                    None,
                    Rect::new(tile.x, tile.y, from.w * k, from.h * k),
                    true,
                )
            }
            None => (
                g.moving.clone().or_else(|| Some(g.id.clone())),
                g.origin,
                false,
            ),
        };
        let compact = view
            .as_deref()
            .is_some_and(|id| self.frame_region(id) == Some(Region::Bottom));
        self.edit.flight = Some(Flight {
            view,
            fixture: g.fixture.clone(),
            compact,
            tween: geppui::Tween {
                from,
                to,
                start_ms: now,
                duration_ms: if shrink {
                    220.0
                } else {
                    motion::duration::FLIGHT
                },
                easing: motion::FLIGHT,
            },
            shrink,
        });
    }

    /// The window rectangle of a view after an action, or of the frame a drop added.
    fn landed(&self, before: &[String], id: Option<&str>) -> Option<(String, Rect)> {
        self.frame_rects()
            .into_iter()
            .find(|(v, _)| id.map_or(!before.contains(v), |id| v == id))
    }

    /// Pointer release of an edit gesture at `pos` (window CSS px; the release point decides
    /// the drop, also outside the window).
    pub(crate) fn edit_up(&mut self, pos: (f32, f32), cx: &mut Context<Self>) -> bool {
        let Some(mut g) = self.edit.gesture.take() else {
            return false;
        };
        if g.lifted {
            g.pointer = pos;
        }
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        self.edit.over = None;
        self.edit.insertion = None;
        self.edit.dwell = None;
        for z in &mut self.edit.zone_over {
            z.jump(0.0);
        }
        if !g.lifted {
            // A short click on the grip opens the catalog's move mode (`select`); a tile's
            // click is handled by the tile itself.
            if g.kind == GestureKind::Move && g.grip {
                self.select_for_move(&g.id, cx);
            }
            cx.notify();
            return true;
        }
        let before: Vec<String> = self.frame_rects().into_iter().map(|(id, _)| id).collect();
        let slot = g
            .hover_slot
            .as_ref()
            .and_then(|(id, _)| self.session_slots().into_iter().find(|s| s.id == *id));
        match &g.kind {
            GestureKind::Resize(_) => {
                let _ = self.session.commit_gesture();
                self.edit.blocked = None;
                let message = self.session.message().to_owned();
                self.edit.rearm(&message, now);
            }
            GestureKind::Move if slot.is_some() => {
                let slot = slot.expect("slot under the pointer");
                let _ = self.session.cancel_gesture();
                let source_bar = self.session.draft().organization.active_bar.clone();
                let ok = self.fill_chosen(
                    &slot.id,
                    SlotIntention::Move {
                        view_id: g.id.clone(),
                        source_bar,
                    },
                    None,
                    cx,
                );
                if !ok {
                    self.edit.rearm(
                        "Destino incompatível. A composição anterior foi preservada.",
                        now,
                    );
                }
                let landed = if ok {
                    self.landed(&before, Some(&g.id))
                } else {
                    None
                };
                self.fly(&g, landed, now, reduced);
            }
            GestureKind::Catalog(type_id) if slot.is_some() => {
                let slot = slot.expect("slot under the pointer");
                let ok =
                    self.fill_chosen(&slot.id, SlotIntention::Catalog(type_id.clone()), None, cx);
                self.session.finish_catalog_drag(ok);
                let landed = if ok {
                    self.landed(&before, g.moving.as_deref())
                } else {
                    None
                };
                self.fly(&g, landed, now, reduced);
            }
            GestureKind::Move => {
                let surfaces = self.ports.surfaces;
                let target = self
                    .region_under(g.pointer)
                    .filter(|r| Some(*r) != g.region || *r == Region::Sidebar);
                let result = match target {
                    Some(r) => {
                        let at = self.content_at(r, g.pointer);
                        let rects = self.frame_rects();
                        let result = self.session.drop_into(r, at, &surfaces);
                        let after = self.frame_rects();
                        self.edit.flips = flips_between(&rects, &after, now, reduced, Some(&g.id));
                        result
                    }
                    None => self.session.commit_gesture(),
                };
                self.edit.blocked = result.is_err().then(|| g.id.clone());
                let message = self.session.message().to_owned();
                self.edit.rearm(&message, now);
                let landed = if result.is_ok() {
                    self.landed(&before, Some(&g.id))
                } else {
                    None
                };
                self.fly(&g, landed, now, reduced);
            }
            GestureKind::Catalog(type_id) => {
                let target = self.region_at(g.pointer, &g.zones);
                let ok = match target {
                    Some(r) => {
                        let at = self.content_at(r, g.pointer);
                        let surfaces = self.ports.surfaces;
                        self.session
                            .add_widget(type_id, r, Some(at), &surfaces, &[])
                            .is_ok()
                    }
                    None => false,
                };
                self.session.finish_catalog_drag(ok);
                let message = self.session.message().to_owned();
                self.edit.rearm(&message, now);
                let landed = if ok {
                    self.landed(&before, g.moving.as_deref())
                } else {
                    None
                };
                self.fly(&g, landed, now, reduced);
            }
        }
        cx.notify();
        true
    }

    /// Ends a gesture without a drop (Escape, lost capture, window blur, a window, catalog
    /// or expansion change): the preview is restored and a lifted picture flies back.
    pub(crate) fn edit_cancel_gesture(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(g) = self.edit.gesture.take() else {
            return false;
        };
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        self.edit.over = None;
        self.edit.insertion = None;
        self.edit.dwell = None;
        for z in &mut self.edit.zone_over {
            z.jump(0.0);
        }
        if g.lifted {
            match &g.kind {
                GestureKind::Catalog(_) => {
                    self.session.finish_catalog_drag(false);
                    if let Some((message, _)) = self.edit.toast.clone() {
                        self.edit.rearm(&message, now);
                    }
                    self.fly(&g, None, now, reduced);
                }
                GestureKind::Move | GestureKind::Resize(_) => {
                    let _ = self.session.cancel_gesture();
                    self.edit
                        .rearm("Gesto cancelado. A prévia anterior foi restaurada.", now);
                    if g.kind == GestureKind::Move {
                        self.fly(&g, None, now, reduced);
                    }
                }
            }
            self.edit.blocked = None;
        }
        cx.notify();
        true
    }

    /// A short click on a frame's grip: the catalog opens on Widgets with the destination
    /// box moving this view (`select`, `moveRequest`).
    pub(crate) fn select_for_move(&mut self, view: &str, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let Some(type_id) = self.session.draft().type_of(view).map(str::to_owned) else {
            return;
        };
        if self.edit.catalog.slot.is_some() {
            self.choose_slot(None, cx);
        }
        if !self.edit.catalog_open {
            self.edit.set_catalog(true, now, reduced);
        }
        let id = self.intern(&type_id);
        let catalog = &mut self.edit.catalog;
        catalog.tab = CatalogTab::Widgets;
        catalog.plugin_menu = false;
        catalog.destination = Some(id);
        catalog.moving = Some(view.to_owned());
        self.edit.focus = Some(FocusRequest::Destination);
        cx.notify();
    }

    /// Escape: cancel a gesture (flying back), then the search, the plugin filter, the
    /// slot choice, the destination box and the peek, and finally leave Edit.
    pub(crate) fn edit_escape(&mut self, cx: &mut Context<Self>) -> bool {
        if self.edit_cancel_gesture(cx) {
            return true;
        }
        if self.edit.search_focused {
            // `input[type=search]`: Escape clears the text first, then leaves the field.
            if self.edit.search.read(cx).text().is_empty() {
                self.edit.focus = Some(FocusRequest::Workbench);
            } else {
                self.edit
                    .search
                    .update(cx, |field, cx| field.set_text("", cx));
                self.edit.catalog.search.clear();
            }
            cx.notify();
            return true;
        }
        if self.edit.catalog.plugin_menu {
            self.edit.catalog.plugin_menu = false;
            cx.notify();
            return true;
        }
        if self.edit.catalog.slot.is_some() {
            self.cancel_slot_choice(cx);
            return true;
        }
        if self.edit.catalog.destination.is_some() {
            self.edit.catalog.destination = None;
            self.edit.catalog.moving = None;
            cx.notify();
            return true;
        }
        if self.clear_swap_selection() {
            cx.notify();
            return true;
        }
        if self.regions.peek {
            return false;
        }
        if self.editing() {
            self.edit_command("cancel", cx);
            return true;
        }
        false
    }

    /// Keyboard of edit mode. Returns true when the key was handled. Text fields keep their
    /// own Ctrl+Z.
    pub(crate) fn edit_key(&mut self, e: &KeyDownEvent, cx: &mut Context<Self>) -> bool {
        let k = &e.keystroke;
        if !self.editing() {
            return false;
        }
        let ctrl = k.modifiers.control || k.modifiers.platform;
        match (k.key.as_str(), ctrl, k.modifiers.shift) {
            ("z", true, false) => self.edit_command("undo", cx),
            ("y", true, _) | ("z", true, true) => self.edit_command("redo", cx),
            _ => return false,
        }
        true
    }

    fn frame_region(&self, id: &str) -> Option<Region> {
        scene(&self.session, &self.ports.surfaces)
            .1
            .into_iter()
            .find(|f| f.id == id)
            .map(|f| f.region)
    }

    // ---- catalog ----------------------------------------------------------------------------

    /// Catalog entries of the demonstration widgets with live availability per area, the
    /// presences and the reasons (`EditorPanel.tsx`, `useCatalogAvailability`).
    pub(crate) fn tiles(&self) -> Vec<Tile> {
        let registry = self.session.registry();
        let surfaces = self.ports.surfaces;
        let (view, _) = self.session.view(&surfaces);
        let draft = self.session.draft();
        let panel_active = !panel_ids(draft).is_empty();
        let active_bar = draft.organization.active_bar.clone();
        let bar_members: Vec<String> = draft
            .organization
            .bars
            .iter()
            .find(|b| b.id == active_bar)
            .map(|b| b.members.clone())
            .unwrap_or_default();
        let slots = self.session.slots().to_vec();
        let chosen = self
            .edit
            .catalog
            .slot
            .as_ref()
            .and_then(|id| self.session_slots().into_iter().find(|s| s.id == *id));
        let placements = geppio_core::workbench::model::surface_placements(&view);
        registry
            .types()
            .iter()
            .filter(|t| t.fixture.is_some() && !t.retired && !t.missing)
            .filter(|t| chosen.as_ref().is_none_or(|s| t.constraint.allows(s.region)))
            .map(|t| {
                let allowed: Vec<Area> = Region::ALL
                    .into_iter()
                    .filter(|r| t.constraint.allows(*r))
                    .map(area)
                    .collect();
                let mut presences: Vec<(String, Area)> = placements
                    .iter()
                    .filter(|p| {
                        view.type_of(&p.id) == Some(t.id.as_str())
                            && (p.region != Region::Sidebar || bar_members.contains(&t.id))
                    })
                    .map(|p| (p.id.clone(), area(p.region)))
                    .collect();
                presences.sort_by_key(|(_, a)| *a);
                let available: Vec<Area> = Region::ALL
                    .into_iter()
                    .filter(|r| !(panel_active && *r == Region::Main))
                    .filter(|r| {
                        geppio_core::workbench::commands::add_widget(
                            &view,
                            registry,
                            &t.id,
                            &surfaces.surface(*r),
                            None,
                            &[],
                            None,
                        )
                        .is_some()
                            || slots.iter().any(|s| {
                                s.region == *r
                                    && self.session.slot_accepts(
                                        &s.id,
                                        &SlotIntention::Catalog(t.id.clone()),
                                        &surfaces,
                                        &[],
                                    )
                            })
                    })
                    .map(area)
                    .collect();
                let eval = |r: Region| {
                    evaluate_placement(&view, registry, &t.id, r, Operation::Catalog, &[], &[])
                };
                let limit = Region::ALL
                    .into_iter()
                    .filter(|r| t.constraint.allows(*r))
                    .any(|r| eval(r) == Err(PlacementRefusal::Limit));
                let occupied = !Region::ALL
                    .into_iter()
                    .filter(|r| t.constraint.allows(*r))
                    .any(|r| eval(r).is_ok());
                let unavailable = crate::i18n::t(if limit {
                    "Limite de views atingido. Reutilize uma view existente."
                } else if occupied {
                    "Este widget já está em todas as áreas permitidas. Mova o widget existente para reorganizar."
                } else {
                    "Não há área compatível com espaço disponível para este widget."
                });
                let reason = chosen.as_ref().and_then(|s| {
                    let min =
                        geppio_core::freeform::constraint_in_region(&t.constraint, s.region).min;
                    let text = match eval(s.region) {
                        Err(PlacementRefusal::Paused) => "Plugin pausado",
                        Err(PlacementRefusal::Limit) => {
                            "Limite de views atingido. Reutilize uma view existente."
                        }
                        Err(_) => "Este widget já está nesta área.",
                        Ok(()) if min.width > s.width || min.height > s.height => {
                            "O espaço é menor que o mínimo deste widget."
                        }
                        Ok(()) => {
                            if self.session.slot_accepts(
                                &s.id,
                                &SlotIntention::Catalog(t.id.clone()),
                                &surfaces,
                                &[],
                            ) {
                                return None;
                            }
                            "Não há espaço disponível para os mínimos deste widget."
                        }
                    };
                    Some(crate::i18n::t(text))
                });
                Tile {
                    id: self.intern(&t.id),
                    title: self.intern(&t.title),
                    category: self.intern(&t.category),
                    owner: self.intern(&t.owner),
                    reason,
                    available,
                    allowed,
                    presences,
                    unavailable,
                }
            })
            .collect()
    }

    /// Interns the small fixed set of catalog strings (the demo registry) once.
    pub(crate) fn intern(&self, id: &str) -> &'static str {
        thread_local! { static IDS: std::cell::RefCell<HashMap<String, &'static str>> = Default::default(); }
        IDS.with(|ids| {
            *ids.borrow_mut()
                .entry(id.to_owned())
                .or_insert_with(|| Box::leak(id.to_owned().into_boxed_str()))
        })
    }

    /// The destination box of the chosen tile or of a view being moved (`destinationReason`).
    fn destination(&self, tiles: &[Tile]) -> Option<Destination> {
        let id = self.edit.catalog.destination?;
        let tile = tiles.iter().find(|t| t.id == id)?;
        let registry = self.session.registry();
        let ty = registry.get(id)?;
        let surfaces = self.ports.surfaces;
        let (view, _) = self.session.view(&surfaces);
        let moving = self.edit.catalog.moving.clone();
        let ignored: Vec<&str> = moving.iter().map(String::as_str).collect();
        let operation = if moving.is_some() {
            Operation::Move
        } else {
            Operation::Catalog
        };
        let reasons = Area::ALL.map(|a| {
            let r = region(a);
            let text = match evaluate_placement(&view, registry, id, r, operation, &ignored, &[]) {
                Err(PlacementRefusal::Paused) => Some("Plugin pausado"),
                Err(PlacementRefusal::Incompatible) => Some("Widget incompatível com esta área."),
                Err(PlacementRefusal::Limit) => {
                    Some("Limite de views atingido. Reutilize uma view existente.")
                }
                Err(PlacementRefusal::Occupied) => Some(if r == Region::Sidebar {
                    "Este widget já está nesta barra."
                } else {
                    "Este widget já está nesta área."
                }),
                Ok(()) => {
                    let fits = match &moving {
                        Some(v) => geppio_core::workbench::commands::move_view(
                            &view,
                            registry,
                            v,
                            &surfaces.surface(r),
                            None,
                            None,
                            None,
                            &[],
                        )
                        .is_some(),
                        None => tile.available.contains(&a),
                    };
                    (!fits).then_some("Não há espaço disponível para os mínimos deste widget.")
                }
            };
            text.map(crate::i18n::t)
        });
        Some(Destination {
            title: crate::i18n::t("Onde colocar {0}?")
                .replace("{0}", &crate::i18n::t(tile.title))
                .into(),
            policy: crate::i18n::t(if moving.is_some() || ty.presence == Presence::SingleView {
                "Este widget tem uma única presença. Escolha para onde mover."
            } else {
                "Este widget compartilha os dados entre presenças em áreas diferentes."
            }),
            reasons,
        })
    }

    /// The first enabled destination area (focus goes there when the box opens).
    pub(crate) fn first_destination(&self, tiles: &[Tile]) -> Option<Area> {
        let d = self.destination(tiles)?;
        Area::ALL
            .into_iter()
            .zip(d.reasons)
            .find(|(_, reason)| reason.is_none())
            .map(|(a, _)| a)
    }

    /// Places the destination's widget (`add`) or moves the selected view (`transferTo`).
    /// A refusal keeps the box open with the reason.
    fn place_destination(&mut self, a: Area, cx: &mut Context<Self>) {
        let Some(id) = self.edit.catalog.destination else {
            return;
        };
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let surfaces = self.ports.surfaces;
        let r = region(a);
        let moving = self.edit.catalog.moving.clone();
        let before = self.frame_rects();
        let result = match &moving {
            Some(view) => self.session.transfer_view(view, r, None, &surfaces),
            None => self.session.add_widget(id, r, None, &surfaces, &[]),
        };
        let after = self.frame_rects();
        self.edit.flips = flips_between(&before, &after, now, reduced, None);
        match result {
            Ok(()) => {
                self.edit.catalog.destination = None;
                self.edit.catalog.moving = None;
                if let Some(view) = &moving {
                    self.edit.blocked = None;
                    let message = self.session.message().to_owned();
                    self.edit.toast(&message, now);
                    // The Sidebar scrolls to the moved frame.
                    if r == Region::Sidebar
                        && let Some(f) = scene(&self.session, &self.ports.surfaces)
                            .1
                            .into_iter()
                            .find(|f| f.id == *view)
                    {
                        let m = self.metrics;
                        self.sidebar_scroll
                            .set_offset(gpui::point(gpui::px(0.0), -m.px(f.rect.y)));
                    }
                }
            }
            Err(_) => {
                if let Some(view) = moving {
                    self.edit.blocked = Some(view);
                }
                let message = self.session.message().to_owned();
                self.edit.toast(&message, now);
            }
        }
        cx.notify();
    }

    fn catalog_actions(&self, cx: &mut Context<Self>) -> CatalogActions {
        let view = cx.entity().downgrade();
        let w = |f: fn(&mut Workbench, &mut Context<Workbench>)| -> catalog::Click {
            let view = view.clone();
            Rc::new(move |_, _, cx| {
                let _ = view.update(cx, f);
            })
        };
        let (v1, v2, v3, v4, v5, v6, v7) = (
            view.clone(),
            view.clone(),
            view.clone(),
            view.clone(),
            view.clone(),
            view.clone(),
            view.clone(),
        );
        CatalogActions {
            select_tab: Rc::new(move |tab, _, cx| {
                let _ = v1.update(cx, |this, cx| {
                    if let Some(saved) = &mut this.edit.catalog.saved {
                        saved.tab = tab;
                    }
                    if this.edit.catalog.slot.is_some() {
                        this.choose_slot(None, cx);
                    }
                    this.edit.catalog.tab = tab;
                    this.edit.catalog.plugin_menu = false;
                    cx.notify();
                });
            }),
            toggle_plugin_menu: w(|this, cx| {
                this.edit.catalog.plugin_menu = !this.edit.catalog.plugin_menu;
                cx.notify();
            }),
            explore: w(|this, cx| {
                this.set_menu(Some(crate::panels::Menu::Plugins), None, None, cx)
            }),
            cancel_slot: w(|this, cx| this.cancel_slot_choice(cx)),
            clear_filters: w(|this, cx| {
                let region = this
                    .edit
                    .catalog
                    .slot
                    .as_ref()
                    .and_then(|id| this.session.slots().iter().find(|s| s.id == *id))
                    .map(|s| area(s.region));
                let c = &mut this.edit.catalog;
                c.search.clear();
                c.areas = region.into_iter().collect();
                c.plugin = None;
                c.category = None;
                this.edit
                    .search
                    .update(cx, |field, cx| field.set_text("", cx));
                cx.notify();
            }),
            toggle_area: Rc::new(move |a, _, cx| {
                let _ = v2.update(cx, |this, cx| {
                    let areas = &mut this.edit.catalog.areas;
                    match a {
                        None => areas.clear(),
                        Some(a) => {
                            if let Some(i) = areas.iter().position(|x| *x == a) {
                                areas.remove(i);
                            } else {
                                areas.push(a);
                            }
                            if areas.len() == 3 {
                                areas.clear();
                            }
                        }
                    }
                    cx.notify();
                });
            }),
            choose_category: Rc::new(move |c, _, cx| {
                let _ = v3.update(cx, |this, cx| {
                    this.edit.catalog.category = c;
                    cx.notify();
                });
            }),
            choose_tile: Rc::new(move |id, _, cx| {
                let _ = v4.update(cx, |this, cx| {
                    // The click that ends a drag (or a refused lift) is not a choice.
                    if std::mem::take(&mut this.edit.suppress_click) {
                        return;
                    }
                    if let Some(slot) = this.edit.catalog.slot.clone() {
                        this.fill_chosen(&slot, SlotIntention::Catalog(id.to_owned()), None, cx);
                        return;
                    }
                    let tile = this.tiles().into_iter().find(|t| t.id == id);
                    match tile {
                        Some(t) if !t.available.is_empty() => {
                            this.edit.catalog.destination = Some(id);
                            this.edit.catalog.moving = None;
                            this.edit.focus = Some(FocusRequest::Destination);
                        }
                        Some(t) => {
                            let now = geppui::now(cx);
                            this.edit.toast(&t.unavailable, now);
                        }
                        None => {}
                    }
                    cx.notify();
                });
            }),
            place: Rc::new(move |a, _, cx| {
                let _ = v5.update(cx, |this, cx| this.place_destination(a, cx));
            }),
            press_tile: Rc::new(move |id, e: &MouseDownEvent, _, cx| {
                let _ = v6.update(cx, |this, cx| {
                    let z = this.metrics.zoom;
                    this.tile_down(
                        id,
                        (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                        cx,
                    );
                });
            }),
            remove_presence: Rc::new(move |id, _, cx| {
                let _ = v7.update(cx, |this, cx| {
                    if let Some(saved) = &mut this.edit.catalog.saved {
                        saved.tab = CatalogTab::Widgets;
                    }
                    if this.edit.catalog.slot.is_some() {
                        this.choose_slot(None, cx);
                    }
                    this.removing = Some(id);
                    cx.notify();
                });
            }),
            inside: {
                let view = view.clone();
                Rc::new(move |_, cx| {
                    let _ = view.update(cx, |this, _| this.edit.keep_destination = true);
                })
            },
            close_destination: w(|this, cx| {
                if std::mem::take(&mut this.edit.keep_destination) {
                    return;
                }
                if this.edit.catalog.destination.is_some() {
                    this.edit.catalog.destination = None;
                    this.edit.catalog.moving = None;
                    cx.notify();
                }
            }),
        }
    }

    // ---- rendering --------------------------------------------------------------------------

    pub(crate) fn scroll_handle(&mut self, id: &str) -> ScrollHandle {
        self.scrolls.entry(id.to_owned()).or_default().clone()
    }

    /// Updates the Propriedades demo model; content is inert while editing.
    pub(crate) fn props_handler(
        &self,
        cx: &mut Context<Self>,
    ) -> impl Fn(Properties, &mut gpui::App) + Clone + 'static {
        let view = cx.entity().downgrade();
        let inert = self.editing();
        move |p, cx| {
            if inert {
                return;
            }
            let _ = view.update(cx, |this, cx| {
                this.properties = p;
                this.record_local(cx);
                cx.notify();
            });
        }
    }

    /// The frames of one region inside its port, in port coordinates.
    /// "Filtrar widgets por plugin" (`.catalog-plugin-filter`).
    fn plugin_filter(&mut self, m: Metrics, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let tr = crate::i18n::tr(cx);
        let mut owners: Vec<&'static str> = Vec::new();
        for tile in self.tiles() {
            if !owners.contains(&tile.owner) {
                owners.push(tile.owner);
            }
        }
        let selected = self.edit.catalog.plugin.filter(|p| owners.contains(p));
        let close = Rc::new(cx.listener(|this, _: &(), _, cx| {
            this.edit.catalog.plugin_menu = false;
            cx.notify();
        }));
        let (c1, c2) = (close.clone(), close);
        let row = |owner: Option<&'static str>| {
            let checked = selected == owner;
            div()
                .id(SharedString::from(format!(
                    "catalog-plugin-{}",
                    owner.unwrap_or("all")
                )))
                .flex()
                .items_center()
                .gap(m.px(11.0))
                .min_h(m.px(38.0))
                .px(m.px(11.0))
                .py(m.px(9.0))
                .rounded(m.px(7.0))
                .text_size(m.px(12.0))
                .when(checked, |el| el.bg(t.accent_soft))
                .when(!checked, |el| el.hover(move |s| s.bg(t.control_hover)))
                .cursor_pointer()
                .on_click(cx.listener(move |this, _, _, cx| {
                    let c = &mut this.edit.catalog;
                    c.plugin = owner;
                    c.category = None;
                    c.plugin_menu = false;
                    cx.notify();
                }))
                .child(
                    geppui::icon("squares-2x2", m)
                        .size(18.0)
                        .color(t.text_muted),
                )
                .child(div().flex_1().child(catalog::owner_name(owner)))
                .child(
                    div()
                        .text_color(t.accent)
                        .when(!checked, |el| el.opacity(0.0))
                        .child("✓"),
                )
        };
        geppui::popover("catalog-plugin-filter-menu", &self.edit.filter_anchor)
            .width(260.0)
            .padding(9.0, 9.0)
            .on_dismiss(move |w, cx| c1(&(), w, cx))
            .on_escape(move |w, cx| c2(&(), w, cx))
            .child(
                div().mx(m.px(9.0)).mt(m.px(3.0)).mb(m.px(9.0)).child(
                    geppui::spaced_text(tr.t("Filtrar por plugin").to_uppercase(), m)
                        .size(10.0, 16.0)
                        .weight(geppui::css_weight(650.0))
                        .color(t.text_muted)
                        .letter_spacing_em(0.09),
                ),
            )
            .child(row(None))
            .children(owners.into_iter().map(|o| row(Some(o))))
            .into_any_element()
    }

    /// The dashed "Adicionar widget · Espaço N" buttons of a region's slots
    /// (`.layout-empty-slot`), in content coordinates.
    fn slot_buttons(
        &mut self,
        region: Region,
        m: Metrics,
        t: Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        if !self.editing() {
            return Vec::new();
        }
        let tr = crate::i18n::tr(cx);
        let chosen = self.edit.catalog.slot.clone();
        // A slot under a drag is highlighted only when it accepts it (`data-drag-hover`).
        let over = self
            .edit
            .gesture
            .as_ref()
            .filter(|g| g.lifted)
            .and_then(|g| g.hover_slot.clone())
            .filter(|(_, takes)| *takes)
            .map(|(id, _)| id);
        let now = geppui::now(cx);
        // The chosen slot pulses once (box-shadow 0 → 5px → 0 over 520ms).
        let pulse = self.edit.slot_motion.map(|at| {
            let p = ((now - at) / 520.0).clamp(0.0, 1.0);
            let e = motion::REGION.ease(p) as f32;
            if e < 0.35 {
                e / 0.35 * 5.0
            } else {
                (1.0 - (e - 0.35) / 0.65) * 5.0
            }
        });
        let slots: Vec<SessionSlot> = self
            .session_slots()
            .into_iter()
            .filter(|s| s.region == region)
            .collect();
        slots
            .iter()
            .enumerate()
            .map(|(i, slot)| {
                let selected = chosen.as_deref() == Some(slot.id.as_str())
                    || over.as_deref() == Some(slot.id.as_str());
                let p = m.place(Rect::new(
                    slot.x as f32,
                    slot.y as f32,
                    slot.width as f32,
                    slot.height as f32,
                ));
                let id = slot.id.clone();
                let color = if selected { t.accent } else { t.text_muted };
                let group = SharedString::from(format!("slot-{id}"));
                let key = format!("session-slot-{id}");
                let focus = catalog::control_focus(&key, window, cx);
                let ring = t.ring;
                let spread = pulse.filter(|_| chosen.as_deref() == Some(slot.id.as_str()));
                div()
                    .id(SharedString::from(key))
                    .track_focus(&focus)
                    .focus_visible(move |s| {
                        s.shadow(vec![
                            gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), ring)
                                .spread_radius(gpui::px(2.0)),
                        ])
                    })
                    .when_some(spread, |el, spread| {
                        el.shadow(vec![
                            gpui::BoxShadow::new(m.px(0.0), m.px(0.0), t.accent_soft)
                                .spread_radius(m.px(spread)),
                        ])
                    })
                    .group(group.clone())
                    .absolute()
                    .left(p.left)
                    .top(p.top)
                    .w(p.width)
                    .h(p.height)
                    .rounded(m.px(11.0))
                    .overflow_hidden()
                    .bg(if selected {
                        t.accent_soft
                    } else {
                        t.surface.opacity(0.55)
                    })
                    .hover(move |s| s.bg(t.accent_soft))
                    .cursor_pointer()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let now = geppui::now(cx);
                        let reduced = geppui::appearance(cx).reduced_motion;
                        if !this.edit.catalog_open {
                            this.edit.set_catalog(true, now, reduced);
                            if this.edit.catalog.slot.as_deref() != Some(id.as_str()) {
                                this.choose_slot(Some(id.clone()), cx);
                            }
                        } else if this.edit.catalog.slot.as_deref() == Some(id.as_str()) {
                            this.choose_slot(None, cx);
                        } else {
                            this.choose_slot(Some(id.clone()), cx);
                        }
                        cx.notify();
                    }))
                    .child(
                        div()
                            .absolute()
                            .size_full()
                            .child(geppui::dashed_outline(
                                slot.width,
                                slot.height,
                                m,
                                if selected { t.accent } else { t.text_muted },
                            ))
                            .group_hover(group.clone(), |s| s.opacity(0.0)),
                    )
                    .child(
                        div()
                            .absolute()
                            .size_full()
                            .opacity(0.0)
                            .group_hover(group.clone(), |s| s.opacity(1.0))
                            .child(geppui::dashed_outline(slot.width, slot.height, m, t.accent)),
                    )
                    .child(
                        div()
                            .size_full()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap(m.px(9.0))
                            .text_color(color)
                            .group_hover(group, move |s| s.text_color(t.accent))
                            .child(geppui::icon("plus", m).size(24.0).color(color))
                            .child(
                                div()
                                    .text_size(m.px(13.0))
                                    .font_weight(geppui::css_weight(500.0))
                                    .child(tr.t("Adicionar widget")),
                            )
                            .child(
                                div()
                                    .text_size(m.px(11.0))
                                    .child(tr.f("Espaço {0}", &[&(i + 1).to_string()])),
                            ),
                    )
                    .into_any_element()
            })
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn region_frames(
        &mut self,
        region: Region,
        m: Metrics,
        t: Theme,
        now: f64,
        editing: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        // The picture owns the view while it is lifted (a frame move, or a catalog drag of a
        // single-view widget that is already placed).
        let ghost = self
            .edit
            .gesture
            .as_ref()
            .filter(|g| g.lifted)
            .and_then(|g| match g.kind {
                GestureKind::Move => Some(g.id.clone()),
                GestureKind::Catalog(_) => g.moving.clone(),
                GestureKind::Resize(_) => None,
            });
        let flying = self.edit.flight.as_ref().and_then(|f| f.view.clone());
        let constraints = editing.then(|| {
            geppio_core::freeform::constraints_for(
                &self.ports.surfaces.surface(region),
                &geppio_core::workbench::model::snapshot_constraints(
                    self.session.draft(),
                    self.session.registry(),
                ),
            )
        });
        let entering = self.edit.entering.clone();
        let mut out = Vec::new();
        for f in frames.into_iter().filter(|f| f.region == region) {
            let port = self.ports.port(region);
            let (sx, sy) = self.scroll(region);
            let rect = Rect::new(
                port.x + f.rect.x - sx,
                port.y + f.rect.y - sy,
                f.rect.w,
                f.rect.h,
            );
            let shown = self.edit.flipped(&f.id, rect, now);
            let local = Rect::new(
                shown.x - port.x + sx,
                shown.y - port.y + sy,
                shown.w,
                shown.h,
            );
            let hidden =
                ghost.as_deref() == Some(f.id.as_str()) || flying.as_deref() == Some(f.id.as_str());
            let scroll = self.scroll_handle(&f.id);
            let props = self.props_handler(cx);
            let name =
                (f.fixture == "properties" && !editing).then(|| self.name_field_element(m, t));
            let content = widgets::content(
                &f.fixture,
                widgets::Fit::new(region == Region::Bottom, local.w),
                m,
                t,
                &self.properties,
                props,
                name,
                editing,
            );
            let look = widgets::FrameLook {
                selected: editing && self.edit.selected.as_deref() == Some(f.id.as_str()),
                invalid: editing && self.edit.blocked.as_deref() == Some(f.id.as_str()),
                locked: editing,
                ..Default::default()
            };
            let frame = widgets::frame(
                &f.fixture,
                region == Region::Bottom,
                m,
                t,
                content,
                &scroll,
                look,
            );
            let id = f.id.clone();
            let fixture = f.fixture.clone();
            let p = m.place(local);
            let group = SharedString::from(format!("frame-{id}"));
            // New frames of an applied composition fade in (opacity, 8px up).
            let enter = entering.as_ref().and_then(|(at, duration, ids)| {
                ids.contains(&id).then(|| {
                    let k = motion::FLIGHT.ease(((now - at) / duration).clamp(0.0, 1.0)) as f32;
                    (k, 8.0 * (1.0 - k))
                })
            });
            let mut el = div()
                .absolute()
                .left(p.left)
                .top(p.top + m.px(enter.map_or(0.0, |(_, dy)| dy)))
                .w(p.width)
                .h(p.height)
                .group(group.clone())
                .when_some(enter, |el, (k, _)| el.opacity(k))
                .when(hidden, |el| el.opacity(0.0))
                .child(frame);
            if editing {
                let (move_id, move_fixture) = (id.clone(), fixture.clone());
                el = el.child(
                    div()
                        .id(SharedString::from(format!("heading-{id}")))
                        .absolute()
                        .top_0()
                        .left_0()
                        .w_full()
                        .h(m.px(if region == Region::Bottom { 28.0 } else { 42.0 }))
                        .cursor_grab()
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                                let z = this.metrics.zoom;
                                this.frame_down(
                                    move_id.clone(),
                                    move_fixture.clone(),
                                    GestureKind::Move,
                                    false,
                                    (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                                    cx,
                                );
                                cx.stop_propagation();
                            }),
                        ),
                );
                let constraint = constraints.as_ref().and_then(|cs| cs.get(&id)).cloned();
                let title = crate::i18n::t(widgets::title(&fixture));
                for d in constraint.as_ref().map(zones_for).unwrap_or_default() {
                    let (zid, zfix) = (id.clone(), fixture.clone());
                    let key = format!("resize-{id}-{}", d.as_str());
                    let mut zone = div().id(SharedString::from(key.clone())).absolute();
                    zone = match d {
                        Direction::N => zone
                            .top_0()
                            .left(m.px(14.0))
                            .right(m.px(14.0))
                            .h(m.px(7.0))
                            .cursor_ns_resize(),
                        Direction::S => zone
                            .bottom_0()
                            .left(m.px(14.0))
                            .right(m.px(14.0))
                            .h(m.px(7.0))
                            .cursor_ns_resize(),
                        Direction::E => zone
                            .right_0()
                            .top(m.px(14.0))
                            .bottom(m.px(14.0))
                            .w(m.px(7.0))
                            .cursor_ew_resize(),
                        Direction::W => zone
                            .left_0()
                            .top(m.px(14.0))
                            .bottom(m.px(14.0))
                            .w(m.px(7.0))
                            .cursor_ew_resize(),
                        Direction::Ne => {
                            zone.top_0().right_0().size(m.px(14.0)).cursor_nesw_resize()
                        }
                        Direction::Nw => {
                            zone.top_0().left_0().size(m.px(14.0)).cursor_nwse_resize()
                        }
                        Direction::Se => zone
                            .bottom_0()
                            .right_0()
                            .size(m.px(14.0))
                            .cursor_nwse_resize(),
                        Direction::Sw => zone
                            .bottom_0()
                            .left_0()
                            .size(m.px(14.0))
                            .cursor_nesw_resize(),
                    };
                    let zone = zone.on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                            let z = this.metrics.zoom;
                            this.frame_down(
                                zid.clone(),
                                zfix.clone(),
                                GestureKind::Resize(d),
                                false,
                                (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                                cx,
                            );
                            cx.stop_propagation();
                        }),
                    );
                    // `title`: "Redimensionar pela {0}".
                    let tip: SharedString = crate::i18n::t("Redimensionar pela {0}")
                        .replace("{0}", &crate::i18n::t(zone_label(d)))
                        .into();
                    el = el.child(geppui::titled(zone, key, Some(tip)));
                }
                // Ctrl+click adds or removes the frame from the swap selection
                // (`onClickCapture` on the workbench).
                let sid = id.clone();
                el = el.capture_any_mouse_down(cx.listener(
                    move |this, e: &MouseDownEvent, _, cx| {
                        if e.button == MouseButton::Left
                            && (e.modifiers.control || e.modifiers.platform)
                        {
                            this.toggle_swap_selection(&sid, cx);
                            cx.stop_propagation();
                        }
                    },
                ));
                let swap_ring = self.edit.pairs.selected.contains(&id)
                    || self
                        .edit
                        .pairs
                        .swap
                        .as_ref()
                        .is_some_and(|d| d.target.as_deref() == Some(id.as_str()));
                let swap_control = self.swap_control(&id, &title, m, t, cx);
                let presentation = if region == Region::Main {
                    self.presentation_control(&id, false, false, m, t, cx)
                } else {
                    None
                };
                let menu_open = self
                    .edit
                    .panel
                    .menu
                    .as_ref()
                    .is_some_and(|(view, _)| *view == id);
                let rid = id.clone();
                let (grip_id, grip_fixture) = (id.clone(), fixture.clone());
                // Grip (top-left: drags, and a short click opens the move destination) and
                // the remove control (top-right) appear on frame hover.
                el = el
                    .child(
                        div()
                            .id(SharedString::from(format!("grip-{id}")))
                            .absolute()
                            .top(m.px(9.0))
                            .left(m.px(9.0))
                            .size(m.px(24.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(m.px(8.0))
                            .bg(t.surface)
                            .opacity(0.0)
                            .group_hover(group.clone(), |s| s.opacity(1.0))
                            .cursor_grab()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                                    let z = this.metrics.zoom;
                                    this.frame_down(
                                        grip_id.clone(),
                                        grip_fixture.clone(),
                                        GestureKind::Move,
                                        true,
                                        (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                                        cx,
                                    );
                                    cx.stop_propagation();
                                }),
                            )
                            .child(geppui::icon("move", m).size(14.0).color(t.text_muted)),
                    )
                    // `.widget-local-controls`: the presentation control of a Main widget
                    // and the remove control, shown on hover or while the menu is open.
                    .child(
                        div()
                            .absolute()
                            .top(m.px(9.0))
                            .right(m.px(9.0))
                            .flex()
                            .items_center()
                            .gap(m.px(4.0))
                            .when(!menu_open, |el| {
                                el.opacity(0.0)
                                    .group_hover(group.clone(), |s| s.opacity(1.0))
                            })
                            .children(presentation)
                            .child(
                                div()
                                    .id(SharedString::from(format!("remove-{id}")))
                                    .role(gpui::Role::Button)
                                    .aria_label(
                                        crate::i18n::t("Remover {0}").replace("{0}", &title),
                                    )
                                    .size(m.px(24.0))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(m.px(8.0))
                                    .bg(gpui::rgb(0xd72c42))
                                    .hover(|s| s.bg(gpui::rgb(0xb92639)))
                                    .cursor_pointer()
                                    .occlude()
                                    .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                        cx.stop_propagation()
                                    })
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.removing = Some(rid.clone());
                                        cx.notify();
                                    }))
                                    .child(
                                        geppui::icon("x-mark", m).size(14.0).color(gpui::white()),
                                    ),
                            ),
                    );
                // `[data-swap-selected]` / `[data-swap-over]`: a 2px accent ring inside.
                if swap_ring {
                    el = el.child(
                        div()
                            .absolute()
                            .inset_0()
                            .rounded(m.px(12.0))
                            .border(m.border(2.0))
                            .border_color(t.accent),
                    );
                }
                el = el.children(swap_control);
            }
            out.push(el.into_any_element());
        }
        out.extend(self.slot_buttons(region, m, t, window, cx));
        out
    }

    /// The live "Nome de exemplo" field of Propriedades.
    fn name_field_element(&self, m: Metrics, t: Theme) -> AnyElement {
        let _ = (m, t);
        self.name_field.clone().into_any_element()
    }

    /// Non-interactive frames of the floating Sidebar, projected at the panel width.
    pub(crate) fn floating_frames(
        &mut self,
        width: f32,
        height: f32,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> (Vec<AnyElement>, f32) {
        let mut surfaces = self.ports.surfaces;
        surfaces.sizes.sidebar = Size::new(width as f64, height as f64);
        let (_, frames, world) = scene(&self.session, &surfaces);
        let mut out = Vec::new();
        for f in frames.into_iter().filter(|f| f.region == Region::Sidebar) {
            let scroll = self.scroll_handle(&format!("floating-{}", f.id));
            let props = self.props_handler(cx);
            let content = widgets::content(
                &f.fixture,
                widgets::Fit::new(false, f.rect.w),
                m,
                t,
                &self.properties,
                props,
                None,
                false,
            );
            let p = m.place(f.rect);
            out.push(
                div()
                    .absolute()
                    .left(p.left)
                    .top(p.top)
                    .w(p.width)
                    .h(p.height)
                    .child(widgets::frame(
                        &f.fixture,
                        false,
                        m,
                        t,
                        content,
                        &scroll,
                        widgets::FrameLook::default(),
                    ))
                    .into_any_element(),
            );
        }
        (out, world)
    }

    /// The remove confirmation ("Remover widget?", `Confirm`): Cancelar and a destructive
    /// Confirmar; focus returns to the widget's catalog tile, or to the catalog toggle.
    pub(crate) fn remove_dialog(
        &mut self,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let id = self.removing.clone()?;
        let view = cx.entity().downgrade();
        let confirm = {
            let view = view.clone();
            let id = id.clone();
            move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut gpui::App| {
                let _ = view.update(cx, |this, cx| {
                    let now = geppui::now(cx);
                    let reduced = geppui::appearance(cx).reduced_motion;
                    this.removing = None;
                    let type_id = this.session.draft().type_of(&id).map(str::to_owned);
                    let before = this.frame_rects();
                    let _ = this.session.remove_view(&id);
                    let after = this.frame_rects();
                    this.edit.flips = flips_between(&before, &after, now, reduced, None);
                    this.edit.focus = Some(FocusRequest::Control(
                        match type_id.filter(|_| this.edit.catalog_open) {
                            Some(t) => format!("catalog-tile-{t}"),
                            None => "catalog-toggle".to_owned(),
                        },
                    ));
                    cx.notify();
                });
            }
        };
        let close = move |_: &mut Window, cx: &mut gpui::App| {
            let _ = view.update(cx, |this, cx| {
                this.removing = None;
                cx.notify();
            });
        };
        let cancel = close.clone();
        Some(
            geppui::dialog("remove-widget", crate::i18n::t("Remover widget?"))
                .on_dismiss(close)
                .child(
                    div()
                        .mt(m.px(9.0))
                        .text_color(t.text_muted)
                        .line_height(m.px(13.0 * 1.6))
                        .child(crate::i18n::t(
                            "Remover esta presença? Os dados e plugins continuam disponíveis.",
                        )),
                )
                .child(
                    div()
                        .mt(m.px(22.0))
                        .flex()
                        .justify_end()
                        .gap(m.px(9.0))
                        .child(
                            geppui::dialog_button(
                                "remove-cancel",
                                crate::i18n::t("Cancelar"),
                                geppui::DialogButtonKind::Secondary,
                            )
                            .on_click(move |_, w, cx| cancel(w, cx)),
                        )
                        .child(
                            geppui::dialog_button(
                                "remove-confirm",
                                crate::i18n::t("Confirmar"),
                                geppui::DialogButtonKind::Destructive,
                            )
                            .on_click(confirm),
                        ),
                )
                .into_any_element(),
        )
    }

    /// The sidebar world height for its scroll area.
    /// Extent of the Main scene (an infeasible projection keeps reference geometry and scrolls).
    pub(crate) fn main_world(&self) -> (f32, f32) {
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        frames
            .iter()
            .filter(|f| f.region == Region::Main)
            .fold((0.0f32, 0.0f32), |(w, h), f| {
                (w.max(f.rect.right()), h.max(f.rect.bottom()))
            })
    }

    /// Regions below their minimums while they hold widgets (the reference's geometry warning).
    /// Whether Main fits its widgets' minimums (`projection.feasible`).
    pub(crate) fn main_feasible(&self) -> bool {
        self.session.view(&self.ports.surfaces).1.main
    }

    pub(crate) fn geometry_warning(&self) -> bool {
        let (view, feasible) = self.session.view(&self.ports.surfaces);
        let panels = panel_ids(self.session.shown());
        Region::ALL.into_iter().any(|r| {
            !*feasible.get(r)
                && view
                    .placements
                    .iter()
                    .any(|p| p.region == r && !panels.contains(&p.id))
        })
    }

    pub(crate) fn sidebar_world(&self) -> f32 {
        scene(&self.session, &self.ports.surfaces).2
    }

    /// Edit overlays above the regions (drop zones, guides), the catalog column and the
    /// picture/flight/label layer, the banner and window frame, and the toast.
    pub(crate) fn edit_layers(
        &mut self,
        s: &ShellLayout,
        m: Metrics,
        t: Theme,
        now: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (Vec<AnyElement>, Vec<AnyElement>) {
        let reduced = geppui::appearance(cx).reduced_motion;
        let mut below_header = Vec::new();
        let mut top = Vec::new();
        if let Some(g) = self
            .edit
            .gesture
            .clone()
            .filter(|g| g.lifted && !matches!(g.kind, GestureKind::Resize(_)))
        {
            for r in &g.zones {
                let over = self.edit.zone_over[zone_index(*r)].sample(now) as f32;
                below_header.push(
                    drag_layer::drop_zone(m, &t, self.ports.port(*r), over).into_any_element(),
                );
            }
        }
        if let Some((g, region)) = self
            .edit
            .gesture
            .as_ref()
            .and_then(|g| g.region.map(|r| (g, r)))
        {
            {
                let port = self.ports.port(region);
                for guide in &g.guides {
                    let vertical = guide.axis == Axis::X;
                    let (ox, oy) = (port.x, port.y);
                    let line = guide.line as f32 + if vertical { ox } else { oy };
                    let (from, to) = (
                        guide.from as f32 + if vertical { oy } else { ox },
                        guide.to as f32 + if vertical { oy } else { ox },
                    );
                    let gd = match guide.kind {
                        GuideKind::Alignment => Guide::Alignment {
                            vertical,
                            line,
                            from,
                            to,
                        },
                        GuideKind::Spacing => Guide::Spacing {
                            vertical,
                            line,
                            gap: guide.gap as f32,
                            from,
                            to,
                        },
                    };
                    below_header.push(drag_layer::guide(m, &t, &gd).into_any_element());
                }
            }
        }
        // The Sidebar insertion line while a drag is over the Sidebar (`.sidebar-insertion`).
        if let Some(line) = self.edit.insertion {
            let port = self.ports.sidebar;
            let (_, sy) = self.scroll(Region::Sidebar);
            let y = port.y + (line - sy).clamp(0.0, port.h) - 5.0;
            below_header.push(
                div()
                    .absolute()
                    .left(m.px(port.x))
                    .top(m.px(y))
                    .w(m.px(port.w))
                    .h(m.px(3.0))
                    .rounded(m.px(2.0))
                    .bg(t.accent)
                    .into_any_element(),
            );
        }
        // Catalog column.
        if s.catalog.w > 0.5 {
            let tiles = self.tiles();
            if self.edit.catalog.normalize(&tiles) {
                cx.notify();
            }
            let key = self.edit.catalog.filter_key();
            if key != self.edit.filter_key {
                self.edit.filter_key = key;
                self.edit
                    .grid_scroll
                    .set_offset(gpui::point(gpui::px(0.0), gpui::px(0.0)));
            }
            for tile in &tiles {
                self.edit.tile_anchors.entry(tile.id).or_default();
            }
            let actions = self.catalog_actions(cx);
            let compositions = (self.edit.catalog.tab == CatalogTab::Compositions)
                .then(|| self.compositions_panel(m, t, window, cx));
            let slot_label = self
                .edit
                .catalog
                .slot
                .as_ref()
                .and_then(|id| self.session_slots().into_iter().find(|s| s.id == *id))
                .map(|slot| {
                    let tr = crate::i18n::tr(cx);
                    tr.f(
                        "{0}, espaço {1}",
                        &[
                            &tr.t(area(slot.region).label()),
                            &self.slot_index(&slot).to_string(),
                        ],
                    )
                });
            let destination = if self.edit.catalog.slot.is_none() {
                self.destination(&tiles)
            } else {
                None
            };
            // The slot banner and the grid entering after a slot was chosen (280 / 260ms).
            let entering = |at: f64, duration: f64, from: f32, offset: f32| {
                let k = motion::REGION.ease(((now - at) / duration).clamp(0.0, 1.0)) as f32;
                (from + (1.0 - from) * k, offset * (1.0 - k))
            };
            let motion = CatalogMotion {
                banner: self
                    .edit
                    .slot_motion
                    .map(|at| entering(at, 280.0, 0.25, -6.0)),
                grid: self
                    .edit
                    .slot_motion
                    .map(|at| entering(at, 260.0, 0.62, 6.0)),
                shake: self.edit.shake.and_then(|(id, at)| {
                    catalog::shake_offset(now - at).map(|offset| (id, offset))
                }),
            };
            let search_focused = self.edit.search_focused;
            let search = div()
                .id("catalog-search")
                .flex_1()
                .flex()
                .items_center()
                .gap(m.px(9.0))
                .h(m.px(36.0))
                .px(m.px(11.0))
                .rounded(m.px(8.0))
                .border(m.border(1.0))
                .border_color(t.input_border)
                .bg(t.input)
                .when(search_focused, |el| {
                    el.shadow(vec![
                        gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), t.ring)
                            .spread_radius(m.px(2.0)),
                    ])
                })
                .cursor_text()
                .child(
                    geppui::icon("magnifying-glass", m)
                        .size(16.0)
                        .color(t.text_muted),
                )
                .child(div().flex_1().min_w_0().child(self.edit.search.clone()))
                .into_any_element();
            let extra = CatalogExtra {
                compositions,
                slot_label,
                filter_anchor: self.edit.filter_anchor.clone(),
                search,
                destination,
                grid_scroll: self.edit.grid_scroll.clone(),
                category_scroll: self.edit.category_scroll.clone(),
                anchors: self.edit.tile_anchors.clone(),
                motion,
            };
            let panel =
                catalog::render(&self.edit.catalog, &tiles, m, t, actions, extra, window, cx);
            let p = m.place(Rect::new(
                s.catalog.x as f32,
                s.catalog.y as f32,
                s.catalog.w as f32,
                s.catalog.h as f32,
            ));
            below_header.push(
                div()
                    .absolute()
                    .left(p.left)
                    .top(p.top)
                    .w(p.width)
                    .h(p.height)
                    .overflow_hidden()
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .w(m.px(480.0))
                            .h_full()
                            .child(panel),
                    )
                    .into_any_element(),
            );
        }
        if self.editing() {
            // Catalog toggle at the column edge ("Recolher editor" / "Mostrar editor").
            let open = self.edit.catalog_open;
            let toggle_x = s.viewport.w - s.catalog.w - 6.0 - 30.0;
            let toggle_y = s.main.y + (s.status.y - s.main.y) / 2.0 - 15.0;
            let toggle = catalog::focusable(
                div()
                    .id("catalog-toggle")
                    .absolute()
                    .left(m.px(toggle_x as f32))
                    .top(m.px(toggle_y as f32))
                    .size(m.px(30.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(m.px(8.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.surface)
                    .opacity(0.25)
                    .hover(|s| s.opacity(1.0))
                    .focus(|s| s.opacity(1.0))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        let now = geppui::now(cx);
                        let reduced = geppui::appearance(cx).reduced_motion;
                        let open = !this.edit.catalog_open;
                        // The column changes the measured regions: a running gesture ends.
                        this.edit_cancel_gesture(cx);
                        this.edit.set_catalog(open, now, reduced);
                        cx.notify();
                    }))
                    .child(
                        geppui::icon("chevron-right", m)
                            .size(16.0)
                            .color(t.text)
                            .rotate_half_turns(if open { 0.0 } else { 1.0 }),
                    ),
                "catalog-toggle",
                true,
                t,
                window,
                cx,
            );
            below_header.push(
                geppui::titled(
                    toggle,
                    "catalog-toggle",
                    Some(crate::i18n::t(if open {
                        "Recolher editor"
                    } else {
                        "Mostrar editor"
                    })),
                )
                .into_any_element(),
            );
            top.push(edit_chrome::window_frame(&t, m).into_any_element());
            let view = cx.entity().downgrade();
            let handler = |command: &'static str| -> catalog::Click {
                let view = view.clone();
                Rc::new(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| this.edit_command(command, cx));
                })
            };
            // `editingLabel` / `editingHint` (Header.tsx).
            let (label, hint) = {
                let tr = crate::i18n::tr(cx);
                let fixed = tr.t("Barra lateral fixada");
                match self
                    .session
                    .format_id()
                    .and_then(|id| self.session.composition(id))
                {
                    Some(item) => {
                        let name = if item.system {
                            tr.t(&item.name)
                        } else {
                            item.name.clone().into()
                        };
                        let draft = self.session.draft();
                        let mode = if self.session.format_mode()
                            == Some(geppio_core::workbench::ApplyMode::Widgets)
                        {
                            "Formato + widgets"
                        } else if draft
                            .placements
                            .iter()
                            .any(|p| item.scopes.contains(&p.region))
                        {
                            "Formato com widgets atuais"
                        } else {
                            "Formato vazio"
                        };
                        (
                            tr.f("Editando: {0}", &[&name]),
                            SharedString::from(format!("{} · {fixed}", tr.t(mode))),
                        )
                    }
                    None => (tr.t("Modo de edição ativo"), fixed),
                }
            };
            let actions = BannerActions {
                can_undo: self.session.can_undo() && self.edit.gesture.is_none(),
                can_redo: self.session.can_redo() && self.edit.gesture.is_none(),
                saving: false,
                undo: handler("undo"),
                redo: handler("redo"),
                cancel: handler("cancel"),
                save: handler("save"),
                conclude: handler("conclude"),
                save_focus: self.save_focus.clone(),
                label,
                hint,
            };
            top.push(
                BannerSlot {
                    actions: Some(actions),
                    width: s.viewport.w,
                }
                .into_any_element(),
            );
        }
        // Origin placeholder of a frame drag.
        if let Some(g) = self
            .edit
            .gesture
            .as_ref()
            .filter(|g| g.lifted && g.kind == GestureKind::Move)
        {
            below_header.insert(0, drag_layer::origin(m, &t, g.origin).into_any_element());
        }
        if let Some(dialog) = self.remove_dialog(m, t, cx) {
            top.push(dialog);
        }
        if self.editing()
            && self.edit.catalog.plugin_menu
            && self.edit.catalog.tab == CatalogTab::Widgets
        {
            top.push(self.plugin_filter(m, t, cx));
        }
        // Picture, label and flight.
        if let Some(g) = self
            .edit
            .gesture
            .clone()
            .filter(|g| g.lifted && !matches!(g.kind, GestureKind::Resize(_)))
        {
            let r = g.picture(now, reduced);
            let scroll = self.scroll_handle(&format!("picture-{}", g.id));
            let props = self.props_handler(cx);
            let compact = g.region == Some(Region::Bottom) && g.moving.is_some();
            let content = widgets::content(
                &g.fixture,
                widgets::Fit::new(compact, r.w),
                m,
                t,
                &self.properties,
                props,
                None,
                true,
            );
            let frame = widgets::frame(
                &g.fixture,
                compact,
                m,
                t,
                content,
                &scroll,
                widgets::FrameLook::default(),
            )
            .into_any_element();
            top.push(drag_layer::picture(m, &t, r, frame, false).into_any_element());
            top.push(
                drag_layer::label(
                    m,
                    &t,
                    g.pointer,
                    (s.viewport.w as f32, s.viewport.h as f32),
                    &crate::i18n::t(g.label()),
                )
                .into_any_element(),
            );
        }
        if let Some(f) = self.edit.flight.clone() {
            let r = f.tween.at(now);
            let scroll = self.scroll_handle("flight");
            let props = self.props_handler(cx);
            let content = widgets::content(
                &f.fixture,
                widgets::Fit::new(f.compact, r.w),
                m,
                t,
                &self.properties,
                props,
                None,
                true,
            );
            let frame = widgets::frame(
                &f.fixture,
                f.compact,
                m,
                t,
                content,
                &scroll,
                widgets::FrameLook::default(),
            )
            .into_any_element();
            let mut el = drag_layer::picture(m, &t, r, frame, true);
            if f.shrink {
                el = el.opacity(1.0 - 0.85 * f.tween.progress(now));
            }
            top.push(el.into_any_element());
        }
        // The geometry warning stays while a region is infeasible; a transaction message joins it.
        let warning = self.geometry_warning().then_some("Espaço insuficiente para os mínimos. Composição preservada; amplie ou reabra a região.");
        // Toast texts are catalogue keys; they are translated as they are shown.
        // While the warning shows, the transaction's latest message stays with it (the
        // reference renders `[warning, t(tx.message)]` whenever the toast is visible).
        // In recovery the toast stays up with the latest message (`tx.recovery`).
        let recovery = self.session.recovery() && !self.editing();
        let notice = self.panel_notice();
        let latest = if warning.is_some() || recovery || notice.is_some() {
            Some(
                self.edit
                    .toast
                    .as_ref()
                    .map_or_else(|| self.session.message().to_owned(), |(m, _)| m.clone()),
            )
        } else {
            self.edit.toast_text(now).map(str::to_owned)
        };
        let parts: Vec<String> = [notice, warning, latest.as_deref()]
            .into_iter()
            .flatten()
            .filter(|text| !text.is_empty())
            .map(|text| crate::i18n::t(text).to_string())
            .collect();
        let text = (!parts.is_empty()).then(|| parts.join(" "));
        if let Some(text) = text {
            top.push(geppui::toast(text, (shell::STATUS + 16.0) as f32).into_any_element());
        }
        (below_header, top)
    }
}

impl Workbench {
    /// What holds keyboard focus, by control id (automated flows only).
    fn focus_name(&self, window: &Window, cx: &gpui::App) -> Option<String> {
        if let Some(id) = geppui::button::focused_control(window, cx) {
            return Some(id.to_string());
        }
        let triggers = [
            ("trigger:project", &self.triggers.project),
            ("trigger:plugins", &self.triggers.plugins),
            ("trigger:bell", &self.triggers.bell),
            ("trigger:profile", &self.triggers.profile),
            ("trigger:more", &self.triggers.more),
            ("edit-layout", &self.edit_focus),
            ("save-layout", &self.save_focus),
            ("sidebar-scroll", &self.sidebar_scroll_focus),
            ("main-port", &self.main_port_focus),
            ("root", &self.focus),
        ];
        if let Some((name, _)) = triggers.iter().find(|(_, h)| h.is_focused(window)) {
            return Some((*name).to_owned());
        }
        let fields = [
            ("field:catalog-search", &self.edit.search),
            ("field:plugin-search", &self.panels.plugin_search),
            ("field:rename", &self.panels.rename_field),
            ("field:name", &self.name_field),
        ];
        fields
            .iter()
            .find(|(_, f)| f.read(cx).is_focused(window))
            .map(|(name, _)| (*name).to_owned())
    }

    /// The edit state for the automated flows (`GEPPIO_NATIVE_TEST_TRACE` only).
    pub(crate) fn trace_edit_state(
        &mut self,
        now: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let tiles = self.tiles();
        let c = &self.edit.catalog;
        let visible: Vec<&str> = tiles
            .iter()
            .filter(|t| c.matches(t) && c.category.is_none_or(|k| t.category == k))
            .map(|t| t.id)
            .collect();
        let destination = self.destination(&tiles).map(|d| {
            d.reasons
                .iter()
                .map(|r| r.as_ref().map(|r| r.to_string()))
                .collect::<Vec<_>>()
        });
        let mut candidates: Vec<String> = vec!["catalog-toggle".into()];
        candidates.extend(Area::ALL.map(|a| format!("catalog-place-{}", a.key())));
        candidates.extend(tiles.iter().map(|t| format!("catalog-tile-{}", t.id)));
        candidates.extend(
            self.session_slots()
                .into_iter()
                .map(|s| format!("session-slot-{}", s.id)),
        );
        candidates.extend([
            "catalog-tab-widgets".into(),
            "catalog-tab-compositions".into(),
        ]);
        let focused = if self.edit.search_focused {
            Some("catalog-search".to_owned())
        } else {
            candidates
                .into_iter()
                .find(|id| catalog::control_focus(id, window, cx).is_focused(window))
        };
        let gesture = self.edit.gesture.as_ref().map(|g| {
            serde_json::json!({
                "kind": match &g.kind {
                    GestureKind::Move => "move".to_owned(),
                    GestureKind::Resize(d) => d.as_str().to_owned(),
                    GestureKind::Catalog(t) => format!("catalog:{t}"),
                },
                "lifted": g.lifted,
                "zones": g.zones.iter().map(|r| area(*r).key()).collect::<Vec<_>>(),
                "slot": g.hover_slot,
                "moving": g.moving,
            })
        });
        let placements: Vec<serde_json::Value> = self
            .session
            .draft()
            .placements
            .iter()
            .map(|p| serde_json::json!([p.id, area(p.region).key(), p.x, p.y, p.width, p.height]))
            .collect();
        let state = serde_json::json!({
            "editing": self.editing(),
            "open": self.edit.catalog_open,
            "tab": format!("{:?}", c.tab),
            "search": c.search,
            "areas": c.areas.iter().map(|a| a.key()).collect::<Vec<_>>(),
            "category": c.category,
            "plugin": c.plugin,
            "slot": c.slot,
            "destination": c.destination,
            "moving": c.moving,
            "reasons": destination,
            "visible": visible,
            "available": tiles.iter().map(|t| (t.id, t.available.iter().map(|a| a.key()).collect::<Vec<_>>())).collect::<HashMap<_, _>>(),
            "gesture": gesture,
            "blocked": self.edit.blocked,
            "removing": self.removing,
            "focused": focused,
            "toast": self.edit.toast_text(now),
            "activeBar": self.session.draft().organization.active_bar,
            "undo": self.session.can_undo(),
            "redo": self.session.can_redo(),
            "flight": self.edit.flight.is_some(),
            "insertion": self.edit.insertion,
            "peek": self.regions.peek,
            "sidebarScroll": -self.metrics.css(self.sidebar_scroll.offset().y),
            "mainScrollX": -self.metrics.css(self.main_scroll.offset().x),
            "gridScroll": -self.metrics.css(self.edit.grid_scroll.offset().y),
            "name": self.properties.name,
            "comfortable": self.properties.comfortable,
            "focus": self.focus_name(window, cx),
            "placements": placements,
            "ports": Region::ALL.map(|r| {
                let p = self.ports.port(r);
                (area(r).key(), [p.x, p.y, p.w, p.h])
            }).into_iter().collect::<HashMap<_, _>>(),
            "frames": self.frame_rects().into_iter().map(|(id, r)| (id, [r.x, r.y, r.w, r.h])).collect::<HashMap<_, _>>(),
        });
        // C2b fields, outside the macro (its recursion limit).
        let mut state = state;
        state["panels"] = self.trace_panels();
        state["pairs"] = serde_json::json!(
            self.pairs()
                .1
                .iter()
                .map(|p| format!(
                    "{}|{}|{}",
                    p.first,
                    p.second,
                    if p.axis == geppio_core::layout::Axis::X {
                        "x"
                    } else {
                        "y"
                    }
                ))
                .collect::<Vec<_>>()
        );
        state["pairDrag"] =
            serde_json::json!(self.edit.pairs.drag.as_ref().map(|d| serde_json::json!({
                "first": d.pair.first,
                "second": d.pair.second,
                "delta": d.delta,
                "snapped": self.edit.pairs.snapped,
            })));
        state["swapSelected"] = serde_json::json!(self.edit.pairs.selected);
        state["swapSelection"] = serde_json::json!(self.edit.pairs.selection);
        state["swapDrag"] =
            serde_json::json!(self.edit.pairs.swap.as_ref().map(|d| serde_json::json!({
                "id": d.id,
                "started": d.started,
                "target": d.target,
            })));
        state["preview"] = serde_json::json!(self.session.shown() != self.session.draft());
        state["required"] = serde_json::json!(self.required.map(|(field, _)| format!("{field:?}")));
        let rename_empty = self.panels.rename_field.read(cx).text().is_empty();
        let name_empty = self.compositions.name_field.read(cx).text().is_empty();
        state["requiredShown"] = serde_json::json!([
            self.required_bubble(crate::workbench::RequiredField::Rename, rename_empty)
                .is_some(),
            self.required_bubble(crate::workbench::RequiredField::CompositionName, name_empty)
                .is_some(),
        ]);
        state["demo"] = serde_json::json!(self.session.demo_fixtures());
        state["catalogTypes"] =
            serde_json::json!(self.tiles().iter().map(|t| t.id).collect::<Vec<_>>());
        if let Some(trace) = self.automation.trace.as_mut() {
            trace.state(now, &state);
        }
    }
}

/// Defers the banner to render time (it needs the window for its hover states).
#[derive(IntoElement)]
struct BannerSlot {
    actions: Option<BannerActions>,
    width: f64,
}

impl gpui::RenderOnce for BannerSlot {
    fn render(mut self, window: &mut Window, cx: &mut gpui::App) -> impl IntoElement {
        let t = geppui::theme(cx);
        let m = geppui::metrics(window, cx);
        let actions = self.actions.take().expect("banner actions");
        let banner = edit_chrome::edit_banner(&t, m, self.width, actions, window, cx);
        let compact_bottom = self.width <= 1100.0;
        div()
            .absolute()
            .left_0()
            .w_full()
            .flex()
            .justify_center()
            // 3px inside the 2px edit frame.
            .when(!compact_bottom, |el| el.top(m.px(5.0)))
            .when(compact_bottom, |el| el.bottom(m.px(34.0)))
            .child(banner)
    }
}
