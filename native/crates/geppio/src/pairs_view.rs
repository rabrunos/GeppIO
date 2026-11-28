//! Widget swap (`useSwap`, Ctrl+click selection and the "Trocar widget de {0}" control) and
//! the pair dividers between adjacent frames (`PairDividers`): inside Edit they are undoable
//! intentions; outside it a pair resize previews and is saved when released.
use geppio_core::layout::{Axis, Region};
use geppio_core::workbench::commands::{ResizePair, resize_pair, swap_views};
use geppio_core::workbench::model::{WorkbenchSnapshot, active_placements};
use geppio_core::workbench::presentations::panel_ids;
use geppui::{Metrics, Rect, Theme};
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, ParentElement, SharedString, StatefulInteractiveElement, Styled, Window, div,
    prelude::FluentBuilder,
};

use crate::workbench::Workbench;

/// Two frames of one region separated by the 10px gap.
#[derive(Clone, Debug, PartialEq)]
pub struct Pair {
    pub first: String,
    pub second: String,
    pub axis: Axis,
    pub region: Region,
}

impl Pair {
    fn key(&self) -> String {
        format!(
            "{}:{}{}",
            self.first,
            self.second,
            if self.axis == Axis::X { "x" } else { "y" }
        )
    }
    fn intent(&self, delta: f64) -> ResizePair {
        ResizePair {
            first: self.first.clone(),
            second: self.second.clone(),
            axis: self.axis,
            delta,
        }
    }
}

#[derive(Clone, Debug)]
pub struct PairDrag {
    pub pair: Pair,
    pub source: WorkbenchSnapshot,
    pub delta: f64,
    pub down: (f32, f32),
    /// Pointer pixels to document units (outside Edit the saved document keeps its own
    /// reference size).
    pub scale: f64,
}

#[derive(Clone, Debug)]
pub struct SwapDrag {
    pub id: String,
    pub down: (f32, f32),
    pub pos: (f32, f32),
    pub started: bool,
    pub target: Option<String>,
    pub source: WorkbenchSnapshot,
}

#[derive(Default)]
pub struct PairUi {
    pub drag: Option<PairDrag>,
    /// The drag sits on the centre (`snapped`): 7px to enter, 14px to leave.
    pub snapped: bool,
    /// Surface sizes of the last frame: a change ends the drag (`geometry`).
    pub geometry: String,
    /// Ctrl+click selection (`selectedViews`).
    pub selected: Vec<String>,
    /// The first view of a click-by-click swap (`swapSelection`).
    pub selection: Option<String>,
    pub swap: Option<SwapDrag>,
    /// Editing and Main size of the last frame: a change ends the swap drag.
    pub swap_key: String,
}

impl Workbench {
    /// Ends pair and swap gestures when the geometry or the mode changes; leaving Edit
    /// clears the selection.
    pub(crate) fn pairs_sync(&mut self, cx: &mut Context<Self>) {
        let s = self.ports.surfaces.sizes;
        let geometry = format!(
            "{},{};{},{};{},{}",
            s.main.width,
            s.main.height,
            s.sidebar.width,
            s.sidebar.height,
            s.bottom.width,
            s.bottom.height
        );
        let editing = self.editing();
        let geometry = format!("{geometry}|{editing}");
        if geometry != self.edit.pairs.geometry {
            self.edit.pairs.geometry = geometry;
            self.pair_end(true, cx);
        }
        let key = format!("{editing}|{}x{}", s.main.width, s.main.height);
        if key != self.edit.pairs.swap_key {
            self.edit.pairs.swap_key = key;
            self.edit.pairs.swap = None;
        }
        if !editing {
            self.edit.pairs.selected.clear();
            self.edit.pairs.selection = None;
        }
    }

    /// Window blur: pair and swap gestures end without saving.
    pub(crate) fn pairs_blur(&mut self, cx: &mut Context<Self>) {
        self.pair_end(true, cx);
        self.edit.pairs.swap = None;
    }

    pub(crate) fn pairs_active(&self) -> bool {
        self.edit.pairs.drag.is_some() || self.edit.pairs.swap.is_some()
    }

    /// Adjacent frames separated by the 10px gap: side by side outside the Sidebar, stacked
    /// outside Bottom. Main pairs wait while panels are open.
    pub(crate) fn pairs(&self) -> (WorkbenchSnapshot, Vec<Pair>) {
        let (view, _) = self.session.view(&self.ports.surfaces);
        let suspend_main = !panel_ids(&view).is_empty();
        let visible = active_placements(&view, true);
        let mut pairs = Vec::new();
        for a in &visible {
            for b in &visible {
                if a.id == b.id
                    || a.region != b.region
                    || (suspend_main && a.region == Region::Main)
                {
                    continue;
                }
                if a.region != Region::Sidebar
                    && (b.x - a.x - a.width - 10.0).abs() < 0.1
                    && a.y < b.y + b.height
                    && b.y < a.y + a.height
                {
                    pairs.push(Pair {
                        first: a.id.clone(),
                        second: b.id.clone(),
                        axis: Axis::X,
                        region: a.region,
                    });
                }
                if a.region != Region::Bottom
                    && (b.y - a.y - a.height - 10.0).abs() < 0.1
                    && a.x < b.x + b.width
                    && b.x < a.x + a.width
                {
                    pairs.push(Pair {
                        first: a.id.clone(),
                        second: b.id.clone(),
                        axis: Axis::Y,
                        region: a.region,
                    });
                }
            }
        }
        (view, pairs)
    }

    fn pair_down(&mut self, pair: &Pair, pos: (f32, f32), cx: &mut Context<Self>) {
        if self.edit.pairs.drag.is_some()
            || self.session.recovery()
            || self.session.gesture_active()
            || self.edit.gesture.is_some()
        {
            return;
        }
        let editing = self.editing();
        let (view, _) = self.session.view(&self.ports.surfaces);
        let source = if editing {
            view.clone()
        } else {
            self.session.draft().clone()
        };
        if resize_pair(&source, self.session.registry(), &pair.intent(0.0)).is_none() {
            return;
        }
        if !self.session.begin_pair() {
            return;
        }
        let scale = if editing {
            1.0
        } else {
            let (a, b) = (
                source.reference.get(pair.region),
                view.reference.get(pair.region),
            );
            match pair.axis {
                Axis::X if b.width > 0.0 => a.width / b.width,
                Axis::Y if b.height > 0.0 => a.height / b.height,
                _ => 1.0,
            }
        };
        self.edit.pairs.snapped = false;
        self.edit.pairs.drag = Some(PairDrag {
            pair: pair.clone(),
            source,
            delta: 0.0,
            down: pos,
            scale,
        });
        cx.notify();
    }

    /// Pointer move of a pair drag; a move without the button ends it without saving.
    pub(crate) fn pair_move(
        &mut self,
        pos: (f32, f32),
        pressed: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut d) = self.edit.pairs.drag.clone() else {
            return false;
        };
        if !pressed {
            self.pair_end(true, cx);
            return true;
        }
        let travel = if d.pair.axis == Axis::X {
            pos.0 - d.down.0
        } else {
            pos.1 - d.down.1
        } as f64;
        let mut delta = travel * d.scale;
        if self.prefs.snap_center && d.pair.axis == Axis::X {
            let width = |id: &str| {
                d.source
                    .placements
                    .iter()
                    .find(|p| p.id == id)
                    .map_or(0.0, |p| p.width)
            };
            let (first, second) = (width(&d.pair.first), width(&d.pair.second));
            let center = (first + second) / 2.0 - first;
            let distance = (delta - center).abs() / d.scale;
            self.edit.pairs.snapped = distance <= if self.edit.pairs.snapped { 14.0 } else { 7.0 };
            if self.edit.pairs.snapped {
                delta = center;
            }
        } else {
            self.edit.pairs.snapped = false;
        }
        if let Some(next) = resize_pair(&d.source, self.session.registry(), &d.pair.intent(delta)) {
            d.delta = delta;
            self.session.pair_preview(next);
            self.edit.pairs.drag = Some(d);
        }
        cx.notify();
        true
    }

    pub(crate) fn pair_up(&mut self, pos: (f32, f32), cx: &mut Context<Self>) -> bool {
        if self.edit.pairs.drag.is_none() {
            return false;
        }
        self.pair_move(pos, true, cx);
        self.pair_end(false, cx);
        true
    }

    /// Ends a pair drag (`end`): inside Edit one intention or nothing; outside, the preview
    /// goes away and an accepted travel is saved.
    pub(crate) fn pair_end(&mut self, cancel: bool, cx: &mut Context<Self>) {
        let Some(d) = self.edit.pairs.drag.take() else {
            return;
        };
        self.edit.pairs.snapped = false;
        let now = geppui::now(cx);
        let editing = self.editing();
        let before = self.session.message().to_owned();
        let mut store = self.store.clone();
        let saved = self
            .session
            .end_pair(cancel, &d.pair.intent(d.delta), &mut store)
            .is_ok();
        self.store = store;
        if !editing && !cancel && d.delta != 0.0 {
            let message = self.session.message().to_owned();
            if saved || message != before {
                self.edit.toast(&message, now);
            }
        }
        cx.notify();
    }

    /// Arrow keys (2%, Shift 10%), Home, End and Escape on a pair divider (`keyResize`).
    fn pair_key(&mut self, pair: &Pair, e: &KeyDownEvent, cx: &mut Context<Self>) {
        let key = e.keystroke.key.as_str();
        if key == "escape" {
            if self.edit.pairs.drag.is_some() {
                cx.stop_propagation();
                self.pair_end(true, cx);
            }
            return;
        }
        let horizontal = pair.axis == Axis::X;
        let (negative, positive) = if horizontal {
            ("left", "right")
        } else {
            ("up", "down")
        };
        if ![negative, positive, "home", "end"].contains(&key)
            || self.pairs_active()
            || self.edit.panel.drag.is_some()
            || self.edit.gesture.is_some()
            || self.session.gesture_active()
            || self.session.recovery()
        {
            return;
        }
        cx.stop_propagation();
        let editing = self.editing();
        let source = if editing {
            self.session.view(&self.ports.surfaces).0
        } else {
            self.session.draft().clone()
        };
        let registry = self.session.registry();
        let extent = |id: &str| {
            let p = source.placements.iter().find(|p| p.id == id)?;
            let ty = source.type_of(id).and_then(|t| registry.get(t))?;
            Some(if horizontal {
                (p.width, ty.constraint.min.width)
            } else {
                (p.height, ty.constraint.min.height)
            })
        };
        let (Some((first, first_min)), Some((second, second_min))) =
            (extent(&pair.first), extent(&pair.second))
        else {
            return;
        };
        let delta = match key {
            "home" => first_min - first,
            "end" => second - second_min,
            _ => {
                let sign = if key == positive { 1.0 } else { -1.0 };
                sign * (first + second)
                    * if e.keystroke.modifiers.shift {
                        0.1
                    } else {
                        0.02
                    }
            }
        };
        let intent = pair.intent(delta);
        if resize_pair(&source, registry, &intent).is_none() {
            return;
        }
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let mut store = self.store.clone();
        let mut message = None;
        let before = self.session.message().to_owned();
        let surfaces = self.ports.surfaces;
        self.flip_quietly(now, reduced, |w| {
            let ok = w.session.step_pair(&surfaces, &intent, &mut store).is_ok();
            if !editing && (ok || w.session.message() != before) {
                message = Some(w.session.message().to_owned());
            }
            true
        });
        self.store = store;
        if let Some(message) = message {
            self.edit.toast(&message, now);
        }
        cx.notify();
    }

    /// The dividers, clipped to their regions, plus the centre guide while snapped.
    /// Returned per region so each sits above its own frames (Main 16, Bottom 36,
    /// Sidebar 42).
    pub(crate) fn pair_layer(
        &mut self,
        regions: &[Region],
        m: Metrics,
        t: Theme,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let (view, pairs) = self.pairs();
        let active = self.edit.pairs.drag.as_ref().map(|d| d.pair.key());
        let mut out = Vec::new();
        for &region in regions {
            let port = self.ports.port(region);
            if port.w <= 0.0 || port.h <= 0.0 {
                continue;
            }
            let (sx, sy) = self.scroll(region);
            let mut children: Vec<AnyElement> = Vec::new();
            for pair in pairs.iter().filter(|p| p.region == region) {
                let find = |id: &str| view.placements.iter().find(|p| p.id == id);
                let (Some(a), Some(b)) = (find(&pair.first), find(&pair.second)) else {
                    continue;
                };
                let horizontal = pair.axis == Axis::X;
                let r = if horizontal {
                    Rect::new(
                        (a.x + a.width) as f32,
                        a.y.max(b.y) as f32,
                        10.0,
                        ((a.y + a.height).min(b.y + b.height) - a.y.max(b.y)) as f32,
                    )
                } else {
                    Rect::new(
                        a.x.max(b.x) as f32,
                        (a.y + a.height) as f32,
                        ((a.x + a.width).min(b.x + b.width) - a.x.max(b.x)) as f32,
                        10.0,
                    )
                };
                let local = Rect::new(r.x - sx, r.y - sy, r.w, r.h);
                let outside = local.right() <= 0.0
                    || local.x >= port.w
                    || local.bottom() <= 0.0
                    || local.y >= port.h;
                let key = pair.key();
                let is_active = active.as_deref() == Some(key.as_str());
                if outside && !is_active {
                    continue;
                }
                let p = m.place(local);
                let id = SharedString::from(format!("pair-{key}"));
                let handle = geppui::button::registered_focus(&id, cx);
                let group = SharedString::from(format!("pair-group-{key}"));
                // `:focus-visible`: focus that arrived from the keyboard.
                let focused = handle.is_focused(window) && window.last_input_was_keyboard();
                let (down_pair, key_pair) = (pair.clone(), pair.clone());
                let focus_on_press = handle.clone();
                let line = if horizontal {
                    div()
                        .absolute()
                        .top(m.px(9.0))
                        .bottom(m.px(9.0))
                        .left(m.px(4.0))
                        .w(m.px(2.0))
                } else {
                    div()
                        .absolute()
                        .left(m.px(11.0))
                        .right(m.px(11.0))
                        .top(m.px(4.0))
                        .h(m.px(2.0))
                };
                children.push(
                    div()
                        .id(id)
                        .group(group.clone())
                        .role(gpui::Role::Splitter)
                        .aria_label(crate::i18n::t("Redimensionar widgets em conjunto"))
                        .aria_value(format!("{}", if horizontal { a.width } else { a.height }))
                        .track_focus(&handle)
                        .absolute()
                        .left(p.left)
                        .top(p.top)
                        .w(p.width)
                        .h(p.height)
                        .when(horizontal, |el| el.cursor_col_resize())
                        .when(!horizontal, |el| el.cursor_row_resize())
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(move |this, e: &MouseDownEvent, window, cx| {
                                // `event.currentTarget.focus()`: the divider keeps the keys.
                                window.focus(&focus_on_press, cx);
                                let z = this.metrics.zoom;
                                let pos =
                                    (f32::from(e.position.x) / z, f32::from(e.position.y) / z);
                                this.pair_down(&down_pair, pos, cx);
                                cx.stop_propagation();
                            }),
                        )
                        .on_key_down(cx.listener(move |this, e: &KeyDownEvent, _, cx| {
                            this.pair_key(&key_pair, e, cx);
                        }))
                        .child(line.rounded(m.px(2.0)).bg(t.accent).when(
                            !is_active && !focused,
                            |el| {
                                el.opacity(0.0)
                                    .group_hover(group.clone(), |s| s.opacity(1.0))
                            },
                        ))
                        .into_any_element(),
                );
            }
            // The centre guide of a snapped drag (`.widget-center-guide`), below the dividers
            // (z-index 6 against 16).
            if let Some(d) = self
                .edit
                .pairs
                .drag
                .as_ref()
                .filter(|d| self.edit.pairs.snapped && d.pair.region == region)
            {
                let find = |id: &str| view.placements.iter().find(|p| p.id == id);
                if let (Some(a), Some(b)) = (find(&d.pair.first), find(&d.pair.second)) {
                    let x = ((a.x + b.x + b.width) / 2.0) as f32 - sx;
                    let top = a.y.max(b.y) as f32 - sy;
                    let height = ((a.y + a.height).min(b.y + b.height) - a.y.max(b.y)) as f32;
                    children.insert(
                        0,
                        div()
                            .absolute()
                            .left(m.px(x))
                            .top(m.px(top))
                            .w(m.px(1.0))
                            .h(m.px(height))
                            .border_l(m.border(1.0))
                            .border_dashed()
                            .border_color(t.accent)
                            .child(
                                div()
                                    .absolute()
                                    .top(m.px(9.0))
                                    .left(m.px(-40.0))
                                    .w(m.px(80.0))
                                    .flex()
                                    .justify_center()
                                    .child(
                                        div()
                                            .px(m.px(6.0))
                                            .py(m.px(2.0))
                                            .rounded(m.px(4.0))
                                            .border(m.border(1.0))
                                            .border_color(t.accent_border)
                                            .bg(t.accent_soft)
                                            .text_color(t.text)
                                            .text_size(m.px(10.0))
                                            .line_height(m.px(16.0))
                                            .child(crate::i18n::t("Centro")),
                                    ),
                            )
                            .into_any_element(),
                    );
                }
            }
            if children.is_empty() {
                continue;
            }
            let p = m.place(port);
            out.push(
                div()
                    .absolute()
                    .left(p.left)
                    .top(p.top)
                    .w(p.width)
                    .h(p.height)
                    .overflow_hidden()
                    .children(children)
                    .into_any_element(),
            );
        }
        out
    }

    // ---- swap ----------------------------------------------------------------------------

    /// Ctrl+click on a frame in Edit adds or removes it from the swap selection.
    pub(crate) fn toggle_swap_selection(&mut self, id: &str, cx: &mut Context<Self>) {
        let selected = &mut self.edit.pairs.selected;
        if let Some(i) = selected.iter().position(|s| s == id) {
            selected.remove(i);
        } else {
            selected.push(id.to_owned());
        }
        cx.notify();
    }

    /// Clears the selection (Escape, undo, redo).
    pub(crate) fn clear_swap_selection(&mut self) -> bool {
        let had = !self.edit.pairs.selected.is_empty() || self.edit.pairs.selection.is_some();
        self.edit.pairs.selected.clear();
        self.edit.pairs.selection = None;
        had
    }

    /// A click on a swap control: the first picks, a second on another view swaps them.
    pub(crate) fn swap_click(&mut self, id: &str, cx: &mut Context<Self>) {
        match self.edit.pairs.selection.clone() {
            Some(first) if first != id => {
                let surfaces = self.ports.surfaces;
                let now = geppui::now(cx);
                let reduced = geppui::appearance(cx).reduced_motion;
                self.flip_quietly(now, reduced, |w| {
                    w.session.swap(&surfaces, &first, id).is_ok()
                });
                self.edit.pairs.selection = None;
            }
            _ => self.edit.pairs.selection = Some(id.to_owned()),
        }
        cx.notify();
    }

    pub(crate) fn swap_down(&mut self, id: &str, pos: (f32, f32), cx: &mut Context<Self>) {
        if !self.editing() || self.edit.pairs.selected.len() < 2 || self.edit.pairs.swap.is_some() {
            return;
        }
        let (view, _) = self.session.view(&self.ports.surfaces);
        self.edit.pairs.swap = Some(SwapDrag {
            id: id.to_owned(),
            down: pos,
            pos,
            started: false,
            target: None,
            source: view,
        });
        cx.notify();
    }

    pub(crate) fn swap_move(
        &mut self,
        pos: (f32, f32),
        pressed: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut d) = self.edit.pairs.swap.clone() else {
            return false;
        };
        if !pressed {
            self.edit.pairs.swap = None;
            cx.notify();
            return true;
        }
        let (dx, dy) = (pos.0 - d.down.0, pos.1 - d.down.1);
        if !d.started && (dx * dx + dy * dy).sqrt() < 5.0 {
            return true;
        }
        d.started = true;
        d.pos = pos;
        let hit = self
            .frame_rects()
            .into_iter()
            .find(|(id, r)| *id != d.id && r.contains(pos.0, pos.1))
            .map(|(id, _)| id);
        d.target = hit.filter(|hit| {
            self.edit.pairs.selected.contains(hit)
                && swap_views(&d.source, self.session.registry(), &d.id, hit).is_some()
        });
        self.edit.pairs.swap = Some(d);
        cx.notify();
        true
    }

    /// Release of a swap control: a drag onto another selected view swaps them; a press
    /// without travel is a click.
    pub(crate) fn swap_up(&mut self, pos: (f32, f32), cx: &mut Context<Self>) -> bool {
        if self.edit.pairs.swap.is_none() {
            return false;
        }
        self.swap_move(pos, true, cx);
        let Some(d) = self.edit.pairs.swap.take() else {
            return true;
        };
        if !d.started {
            self.swap_click(&d.id, cx);
            return true;
        }
        // The draft changed under the drag (`motionRevision`): the drag ends with nothing.
        let current = self.session.view(&self.ports.surfaces).0;
        if let Some(target) = d.target.filter(|_| current == d.source) {
            let now = geppui::now(cx);
            let reduced = geppui::appearance(cx).reduced_motion;
            let surfaces = self.ports.surfaces;
            self.flip_quietly(now, reduced, |w| {
                w.session.swap(&surfaces, &d.id, &target).is_ok()
            });
            self.edit.pairs.selection = None;
        }
        cx.notify();
        true
    }

    /// The swap control of a selected frame (34px, centred) when two or more are selected.
    pub(crate) fn swap_control(
        &mut self,
        id: &str,
        title: &str,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let p = &self.edit.pairs;
        if p.selected.len() < 2 || !p.selected.iter().any(|s| s == id) {
            return None;
        }
        let key = format!("swap-{id}");
        let (down_id, click_id) = (id.to_owned(), id.to_owned());
        let label: SharedString = crate::i18n::t("Trocar widget de {0}")
            .replace("{0}", title)
            .into();
        let tip: SharedString =
            crate::i18n::t("Arraste sobre outro widget selecionado para trocar os espaços");
        let ring = t.ring;
        let handle = geppui::button::registered_focus(&SharedString::from(key.clone()), cx);
        let el = div()
            .id(SharedString::from(key.clone()))
            .role(gpui::Role::Button)
            .aria_label(label)
            .aria_toggled(gpui::Toggled::True)
            .track_focus(&handle)
            .focus_visible(move |s| {
                s.shadow(vec![
                    gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), ring)
                        .spread_radius(gpui::px(2.0)),
                ])
            })
            .absolute()
            .left(gpui::relative(0.5))
            .top(gpui::relative(0.5))
            .ml(m.px(-17.0))
            .mt(m.px(-17.0))
            .size(m.px(34.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_full()
            .border(m.border(1.0))
            .border_color(t.border)
            .bg(gpui::white())
            .hover(|s| s.bg(gpui::rgb(0xe9eff5)))
            .shadow(vec![
                gpui::BoxShadow::new(m.px(0.0), m.px(2.0), gpui::hsla(0.0, 0.0, 0.0, 0.125))
                    .blur_radius(m.px(8.0)),
            ])
            .cursor_grab()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    if e.modifiers.control || e.modifiers.platform {
                        return;
                    }
                    let z = this.metrics.zoom;
                    let pos = (f32::from(e.position.x) / z, f32::from(e.position.y) / z);
                    this.swap_down(&down_id, pos, cx);
                }),
            )
            // The pointer path runs through the press; Enter and Space click.
            .on_click(cx.listener(move |this, e: &gpui::ClickEvent, _, cx| {
                if e.is_keyboard() {
                    this.swap_click(&click_id, cx);
                }
            }))
            .child(
                geppui::icon("move", m)
                    .size(22.0)
                    .color(gpui::rgb(0x243347).into()),
            );
        Some(geppui::titled(el, key, Some(tip)).into_any_element())
    }

    /// The label that follows a swap drag (`.widget-swap-preview`) and the drag cover that
    /// keeps the pointer for pair and swap gestures.
    pub(crate) fn pairs_overlays(
        &mut self,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let mut out = Vec::new();
        if let Some(d) = self.edit.pairs.swap.as_ref().filter(|d| d.started) {
            let title = self
                .session
                .draft()
                .type_of(&d.id)
                .and_then(|ty| self.session.registry().get(ty))
                .map(|ty| ty.title.clone())
                .unwrap_or_default();
            out.push(
                gpui::deferred(
                    div()
                        .absolute()
                        .left(m.px(d.pos.0 + 14.0))
                        .top(m.px(d.pos.1 + 14.0))
                        .flex()
                        .items_center()
                        .gap(m.px(8.0))
                        .px(m.px(11.0))
                        .py(m.px(8.0))
                        .rounded(m.px(9.0))
                        .border(m.border(1.0))
                        .border_color(t.border)
                        .bg(t.surface)
                        .text_color(t.text)
                        .text_size(m.px(12.0))
                        .shadow(vec![m.shadow(t.shadow_side)])
                        .child(geppui::icon("move", m).size(18.0).color(t.text))
                        .child(title),
                )
                .with_priority(6)
                .into_any_element(),
            );
        }
        let cursor = if let Some(d) = self.edit.pairs.drag.as_ref() {
            Some(if d.pair.axis == Axis::X {
                gpui::CursorStyle::ResizeColumn
            } else {
                gpui::CursorStyle::ResizeRow
            })
        } else if self.edit.pairs.swap.is_some() {
            Some(gpui::CursorStyle::ClosedHand)
        } else {
            None
        };
        if let Some(cursor) = cursor {
            out.push(
                gpui::deferred(
                    div()
                        .id("pairs-drag-cover")
                        .absolute()
                        .left_0()
                        .top_0()
                        .size_full()
                        .occlude()
                        .cursor(cursor)
                        .on_mouse_move(cx.listener(|this, e: &gpui::MouseMoveEvent, _, cx| {
                            let m = this.metrics;
                            let pos = (m.css(e.position.x), m.css(e.position.y));
                            let pressed = e.pressed_button == Some(MouseButton::Left);
                            if !this.pair_move(pos, pressed, cx) {
                                this.swap_move(pos, pressed, cx);
                            }
                        }))
                        .on_mouse_up(
                            MouseButton::Left,
                            cx.listener(|this, e: &gpui::MouseUpEvent, _, cx| {
                                let m = this.metrics;
                                let pos = (m.css(e.position.x), m.css(e.position.y));
                                if !this.pair_up(pos, cx) {
                                    this.swap_up(pos, cx);
                                }
                            }),
                        ),
                )
                .with_priority(5)
                .into_any_element(),
            );
        }
        out
    }
}
