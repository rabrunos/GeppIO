//! Widgets and edit mode on the main screen: the scene projected by `geppio-core`, widget
//! frames with their edit chrome (heading move, eight resize zones), gestures, flights, FLIP,
//! drop zones, guides, the catalog column, the banner and keyboard shortcuts.
use std::collections::HashMap;
use std::rc::Rc;

use geppio_core::layout::{Axis, Direction, GuideKind, PerRegion, Region, Size};
use geppio_core::shell::{self, ShellLayout};
use geppio_core::workbench::compositions::{SlotIntention, project_session_slot};
use geppio_core::workbench::{
    EditSession, PointerFrame, SessionSlot, SessionSurfaces, WorkbenchSnapshot, active_placements,
};
use geppui::{Metrics, Rect, Theme, motion};
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, ParentElement, ScrollHandle, SharedString, StatefulInteractiveElement, Styled,
    Window, div, prelude::FluentBuilder,
};

use crate::catalog::{self, Area, CatalogActions, CatalogExtra, CatalogState, CatalogTab, Tile};
use crate::drag_layer::{self, Guide};
use crate::edit::{Flight, GestureKind, UiGesture, area, flips_between, region, zone_index};
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
    let frames: Vec<Frame> = active_placements(&view, true)
        .into_iter()
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

fn zones_for(region: Region) -> &'static [Direction] {
    match region {
        Region::Sidebar => &[Direction::N, Direction::S],
        Region::Bottom => &[Direction::E, Direction::W],
        Region::Main => &[
            Direction::N,
            Direction::E,
            Direction::S,
            Direction::W,
            Direction::Ne,
            Direction::Nw,
            Direction::Se,
            Direction::Sw,
        ],
    }
}

impl Workbench {
    pub(crate) fn editing(&self) -> bool {
        self.session.editing()
    }

    fn scroll(&self, region: Region) -> (f32, f32) {
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

    /// Runs a committed action and plays the FLIP of every frame it moved.
    pub(crate) fn with_flip(
        &mut self,
        now: f64,
        reduced: bool,
        skip: Option<&str>,
        action: impl FnOnce(&mut Self) -> Option<&'static str>,
    ) {
        let before = self.frame_rects();
        // A completed action names itself; a refused one shows the session's reason.
        let done = action(self);
        let after = self.frame_rects();
        self.edit.flips = flips_between(&before, &after, now, reduced, skip);
        let message = done.map_or_else(|| self.session.message().to_owned(), str::to_owned);
        self.edit.toast(&message, now);
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
    /// by the slot's region, and the previous filters return when the choice ends.
    pub(crate) fn choose_slot(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let catalog = &mut self.edit.catalog;
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
                }
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
                catalog.plugin_menu = false;
                catalog.destination = None;
                if !self.edit.catalog_open {
                    self.edit.set_catalog(true, now, reduced);
                }
            }
        }
        cx.notify();
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
            self.edit.set_catalog(true, now, reduced);
            self.edit.toast("Edite a composição. Salvar edição confirma um checkpoint; Concluir encerra a sessão.", now);
        } else if self.session.recovery() {
            // The reference points to an explicit preview in Settings, which the native host
            // does not have yet.
            self.edit.toast("Composição salva incompatível ou ilegível. O arquivo foi preservado e a edição fica bloqueada até a recuperação pelas Configurações.", now);
        } else {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        }
        cx.notify();
    }

    fn leave_edit(&mut self, now: f64, reduced: bool) {
        self.edit.catalog.slot = None;
        self.edit.catalog.saved = None;
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
        if self.edit.gesture.is_some() || self.edit.flight.is_some() {
            return;
        }
        match command {
            "undo" => self.with_flip(now, reduced, None, |w| {
                w.session.undo().then_some("Ação desfeita.")
            }),
            "redo" => self.with_flip(now, reduced, None, |w| {
                w.session.redo().then_some("Ação refeita.")
            }),
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
                self.leave_edit(now, reduced);
                let message = self.session.message().to_owned();
                self.edit.toast(&message, now);
            }
            _ => {}
        }
        cx.notify();
    }

    // ---- pointer gestures -------------------------------------------------------------------

    pub(crate) fn frame_down(
        &mut self,
        id: String,
        fixture: String,
        kind: GestureKind,
        pos: (f32, f32),
        cx: &mut Context<Self>,
    ) {
        if !self.editing() || self.edit.gesture.is_some() || self.edit.flight.is_some() {
            return;
        }
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        let Some(frame) = frames.iter().find(|f| f.id == id) else {
            return;
        };
        let origin = self.window_rect(frame);
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
        let fixture = self
            .session
            .registry()
            .get(type_id)
            .and_then(|t| t.fixture.clone())
            .unwrap_or_default();
        self.edit.gesture = Some(UiGesture {
            kind: GestureKind::Catalog(type_id.to_owned()),
            id: type_id.to_owned(),
            fixture,
            region: None,
            down: pos,
            pointer: pos,
            lifted: false,
            lifted_at: 0.0,
            origin: Rect::new(pos.0 - 40.0, pos.1 - 30.0, 238.0, 200.0),
            zones: Vec::new(),
            guides: Vec::new(),
        });
        cx.notify();
    }

    fn region_at(&self, pos: (f32, f32), zones: &[Region]) -> Option<Region> {
        zones.iter().copied().find(|r| {
            let p = self.ports.port(*r);
            Rect::new(p.x - 3.0, p.y - 3.0, p.w + 6.0, p.h + 6.0).contains(pos.0, pos.1)
        })
    }

    pub(crate) fn edit_move(&mut self, pos: (f32, f32), cx: &mut Context<Self>) -> bool {
        let Some(mut g) = self.edit.gesture.clone() else {
            return false;
        };
        let now = geppui::now(cx);
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
                    let zones: Vec<Region> = self
                        .tiles()
                        .into_iter()
                        .find(|t| t.id == type_id.as_str())
                        .map(|t| t.available.iter().map(|a| region(*a)).collect())
                        .unwrap_or_default();
                    if zones.is_empty() {
                        self.edit.gesture = None;
                        self.edit.toast(
                            "Não há área compatível com espaço disponível para este widget.",
                            now,
                        );
                        cx.notify();
                        return true;
                    }
                    g.zones = zones;
                    g.lifted = true;
                    g.lifted_at = now;
                }
                GestureKind::Resize(_) => {}
            }
        }
        if g.lifted {
            let over = self.region_at(pos, &g.zones);
            for r in Region::ALL {
                let target = if over == Some(r) { 1.0 } else { 0.0 };
                let d = geppui::appearance(cx).duration(motion::duration::DROP_ZONE);
                self.edit.zone_over[zone_index(r)].request(target, d, motion::EASE);
            }
            self.edit.over = over;
            let (dx, dy) = ((pos.0 - g.down.0) as f64, (pos.1 - g.down.1) as f64);
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
            g.guides = preview.map(|p| p.guides).unwrap_or_default();
        }
        self.edit.gesture = Some(g);
        cx.notify();
        true
    }

    pub(crate) fn edit_up(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(g) = self.edit.gesture.take() else {
            return false;
        };
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        self.edit.over = None;
        for z in &mut self.edit.zone_over {
            z.jump(0.0);
        }
        if !g.lifted {
            if matches!(g.kind, GestureKind::Catalog(_)) {
                self.edit.catalog.destination = self
                    .tiles()
                    .into_iter()
                    .find(|t| t.id == g.id.as_str())
                    .map(|t| t.id);
            }
            cx.notify();
            return true;
        }
        let from = g.picture(now, reduced);
        let target = self.region_at(g.pointer, &g.zones);
        match &g.kind {
            GestureKind::Resize(_) => {
                let _ = self.session.commit_gesture();
            }
            GestureKind::Move if self.slot_at(g.pointer).is_some() => {
                let slot = self.slot_at(g.pointer).expect("slot under the pointer");
                let _ = self.session.cancel_gesture();
                let source_bar = self.session.draft().organization.active_bar.clone();
                if !self.fill_chosen(
                    &slot.id,
                    SlotIntention::Move {
                        view_id: g.id.clone(),
                        source_bar,
                    },
                    None,
                    cx,
                ) {
                    self.edit.toast(
                        "Destino incompatível. A composição anterior foi preservada.",
                        now,
                    );
                }
            }
            GestureKind::Catalog(type_id) if self.slot_at(g.pointer).is_some() => {
                let slot = self.slot_at(g.pointer).expect("slot under the pointer");
                let _ =
                    self.fill_chosen(&slot.id, SlotIntention::Catalog(type_id.clone()), None, cx);
            }
            GestureKind::Move => {
                let surfaces = self.ports.surfaces;
                let result = match target {
                    Some(r) if Some(r) != g.region || r == Region::Sidebar => {
                        let port = self.ports.port(r);
                        let (sx, sy) = self.scroll(r);
                        let at = ((from.x - port.x + sx) as f64, (from.y - port.y + sy) as f64);
                        let before = self.frame_rects();
                        let result = self.session.drop_into(r, at, &surfaces);
                        let after = self.frame_rects();
                        self.edit.flips = flips_between(&before, &after, now, reduced, Some(&g.id));
                        result
                    }
                    _ => self.session.commit_gesture(),
                };
                let message = self.session.message().to_owned();
                self.edit.toast(&message, now);
                let to = self
                    .frame_rects()
                    .into_iter()
                    .find(|(id, _)| *id == g.id)
                    .map(|(_, r)| r)
                    .unwrap_or(g.origin);
                let compact = self.frame_region(&g.id) == Some(Region::Bottom);
                if !reduced {
                    self.edit.flight = Some(Flight {
                        view: Some(g.id.clone()),
                        fixture: g.fixture.clone(),
                        compact,
                        tween: geppui::Tween {
                            from,
                            to: if result.is_ok() { to } else { g.origin },
                            start_ms: now,
                            duration_ms: motion::duration::FLIGHT,
                            easing: motion::FLIGHT,
                        },
                        shrink: false,
                    });
                }
            }
            GestureKind::Catalog(type_id) => {
                let added = match target {
                    Some(r) => {
                        let port = self.ports.port(r);
                        let (sx, sy) = self.scroll(r);
                        let at = ((from.x - port.x + sx) as f64, (from.y - port.y + sy) as f64);
                        let before: Vec<String> =
                            self.frame_rects().into_iter().map(|(id, _)| id).collect();
                        let surfaces = self.ports.surfaces;
                        let ok = self
                            .session
                            .add_widget(type_id, r, Some(at), &surfaces, &[])
                            .is_ok();
                        let message = self.session.message().to_owned();
                        self.edit.toast(&message, now);
                        ok.then(|| {
                            self.frame_rects()
                                .into_iter()
                                .find(|(id, _)| !before.contains(id))
                        })
                    }
                    None => None,
                }
                .flatten();
                if !reduced {
                    let (view, to, shrink) = match added {
                        Some((id, rect)) => (Some(id), rect, false),
                        None => (
                            None,
                            Rect::new(from.x + from.w / 2.0, from.y + from.h / 2.0, 1.0, 1.0),
                            true,
                        ),
                    };
                    self.edit.flight = Some(Flight {
                        view,
                        fixture: g.fixture.clone(),
                        compact: false,
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
            }
        }
        cx.notify();
        true
    }

    /// Escape: cancel a gesture (flying back), then close the search, the peek, and leave Edit.
    pub(crate) fn edit_escape(&mut self, cx: &mut Context<Self>) -> bool {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        if let Some(g) = self.edit.gesture.take() {
            if g.lifted && !matches!(g.kind, GestureKind::Catalog(_)) {
                let _ = self.session.cancel_gesture();
                self.edit
                    .toast("Gesto cancelado. A prévia anterior foi restaurada.", now);
                if !reduced && matches!(g.kind, GestureKind::Move) {
                    self.edit.flight = Some(Flight {
                        view: Some(g.id.clone()),
                        fixture: g.fixture.clone(),
                        compact: g.region == Some(Region::Bottom),
                        tween: geppui::Tween {
                            from: g.picture(now, reduced),
                            to: g.origin,
                            start_ms: now,
                            duration_ms: motion::duration::FLIGHT,
                            easing: motion::FLIGHT,
                        },
                        shrink: false,
                    });
                }
            }
            cx.notify();
            return true;
        }
        if self.edit.search_focused {
            self.edit.search_focused = false;
            cx.notify();
            return true;
        }
        if self.edit.catalog.plugin_menu {
            self.edit.catalog.plugin_menu = false;
            cx.notify();
            return true;
        }
        if self.edit.catalog.slot.is_some() {
            self.choose_slot(None, cx);
            return true;
        }
        if self.edit.catalog.destination.is_some() {
            self.edit.catalog.destination = None;
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

    /// Keyboard of edit mode. Returns true when the key was handled.
    pub(crate) fn edit_key(&mut self, e: &KeyDownEvent, cx: &mut Context<Self>) -> bool {
        let k = &e.keystroke;
        if !self.editing() {
            return false;
        }
        let ctrl = k.modifiers.control || k.modifiers.platform;
        if self.edit.search_focused && !ctrl {
            match k.key.as_str() {
                "backspace" => {
                    self.edit.catalog.search.pop();
                }
                "escape" => self.edit.search_focused = false,
                _ => {
                    if let Some(ch) = k.key_char.as_deref() {
                        self.edit.catalog.search.push_str(ch);
                    }
                }
            }
            cx.notify();
            return true;
        }
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

    /// Catalog entries of the demonstration widgets with live availability per area.
    pub(crate) fn tiles(&self) -> Vec<Tile> {
        let registry = self.session.registry();
        let draft = self.session.draft();
        let slot = self
            .edit
            .catalog
            .slot
            .as_ref()
            .and_then(|id| self.session_slots().into_iter().find(|s| s.id == *id));
        registry
            .types()
            .iter()
            .filter(|t| t.fixture.is_some() && !t.retired)
            .filter(|t| slot.as_ref().is_none_or(|s| t.constraint.allows(s.region)))
            .map(|t| {
                let placed: Vec<Area> = Region::ALL
                    .into_iter()
                    .filter(|r| {
                        draft
                            .placements
                            .iter()
                            .any(|p| p.region == *r && draft.type_of(&p.id) == Some(t.id.as_str()))
                    })
                    .map(area)
                    .collect();
                let available: Vec<Area> = Region::ALL
                    .into_iter()
                    .filter(|r| {
                        self.session
                            .clone()
                            .add_widget(&t.id, *r, None, &self.ports.surfaces, &[])
                            .is_ok()
                    })
                    .map(area)
                    .collect();
                let leak = |s: &str| -> &'static str { Box::leak(s.to_owned().into_boxed_str()) };
                let reason = slot.as_ref().and_then(|s| {
                    let fits = self.session.slot_accepts(
                        &s.id,
                        &SlotIntention::Catalog(t.id.clone()),
                        &self.ports.surfaces,
                        &[],
                    );
                    if fits {
                        return None;
                    }
                    let min =
                        geppio_core::freeform::constraint_in_region(&t.constraint, s.region).min;
                    let here = draft.placements.iter().any(|p| {
                        p.region == s.region && draft.type_of(&p.id) == Some(t.id.as_str())
                    });
                    Some(crate::i18n::t(if here {
                        "Este widget já está nesta área."
                    } else if min.width > s.width || min.height > s.height {
                        "O espaço é menor que o mínimo deste widget."
                    } else {
                        "Não há espaço disponível para os mínimos deste widget."
                    }))
                });
                Tile {
                    id: self.static_id(&t.id),
                    title: leak(&t.title),
                    category: leak(&t.category),
                    owner: self.static_id(&t.owner),
                    reason,
                    available,
                    placed,
                }
            })
            .collect()
    }

    fn static_id(&self, id: &str) -> &'static str {
        // Type ids are a small fixed set (the demo registry); intern them once.
        thread_local! { static IDS: std::cell::RefCell<HashMap<String, &'static str>> = Default::default(); }
        IDS.with(|ids| {
            *ids.borrow_mut()
                .entry(id.to_owned())
                .or_insert_with(|| Box::leak(id.to_owned().into_boxed_str()))
        })
    }

    fn catalog_actions(&self, cx: &mut Context<Self>) -> CatalogActions {
        let view = cx.entity().downgrade();
        let v1 = view.clone();
        let v2 = view.clone();
        let v3 = view.clone();
        let v4 = view.clone();
        let v5 = view.clone();
        let (t1, t2, t3, t4, t5) = (
            view.clone(),
            view.clone(),
            view.clone(),
            view.clone(),
            view.clone(),
        );
        CatalogActions {
            select_tab: Rc::new(move |tab, _, cx| {
                let _ = t1.update(cx, |this, cx| {
                    if this.edit.catalog.slot.is_some() {
                        this.choose_slot(None, cx);
                    }
                    this.edit.catalog.tab = tab;
                    this.edit.catalog.plugin_menu = false;
                    cx.notify();
                });
            }),
            toggle_plugin_menu: Rc::new(move |_, _, cx| {
                let _ = t2.update(cx, |this, cx| {
                    this.edit.catalog.plugin_menu = !this.edit.catalog.plugin_menu;
                    cx.notify();
                });
            }),
            explore: Rc::new(move |_, _, cx| {
                let _ = t3.update(cx, |this, cx| {
                    this.set_menu(Some(crate::panels::Menu::Plugins), None, None, cx)
                });
            }),
            cancel_slot: Rc::new(move |_, _, cx| {
                let _ = t4.update(cx, |this, cx| this.choose_slot(None, cx));
            }),
            clear_filters: Rc::new(move |_, _, cx| {
                let _ = t5.update(cx, |this, cx| {
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
                    cx.notify();
                });
            }),
            toggle_area: Rc::new(move |a, _, cx| {
                let _ = v1.update(cx, |this, cx| {
                    let areas = &mut this.edit.catalog.areas;
                    if let Some(i) = areas.iter().position(|x| *x == a) {
                        areas.remove(i);
                    } else {
                        areas.push(a);
                    }
                    if areas.len() == 3 {
                        areas.clear();
                    }
                    cx.notify();
                });
            }),
            choose_category: Rc::new(move |c, _, cx| {
                let _ = v2.update(cx, |this, cx| {
                    this.edit.catalog.category = c;
                    cx.notify();
                });
            }),
            choose_tile: Rc::new(move |id, _, cx| {
                let _ = v3.update(cx, |this, cx| {
                    if let Some(slot) = this.edit.catalog.slot.clone() {
                        this.fill_chosen(&slot, SlotIntention::Catalog(id.to_owned()), None, cx);
                        return;
                    }
                    let available = this
                        .tiles()
                        .into_iter()
                        .find(|t| t.id == id)
                        .is_some_and(|t| !t.available.is_empty());
                    if available {
                        this.edit.catalog.destination = Some(id);
                    } else {
                        let now = geppui::now(cx);
                        this.edit.toast(
                            "Não há área compatível com espaço disponível para este widget.",
                            now,
                        );
                    }
                    cx.notify();
                });
            }),
            place: Rc::new(move |id, a, _, cx| {
                let _ = v4.update(cx, |this, cx| {
                    let now = geppui::now(cx);
                    let reduced = geppui::appearance(cx).reduced_motion;
                    let surfaces = this.ports.surfaces;
                    this.with_flip(now, reduced, None, |w| {
                        w.session
                            .add_widget(id, region(a), None, &surfaces, &[])
                            .ok()
                            .map(|()| "Widget adicionado. Salve ou cancele.")
                    });
                    this.edit.catalog.destination = None;
                    cx.notify();
                });
            }),
            press_tile: Rc::new(move |id, e: &MouseDownEvent, _, cx| {
                let _ = v5.update(cx, |this, cx| {
                    let z = this.metrics.zoom;
                    this.tile_down(
                        id,
                        (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                        cx,
                    );
                });
            }),
            focus_search: Rc::new({
                let view = view.clone();
                move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.edit.search_focused = true;
                        cx.notify();
                    });
                }
            }),
        }
    }

    // ---- rendering --------------------------------------------------------------------------

    fn scroll_handle(&mut self, id: &str) -> ScrollHandle {
        self.scrolls.entry(id.to_owned()).or_default().clone()
    }

    /// Updates the Propriedades demo model; content is inert while editing.
    fn props_handler(
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
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        if !self.editing() {
            return Vec::new();
        }
        let tr = crate::i18n::tr(cx);
        let chosen = self.edit.catalog.slot.clone();
        let over = self
            .edit
            .gesture
            .as_ref()
            .filter(|g| g.lifted && !matches!(g.kind, GestureKind::Resize(_)))
            .and_then(|g| self.slot_at(g.pointer))
            .map(|s| s.id);
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
                div()
                    .id(SharedString::from(format!("session-slot-{id}")))
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

    pub(crate) fn region_frames(
        &mut self,
        region: Region,
        m: Metrics,
        t: Theme,
        now: f64,
        editing: bool,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let (_, frames, _) = scene(&self.session, &self.ports.surfaces);
        let ghost = self
            .edit
            .gesture
            .as_ref()
            .filter(|g| g.lifted && g.kind == GestureKind::Move)
            .map(|g| g.id.clone());
        let flying = self.edit.flight.as_ref().and_then(|f| f.view.clone());
        let mut out = Vec::new();
        for f in frames.into_iter().filter(|f| f.region == region) {
            let port = self.ports.port(region);
            let (sx, sy) = self.scroll(region);
            let window = Rect::new(
                port.x + f.rect.x - sx,
                port.y + f.rect.y - sy,
                f.rect.w,
                f.rect.h,
            );
            let shown = self.edit.flipped(&f.id, window, now);
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
            let content = widgets::content(
                &f.fixture,
                region == Region::Bottom,
                m,
                t,
                &self.properties,
                props,
            );
            let frame = widgets::frame(
                &f.fixture,
                region == Region::Bottom,
                m,
                t,
                content,
                &scroll,
                editing && self.edit.selected.as_deref() == Some(f.id.as_str()),
            );
            let id = f.id.clone();
            let fixture = f.fixture.clone();
            let p = m.place(local);
            let group = SharedString::from(format!("frame-{id}"));
            let mut el = div()
                .absolute()
                .left(p.left)
                .top(p.top)
                .w(p.width)
                .h(p.height)
                .group(group.clone())
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
                                    (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                                    cx,
                                );
                                cx.stop_propagation();
                            }),
                        ),
                );
                for d in zones_for(region) {
                    let (zid, zfix, d) = (id.clone(), fixture.clone(), *d);
                    let mut zone = div()
                        .id(SharedString::from(format!("resize-{id}-{}", d.as_str())))
                        .absolute();
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
                    el = el.child(zone.on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                            let z = this.metrics.zoom;
                            this.frame_down(
                                zid.clone(),
                                zfix.clone(),
                                GestureKind::Resize(d),
                                (f32::from(e.position.x) / z, f32::from(e.position.y) / z),
                                cx,
                            );
                            cx.stop_propagation();
                        }),
                    ));
                }
            }
            if editing {
                let rid = id.clone();
                let title = widgets::title(&fixture);
                // Grip (top-left) and local controls (top-right) appear on frame hover.
                el = el
                    .child(
                        div()
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
                            .child(geppui::icon("move", m).size(14.0).color(t.text_muted)),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("remove-{id}")))
                            .absolute()
                            .top(m.px(9.0))
                            .right(m.px(9.0))
                            .size(m.px(24.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(m.px(8.0))
                            .bg(gpui::rgb(0xd72c42))
                            .hover(|s| s.bg(gpui::rgb(0xb92639)))
                            .opacity(0.0)
                            .group_hover(group.clone(), |s| s.opacity(1.0))
                            .cursor_pointer()
                            .occlude()
                            .tooltip(move |_, cx| {
                                geppui::button::tooltip_view(format!("Remover {title}"), cx)
                            })
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.removing = Some(rid.clone());
                                cx.notify();
                            }))
                            .child(geppui::icon("x-mark", m).size(14.0).color(gpui::white())),
                    );
            }
            out.push(el.into_any_element());
        }
        out.extend(self.slot_buttons(region, m, t, cx));
        out
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
            let content = widgets::content(&f.fixture, false, m, t, &self.properties, props);
            let p = m.place(f.rect);
            out.push(
                div()
                    .absolute()
                    .left(p.left)
                    .top(p.top)
                    .w(p.width)
                    .h(p.height)
                    .child(widgets::frame(
                        &f.fixture, false, m, t, content, &scroll, false,
                    ))
                    .into_any_element(),
            );
        }
        (out, world)
    }

    /// The remove confirmation ("Remover widget?").
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
                    this.with_flip(now, reduced, None, |w| {
                        w.session
                            .remove_view(&id)
                            .ok()
                            .map(|()| "Widget removido. Desfazer o restaura nesta sessão.")
                    });
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
            geppui::dialog("remove-widget", "Remover widget?")
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
                            geppui::button("remove-cancel")
                                .label(crate::i18n::t("Cancelar"))
                                .height(36.0, 8.0)
                                .text(12.0, 600.0)
                                .on_click(move |_, w, cx| cancel(w, cx)),
                        )
                        .child(
                            geppui::button("remove-confirm")
                                .label(crate::i18n::t("Remover"))
                                .height(36.0, 8.0)
                                .text(12.0, 600.0)
                                .primary()
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
    pub(crate) fn geometry_warning(&self) -> bool {
        let (view, feasible) = self.session.view(&self.ports.surfaces);
        Region::ALL
            .into_iter()
            .any(|r| !*feasible.get(r) && view.placements.iter().any(|p| p.region == r))
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
        // Catalog column.
        if s.catalog.w > 0.5 {
            let tiles = self.tiles();
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
            let single_view = self
                .edit
                .catalog
                .destination
                .and_then(|id| self.session.registry().get(id))
                .is_some_and(|ty| ty.presence == geppio_core::workbench::Presence::SingleView);
            let extra = CatalogExtra {
                compositions,
                slot_label,
                filter_anchor: self.edit.filter_anchor.clone(),
                single_view,
            };
            let panel = catalog::render(&self.edit.catalog, &tiles, m, t, actions, extra);
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
            // Catalog toggle at the column edge.
            let open = self.edit.catalog_open;
            let toggle_x = s.viewport.w - s.catalog.w - 6.0 - 30.0;
            let toggle_y = s.main.y + (s.status.y - s.main.y) / 2.0 - 15.0;
            below_header.push(
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
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        let now = geppui::now(cx);
                        let reduced = geppui::appearance(cx).reduced_motion;
                        let open = !this.edit.catalog_open;
                        this.edit.set_catalog(open, now, reduced);
                        cx.notify();
                    }))
                    .child(
                        geppui::icon("chevron-right", m)
                            .size(16.0)
                            .color(t.text)
                            .rotate_half_turns(if open { 0.0 } else { 1.0 }),
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
            let content = widgets::content(&g.fixture, false, m, t, &self.properties, props);
            let frame =
                widgets::frame(&g.fixture, false, m, t, content, &scroll, false).into_any_element();
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
            let content = widgets::content(&f.fixture, f.compact, m, t, &self.properties, props);
            let frame = widgets::frame(&f.fixture, f.compact, m, t, content, &scroll, false)
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
        let latest = if warning.is_some() {
            Some(
                self.edit
                    .toast
                    .as_ref()
                    .map_or_else(|| self.session.message().to_owned(), |(m, _)| m.clone()),
            )
        } else {
            self.edit.toast_text(now).map(str::to_owned)
        };
        let text = match (
            warning.map(crate::i18n::t),
            latest.as_deref().map(crate::i18n::t),
        ) {
            (Some(w), Some(m)) => Some(format!("{w} {m}")),
            (Some(w), None) => Some(w.to_string()),
            (None, Some(m)) => Some(m.to_string()),
            (None, None) => None,
        };
        if let Some(text) = text {
            top.push(geppui::toast(text, (shell::STATUS + 16.0) as f32).into_any_element());
        }
        (below_header, top)
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
