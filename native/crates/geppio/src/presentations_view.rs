//! Main panels of the Docked and Floating presentations (`usePresentationPanel`,
//! `PresentationControls` and the presentation layer of `App.tsx` at alpha.99): the
//! arrangement that reserves Main edges, closed bars, the hover reveal of floating panels
//! (100/280 ms), free panel drags, the docked panel divider and the presentation menu.
use std::collections::{HashMap, HashSet};

use geppio_core::json::Json;
use geppio_core::layout::{Bounds, Size};
use geppio_core::workbench::model::snapshot_constraints;
use geppio_core::workbench::presentations::{
    EDGES, Edge, PANEL_BAR_HEIGHT, PANEL_MIN, Presentation, PresentationLayout, PresentationPatch,
    WidgetPresentation, arrange_presentations, available_presentations, horizontal, panel_ids,
    point_object, presentation_for,
};
use geppui::motion::{self, Tween};
use geppui::{AnchorHandle, Metrics, Rect, Theme, anchor_probe, menu_item, popover};
use gpui::{
    AnyElement, Context, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, ParentElement, SharedString, StatefulInteractiveElement, Styled, div,
    prelude::FluentBuilder,
};

use crate::widgets;
use crate::workbench::Workbench;

/// `REGION_POLICY.collapseDistance`: a docked divider collapses this far below the minimum.
const COLLAPSE_DISTANCE: f64 = 48.0;

pub fn mode_label(p: Presentation) -> &'static str {
    match p {
        Presentation::Normal => "Normal",
        Presentation::Docked => "Encaixado",
        Presentation::Overlay => "Flutuante",
    }
}

pub fn edge_label(e: Edge) -> &'static str {
    match e {
        Edge::Top => "Topo",
        Edge::Bottom => "Embaixo",
        Edge::Left => "Esquerda",
        Edge::Right => "Direita",
    }
}

/// A pointer gesture on a panel: a free panel's bar, a closed docked bar or a docked
/// divider.
#[derive(Clone, Debug)]
pub struct PanelDrag {
    pub id: String,
    pub down: (f32, f32),
    pub rect: Bounds,
    pub state: WidgetPresentation,
    pub started: bool,
    pub free: bool,
    pub compact: bool,
    pub next: PresentationPatch,
}

#[derive(Default)]
pub struct PanelUi {
    /// The arrangement drawn now (`None` without panels).
    pub layout: Option<PresentationLayout>,
    /// Main before the edge reservations (window CSS px).
    pub full_main: Rect,
    /// Pending reveal changes of floating panels: wanted state and when.
    pub reveal_at: HashMap<String, (bool, f64)>,
    pub revealed: HashSet<String>,
    /// Panels under the pointer.
    pub inside: HashSet<String>,
    pub drag: Option<PanelDrag>,
    /// The open presentation menu: the view and the mode whose edges it lists.
    pub menu: Option<(String, Option<Presentation>)>,
    pub anchors: HashMap<String, AnchorHandle>,
    /// Modes, editing and viewport of the last arrangement: a change ends panel gestures
    /// and reveals (`useEffect([modes, tx.editing, viewport])`).
    pub key: String,
    /// The last drawn rectangle of each panel, whether it showed, and its mode.
    pub drawn: HashMap<String, (Rect, bool, Presentation)>,
    /// Running panel motion (reveal or a committed change).
    pub motion: HashMap<String, Tween>,
    /// The rectangle each panel was last painted at (its motion included).
    pub painted: HashMap<String, Rect>,
    /// A presentation change was just committed: the next arrangement animates.
    pub commit_motion: bool,
    /// Each panel's content focus scope: focus inside holds a floating reveal, and a panel
    /// that closes with focus inside hands the focus to its bar.
    pub focus: HashMap<String, gpui::FocusHandle>,
    /// Panels holding focus on the last frame.
    pub focused: HashSet<String>,
}

impl Workbench {
    /// The panel arrangement of the shown document (with a running panel gesture's preview);
    /// Main's port shrinks by the edge reservations (`main-placement` margins).
    pub(crate) fn arrange_panels(&mut self) {
        let full = self.edit.panel.full_main;
        let mut source = self.session.shown().clone();
        let modes = {
            let mut modes: Vec<String> = source
                .organization
                .presentations
                .entries
                .iter()
                .filter(|e| panel_ids(&source).contains(&e.view_id))
                .map(|e| {
                    format!(
                        "{}:{}:{}",
                        e.view_id,
                        e.presentation.as_str(),
                        e.anchor.map_or("free", Edge::as_str)
                    )
                })
                .collect();
            modes.sort();
            modes.join(";")
        };
        let key = format!("{modes}|{}|{}x{}", self.editing(), full.w, full.h);
        if key != self.edit.panel.key {
            self.edit.panel.key = key;
            self.panels_reset();
        }
        if panel_ids(&source).is_empty() {
            self.edit.panel.layout = None;
            return;
        }
        if let Some(d) = self
            .edit
            .panel
            .drag
            .as_ref()
            .filter(|d| d.started && !d.compact)
            && let Ok(next) = geppio_core::workbench::presentations::change_presentation(
                &source,
                &d.next,
                self.session.registry(),
                &d.id,
            )
        {
            source = next;
        }
        let constraints = snapshot_constraints(&source, self.session.registry());
        let layout = arrange_presentations(
            &source,
            Size::new(full.w as f64, full.h as f64),
            &constraints,
            self.ports.surfaces.expanded,
            0.0,
            true,
        );
        let r = layout.reservations;
        let main = Rect::new(
            full.x + r.left as f32,
            full.y + r.top as f32,
            (full.w - (r.left + r.right) as f32).max(0.0),
            (full.h - (r.top + r.bottom) as f32).max(0.0),
        );
        self.ports.main = main;
        self.ports.surfaces.sizes.main = Size::new(main.w as f64, main.h as f64);
        self.edit.panel.layout = Some(layout);
    }

    /// Panel state for automated flows: each panel's mode, edge, saved open state, drawn
    /// rectangle and reveal, the reservations, the open menu and the running gesture.
    pub(crate) fn trace_panels(&self) -> serde_json::Value {
        let p = &self.edit.panel;
        let Some(layout) = p.layout.as_ref() else {
            return serde_json::json!({
                "panels": {},
                "menu": p.menu.as_ref().map(|(id, mode)| serde_json::json!([id, mode.map(Presentation::as_str)])),
            });
        };
        let panels: serde_json::Map<String, serde_json::Value> = layout
            .panels
            .iter()
            .map(|(id, g)| {
                let drawn = p.drawn.get(id);
                (
                    id.clone(),
                    serde_json::json!({
                        "mode": g.state.presentation.as_str(),
                        "anchor": g.state.anchor.map(Edge::as_str),
                        "open": g.state.open,
                        "shown": drawn.map(|d| d.1),
                        "rect": drawn.map(|d| [d.0.x, d.0.y, d.0.w, d.0.h]),
                        "painted": p.painted.get(id).map(|r| [r.x, r.y, r.w, r.h]),
                        "revealed": p.revealed.contains(id),
                    }),
                )
            })
            .collect();
        let r = layout.reservations;
        serde_json::json!({
            "panels": panels,
            "reservations": [r.top, r.bottom, r.left, r.right],
            "adapted": layout.adapted,
            "feasible": layout.feasible,
            "menu": p.menu.as_ref().map(|(id, mode)| serde_json::json!([id, mode.map(Presentation::as_str)])),
            "drag": p.drag.as_ref().map(|d| serde_json::json!({"id": d.id, "started": d.started, "free": d.free, "compact": d.compact})),
            "notice": self.panel_notice(),
            "pending": p.reveal_at.iter().map(|(id, (want, at))| (id.clone(), serde_json::json!([want, at]))).collect::<serde_json::Map<_, _>>(),
            "full": [p.full_main.x, p.full_main.y, p.full_main.w, p.full_main.h],
        })
    }

    /// The panels notice (`panelNotice`).
    pub(crate) fn panel_notice(&self) -> Option<&'static str> {
        self.edit
            .panel
            .layout
            .as_ref()
            .filter(|l| l.adapted || !l.feasible)
            .map(|_| {
                "Painéis com tamanho ou abertura temporários. Amplie a janela para restaurar as preferências."
            })
    }

    /// Focus inside panel content (`.widget-content:focus-within` and `onBlurCapture`):
    /// leaving it hides a floating panel unless the pointer is inside.
    pub(crate) fn panels_focus(&mut self, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let mut focused = HashSet::new();
        for (id, handle) in &self.edit.panel.focus {
            if handle.contains_focused(window, cx) {
                focused.insert(id.clone());
            }
        }
        let left: Vec<String> = self
            .edit
            .panel
            .focused
            .difference(&focused)
            .cloned()
            .collect();
        for id in left {
            if !self.edit.panel.inside.contains(&id) {
                self.panel_hover(&id, false, now);
            }
        }
        self.edit.panel.focused = focused;
    }

    /// Reveal timers of floating panels; returns whether one is pending.
    pub(crate) fn panels_tick(&mut self, now: f64) -> bool {
        let due: Vec<(String, bool)> = self
            .edit
            .panel
            .reveal_at
            .iter()
            .filter(|(_, (_, at))| now >= *at)
            .map(|(id, (want, _))| (id.clone(), *want))
            .collect();
        for (id, want) in due {
            self.edit.panel.reveal_at.remove(&id);
            if !want && self.edit.panel.drag.as_ref().is_some_and(|d| d.id == id) {
                continue;
            }
            // Focus inside the content holds the reveal.
            if !want && self.edit.panel.focused.contains(&id) {
                continue;
            }
            if want {
                self.edit.panel.revealed.insert(id);
            } else {
                self.edit.panel.revealed.remove(&id);
            }
        }
        !self.edit.panel.reveal_at.is_empty()
            || self.edit.panel.motion.values().any(|tw| !tw.done(now))
    }

    /// Hover of a panel: reveal after 100 ms, hide after 280 ms (`hover`).
    pub(crate) fn panel_hover(&mut self, id: &str, hovered: bool, now: f64) {
        if hovered {
            self.edit.panel.inside.insert(id.to_owned());
        } else {
            self.edit.panel.inside.remove(id);
        }
        // An open presentation menu holds the panel revealed (`hold`).
        if !hovered && self.edit.panel.menu.as_ref().is_some_and(|(m, _)| m == id) {
            return;
        }
        let delay = if hovered { 100.0 } else { 280.0 };
        self.edit
            .panel
            .reveal_at
            .insert(id.to_owned(), (hovered, now + delay));
    }

    /// Ends every panel gesture and hides revealed panels (blur, viewport or mode changes).
    pub(crate) fn panels_reset(&mut self) {
        self.edit.panel.drag = None;
        self.edit.panel.reveal_at.clear();
        self.edit.panel.revealed.clear();
        self.edit.panel.inside.clear();
    }

    fn panel_geometry(
        &self,
        id: &str,
    ) -> Option<geppio_core::workbench::presentations::PanelGeometry> {
        self.edit.panel.layout.as_ref()?.panel(id).cloned()
    }

    pub(crate) fn panel_down(
        &mut self,
        id: &str,
        free: bool,
        compact: bool,
        pos: (f32, f32),
        cx: &mut Context<Self>,
    ) {
        let Some(g) = self.panel_geometry(id) else {
            return;
        };
        if self.session.recovery()
            || self.session.gesture_active()
            || self.edit.panel.drag.is_some()
            || self.pairs_active()
            || (free && !self.editing())
        {
            return;
        }
        let revealed = self.edit.panel.revealed.contains(id) || self.panel_menu_open(id);
        let rect = if free {
            let mut r = g.collapsed;
            if revealed {
                r.x = g.expanded.x;
                r.y = g.expanded.y;
            }
            r
        } else {
            g.expanded
        };
        self.edit.panel.reveal_at.remove(id);
        self.edit.panel.drag = Some(PanelDrag {
            id: id.to_owned(),
            down: pos,
            rect,
            state: g.state.clone(),
            started: false,
            free,
            compact,
            next: PresentationPatch::default(),
        });
        cx.notify();
    }

    fn panel_menu_open(&self, id: &str) -> bool {
        self.edit.panel.menu.as_ref().is_some_and(|(m, _)| m == id)
    }

    /// Pointer move of a panel gesture (`move`); `pressed`: the button is still down.
    pub(crate) fn panel_move(
        &mut self,
        pos: (f32, f32),
        pressed: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut d) = self.edit.panel.drag.clone() else {
            return false;
        };
        if !pressed {
            self.edit.panel.drag = None;
            cx.notify();
            return true;
        }
        let (dx, dy) = ((pos.0 - d.down.0) as f64, (pos.1 - d.down.1) as f64);
        if !d.started && (dx * dx + dy * dy).sqrt() < 4.0 {
            return true;
        }
        d.started = true;
        if !d.compact
            && let Some(layout) = self.edit.panel.layout.clone()
        {
            if d.free {
                let area = layout.normal;
                let x = geppio_core::layout::geometry::clamp(
                    d.rect.x + dx,
                    area.x,
                    area.x + area.width - d.rect.width,
                );
                let y = geppio_core::layout::geometry::clamp(
                    d.rect.y + dy,
                    area.y,
                    area.y + area.height - d.rect.height,
                );
                d.next = PresentationPatch {
                    position: Some(point_object(x, y)),
                    ..Default::default()
                };
            } else {
                let state = &d.state;
                let h = horizontal(state.anchor);
                let delta = match state.anchor {
                    Some(Edge::Top) => dy,
                    Some(Edge::Bottom) => -dy,
                    Some(Edge::Left) => dx,
                    _ => -dx,
                };
                let shown = layout.panel(&d.id).is_some_and(|p| p.shown) && state.open;
                let current = if h { d.rect.height } else { d.rect.width };
                let extent = if shown { current } else { PANEL_BAR_HEIGHT } + delta;
                let r = layout.reservations;
                let maximum = if h {
                    layout.normal.height
                        + if state.anchor == Some(Edge::Top) {
                            r.top
                        } else {
                            r.bottom
                        }
                } else {
                    layout.normal.width
                        + if state.anchor == Some(Edge::Left) {
                            r.left
                        } else {
                            r.right
                        }
                };
                let min = if h { PANEL_MIN.1 } else { PANEL_MIN.0 };
                let open = maximum >= min && extent >= min - COLLAPSE_DISTANCE;
                let key = if h { "height" } else { "width" };
                let mut preferred = state.preferred.clone();
                if open {
                    let value = min.max(4096f64.min(maximum).min(extent));
                    preferred = preferred.with(key, Json::Number(value));
                }
                d.next = PresentationPatch {
                    open: Some(open),
                    preferred: Some(preferred),
                    ..Default::default()
                };
            }
        }
        self.edit.panel.drag = Some(d);
        cx.notify();
        true
    }

    /// Release of a panel gesture: a click toggles (or reveals a free panel), a drag saves.
    pub(crate) fn panel_up(&mut self, pos: (f32, f32), cx: &mut Context<Self>) -> bool {
        if self.edit.panel.drag.is_none() {
            return false;
        }
        self.panel_move(pos, true, cx);
        let Some(d) = self.edit.panel.drag.take() else {
            return true;
        };
        let now = geppui::now(cx);
        if !d.started {
            if d.free {
                self.edit.panel.revealed.insert(d.id.clone());
            } else {
                let open = if d.compact { true } else { !d.state.open };
                self.present_panel(
                    &d.id,
                    PresentationPatch {
                        open: Some(open),
                        ..Default::default()
                    },
                    cx,
                );
            }
        } else if !d.compact {
            self.present_panel(&d.id, d.next.clone(), cx);
            if d.free {
                self.edit.panel.revealed.insert(d.id.clone());
                if !self.edit.panel.inside.contains(&d.id) {
                    self.panel_hover(&d.id, false, now);
                }
            }
        }
        cx.notify();
        true
    }

    /// Enter or Space on a panel bar or divider (`onKeyDown`).
    pub(crate) fn panel_key(
        &mut self,
        id: &str,
        free: bool,
        compact: bool,
        e: &KeyDownEvent,
        cx: &mut Context<Self>,
    ) {
        let key = e.keystroke.key.as_str();
        if key == "escape" && self.edit.panel.drag.is_some() {
            self.edit.panel.drag = None;
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if (key == "enter" || key == "space")
            && self.edit.panel.drag.is_none()
            && !self.pairs_active()
            && !self.session.recovery()
            && !self.session.gesture_active()
        {
            cx.stop_propagation();
            if free {
                self.edit.panel.revealed.insert(id.to_owned());
                cx.notify();
                return;
            }
            let open = self.panel_geometry(id).is_some_and(|g| g.state.open);
            self.present_panel(
                id,
                PresentationPatch {
                    open: Some(if compact { true } else { !open }),
                    ..Default::default()
                },
                cx,
            );
        }
    }

    /// `tx.present`: the session decides, the toast shows its message.
    pub(crate) fn present_panel(
        &mut self,
        id: &str,
        patch: PresentationPatch,
        cx: &mut Context<Self>,
    ) -> bool {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let full = self.edit.panel.full_main;
        let bounds = Some((
            Size::new(full.w as f64, full.h as f64),
            self.ports.surfaces.expanded,
            0.0,
        ));
        let mut store = self.store.clone();
        let before = self.frame_rects();
        let ok = self.session.present(id, &patch, bounds, &mut store).is_ok();
        self.store = store;
        // Main's port follows the new reservations now, so its frames move with the panel.
        self.arrange_panels();
        let after = self.frame_rects();
        self.edit.flips = crate::edit::flips_between(&before, &after, now, reduced, None);
        self.edit.panel.commit_motion = ok;
        if !ok {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        }
        if ok && !self.editing() {
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        }
        if ok && patch.presentation.is_some() {
            self.panels_reset();
        }
        cx.notify();
        ok
    }

    /// The presentation control of a Main frame in Edit ("Normal ▾"); on a closed left or
    /// right bar it runs down without its chevron.
    pub(crate) fn presentation_control(
        &mut self,
        id: &str,
        vertical: bool,
        free_bar: bool,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if !self.editing() {
            return None;
        }
        let draft = self.session.draft();
        let type_id = draft.type_of(id)?.to_owned();
        let ty = self.session.registry().get(&type_id)?;
        let region = draft.placement(id)?.region;
        if available_presentations(ty, region).len() <= 1 {
            return None;
        }
        let state = presentation_for(draft, id, self.session.registry())?;
        let title = crate::i18n::t(&ty.title);
        let label: SharedString = crate::i18n::t("Apresentação de {0}")
            .replace("{0}", &title)
            .into();
        let tooltip: SharedString = format!(
            "{}: {}{}",
            label,
            crate::i18n::t(mode_label(state.presentation)),
            state
                .anchor
                .map(|e| format!(" · {}", crate::i18n::t(edge_label(e))))
                .unwrap_or_default()
        )
        .into();
        let anchor = self
            .edit
            .panel
            .anchors
            .entry(id.to_owned())
            .or_default()
            .clone();
        let open = self.panel_menu_open(id);
        let recovery = self.session.recovery();
        let view = id.to_owned();
        let key = format!("presentation-{id}");
        let text = crate::i18n::t(mode_label(state.presentation)).to_string();
        let handle = geppui::button::registered_focus(&SharedString::from(key.clone()), cx);
        let ring = t.ring;
        let el = div()
            .id(SharedString::from(key.clone()))
            .role(gpui::Role::Button)
            .aria_label(label)
            .aria_expanded(open)
            .when(!recovery, |el| el.track_focus(&handle))
            .focus_visible(move |s| {
                s.shadow(vec![
                    gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), ring)
                        .spread_radius(gpui::px(2.0)),
                ])
            })
            .flex_none()
            .flex()
            .items_center()
            .gap(m.px(4.0))
            .rounded(m.px(5.0))
            .border(m.border(1.0))
            .border_color(t.border)
            .bg(t.surface)
            .text_size(m.px(11.0))
            .text_color(t.text_muted)
            .overflow_hidden()
            .when(recovery, |el| el.opacity(0.5))
            .when(!recovery, |el| el.cursor_pointer())
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(move |this, _, _, cx| {
                if this.session.recovery() {
                    return;
                }
                this.edit.panel.menu = if this.panel_menu_open(&view) {
                    None
                } else {
                    Some((view.clone(), None))
                };
                cx.notify();
            }))
            .child(anchor_probe(&anchor));
        let el = if vertical {
            el.flex_col()
                .w(m.px(24.0))
                .py(m.px(4.0))
                .px(m.px(2.0))
                .gap_0()
                .line_height(m.px(12.0))
                .children(text.chars().map(|c| div().child(c.to_string())))
        } else {
            el.h(m.px(24.0))
                .px(m.px(6.0))
                .line_height(m.px(16.0))
                .when(free_bar, |el| el.max_w(m.px(95.0)))
                .child(
                    div()
                        .min_w_0()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis()
                        .child(text),
                )
                .child(
                    div().flex_none().child(
                        geppui::icon("chevron-down", m)
                            .size(12.0)
                            .color(t.text_muted),
                    ),
                )
        };
        Some(geppui::titled(el, key, Some(tooltip)).into_any_element())
    }

    /// The presentation menu: modes, then the edges of the chosen mode (`PresentationControls`).
    pub(crate) fn presentation_menu(
        &mut self,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let (id, choice) = self.edit.panel.menu.clone()?;
        if !self.editing() {
            self.edit.panel.menu = None;
            return None;
        }
        let draft = self.session.draft();
        let type_id = draft.type_of(&id)?.to_owned();
        let ty = self.session.registry().get(&type_id)?;
        let region = draft.placement(&id)?.region;
        let modes = available_presentations(ty, region);
        let state = presentation_for(draft, &id, self.session.registry())?;
        let anchor = self
            .edit
            .panel
            .anchors
            .get(&id)
            .cloned()
            .unwrap_or_default();
        let occupied = |edge: Edge| {
            draft.organization.presentations.entries.iter().any(|e| {
                e.view_id != id
                    && e.presentation != Presentation::Normal
                    && e.anchor == Some(edge)
                    && draft
                        .placements
                        .iter()
                        .any(|p| p.id == e.view_id && p.region == geppio_core::layout::Region::Main)
            })
        };
        let dismiss = cx.listener(|this, _: &(), _, cx| {
            this.edit.panel.menu = None;
            cx.notify();
        });
        let escape_view = id.clone();
        let escape = cx.listener(move |this, _: &(), _, cx| {
            this.close_presentation_menu(&escape_view);
            cx.notify();
        });
        let mut items: Vec<AnyElement> = Vec::new();
        // `width: max-content; min-width: 118px`: the widest label, its icon column and the
        // paddings (an 11px label averages 5.8px per character).
        let mut labels: Vec<(String, bool)> = Vec::new();
        let mut ids: Vec<SharedString> = Vec::new();
        match choice {
            None => {
                for mode in modes {
                    let view = id.clone();
                    let item_id =
                        SharedString::from(format!("presentation-mode-{}", mode.as_str()));
                    let label = crate::i18n::t(mode_label(mode)).to_string();
                    labels.push((label.clone(), true));
                    ids.push(item_id.clone());
                    items.push(
                        menu_item(item_id, label)
                            .small()
                            .mark(state.presentation == mode)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if mode == Presentation::Normal {
                                    this.apply_presentation(&view, mode, None, cx);
                                } else {
                                    this.edit.panel.menu = Some((view.clone(), Some(mode)));
                                    cx.notify();
                                }
                            }))
                            .into_any_element(),
                    );
                }
            }
            Some(mode) => {
                let view = id.clone();
                let back = format!("‹ {}", crate::i18n::t(mode_label(mode)));
                labels.push((back.clone(), false));
                ids.push("presentation-back".into());
                items.push(
                    menu_item("presentation-back", back)
                        .small()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.edit.panel.menu = Some((view.clone(), None));
                            cx.notify();
                        }))
                        .into_any_element(),
                );
                let mut edges: Vec<Option<Edge>> = EDGES.iter().copied().map(Some).collect();
                if mode == Presentation::Overlay {
                    edges.push(None);
                }
                for edge in edges {
                    let busy = edge.is_some_and(occupied);
                    let selected = state.presentation == mode && state.anchor == edge;
                    let label = format!(
                        "{}{}",
                        crate::i18n::t(edge.map_or("Sem âncora", edge_label)),
                        if busy {
                            format!(" · {}", crate::i18n::t("Ocupado"))
                        } else {
                            String::new()
                        }
                    );
                    let view = id.clone();
                    let item_id = SharedString::from(format!(
                        "presentation-edge-{}",
                        edge.map_or("free", Edge::as_str)
                    ));
                    labels.push((label.clone(), true));
                    if !busy {
                        ids.push(item_id.clone());
                    }
                    items.push(
                        menu_item(item_id, label)
                            .small()
                            .mark(selected)
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.apply_presentation(&view, mode, Some(edge), cx);
                            }))
                            .into_any_element(),
                    );
                }
            }
        }
        let _ = (m, t);
        let width = labels
            .iter()
            .map(|(label, icon)| {
                label.chars().count() as f32 * 5.8 + 12.0 + if *icon { 18.0 } else { 0.0 }
            })
            .fold(0.0f32, f32::max)
            + 8.0;
        Some(
            // One popover id per level, so each level focuses its first item when it opens
            // (the chosen row is replaced and must not keep the keys).
            popover(
                SharedString::from(format!(
                    "presentation-menu-{id}-{}",
                    choice.map_or("modes", Presentation::as_str)
                )),
                &anchor,
            )
            .width(width.max(118.0))
            .padding(3.0, 3.0)
            .radius(6.0)
            .menu(ids)
            .on_dismiss(move |w, cx| dismiss(&(), w, cx))
            .on_escape(move |w, cx| escape(&(), w, cx))
            .children(items)
            .into_any_element(),
        )
    }

    fn apply_presentation(
        &mut self,
        id: &str,
        mode: Presentation,
        edge: Option<Option<Edge>>,
        cx: &mut Context<Self>,
    ) {
        let patch = PresentationPatch {
            presentation: Some(mode),
            anchor: if mode == Presentation::Normal {
                None
            } else {
                edge
            },
            ..Default::default()
        };
        if self.present_panel(id, patch, cx) {
            self.close_presentation_menu(id);
        }
        cx.notify();
    }

    /// Closes the presentation menu and returns focus to its control, so the keys keep a
    /// target after the chosen row goes away.
    pub(crate) fn close_presentation_menu(&mut self, id: &str) {
        self.edit.panel.menu = None;
        self.edit.focus = Some(crate::edit::FocusRequest::Control(format!(
            "presentation-{id}"
        )));
    }

    /// The panels of Main: frames at their arranged rectangles, closed bars, the docked
    /// dividers and the edit controls. Order follows the reference's stacking: docked
    /// panels (16), floating panels (18), the docked dividers (19), then a hovered or
    /// focused floating panel (20).
    pub(crate) fn panel_layer(
        &mut self,
        m: Metrics,
        t: Theme,
        editing: bool,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let Some(layout) = self.edit.panel.layout.clone() else {
            self.edit.panel.drawn.clear();
            self.edit.panel.motion.clear();
            return Vec::new();
        };
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let full = self.edit.panel.full_main;
        let commit = std::mem::take(&mut self.edit.panel.commit_motion);
        let gesture = self
            .edit
            .panel
            .drag
            .as_ref()
            .filter(|d| d.started)
            .map(|d| d.id.clone());
        let (mut docked, mut floating, mut dividers, mut raised) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for (id, g) in &layout.panels {
            let state = &g.state;
            let Some(fixture) = self
                .session
                .registry()
                .get(&state.type_id)
                .and_then(|t| t.fixture.clone())
            else {
                continue;
            };
            let overlay = state.presentation == Presentation::Overlay;
            let menu_open = self.panel_menu_open(id);
            let revealed = self.edit.panel.revealed.contains(id) || menu_open;
            let shown = g.shown && (!overlay || revealed);
            let rect = if shown { g.expanded } else { g.collapsed };
            let target = Rect::new(
                full.x + rect.x as f32,
                full.y + rect.y as f32,
                rect.width as f32,
                rect.height as f32,
            );
            // Motion: a floating reveal runs on the region timing (340ms in, 120ms out); a
            // committed change runs 240ms; a gesture, a mode change or a viewport change
            // jumps.
            let previous = self
                .edit
                .panel
                .drawn
                .insert(id.clone(), (target, shown, state.presentation));
            let running = self
                .edit
                .panel
                .motion
                .get(id)
                .copied()
                .filter(|tw| !tw.done(now));
            let tween = match previous {
                Some((before, was_shown, mode))
                    if before != target
                        && mode == state.presentation
                        && gesture.as_deref() != Some(id.as_str())
                        && !reduced =>
                {
                    let reveal = overlay && was_shown != shown;
                    (reveal || commit).then(|| Tween {
                        from: running.map_or(before, |tw| tw.at(now)),
                        to: target,
                        start_ms: now,
                        duration_ms: match (reveal, shown) {
                            (true, true) => motion::duration::REGION,
                            (true, false) => motion::duration::SIDEBAR_HIDE,
                            _ => motion::duration::FLIGHT,
                        },
                        easing: if reveal {
                            motion::REGION
                        } else {
                            motion::FLIGHT
                        },
                    })
                }
                Some((before, _, mode)) if before == target && mode == state.presentation => {
                    running
                }
                _ => None,
            };
            match tween {
                Some(tw) => {
                    self.edit.panel.motion.insert(id.clone(), tw);
                }
                None => {
                    self.edit.panel.motion.remove(id);
                }
            }
            let window = tween
                .filter(|tw| !tw.done(now))
                .map_or(target, |tw| tw.at(now));
            self.edit.panel.painted.insert(id.clone(), window);
            let p = m.place(window);
            let vertical = !shown && matches!(state.anchor, Some(Edge::Left | Edge::Right));
            let free = overlay && state.anchor.is_none();
            let compact = state.presentation == Presentation::Docked && !shown;
            let scroll = self.scroll_handle(&format!("panel-{id}"));
            let props = self.props_handler(cx);
            let name = (fixture == "properties" && !editing && shown)
                .then(|| self.name_field.clone().into_any_element());
            let scope = self
                .edit
                .panel
                .focus
                .entry(id.clone())
                .or_insert_with(|| cx.focus_handle())
                .clone();
            let content = div()
                .w_full()
                .track_focus(&scope)
                .child(widgets::content(
                    &fixture,
                    widgets::Fit::new(false, window.w),
                    m,
                    t,
                    &self.properties,
                    props,
                    name,
                    editing,
                ))
                .into_any_element();
            // The content goes away while focus is inside it: the keys move to the bar
            // (`presentation.open === false && focusInside`).
            if !shown && self.edit.panel.focused.contains(id) {
                self.edit.panel.focused.remove(id);
                self.edit.focus = Some(crate::edit::FocusRequest::Control(format!(
                    "panel-bar-{id}"
                )));
                cx.notify();
            }
            let frame = widgets::frame(
                &fixture,
                false,
                m,
                t,
                content,
                &scroll,
                widgets::FrameLook {
                    bar: !shown,
                    vertical,
                    free_bar: free && !shown,
                    floating: overlay,
                    locked: editing,
                    ..Default::default()
                },
            );
            let group = SharedString::from(format!("panel-{id}"));
            let hover_id = id.clone();
            let mut el = div()
                .id(SharedString::from(format!("panel-frame-{id}")))
                .group(group.clone())
                .absolute()
                .left(p.left)
                .top(p.top)
                .w(p.width)
                .h(p.height)
                // An edit gesture crossing a panel keeps reaching the workbench.
                .when(self.edit.gesture.is_none(), |el| el.occlude())
                .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                    let now = geppui::now(cx);
                    this.panel_hover(&hover_id, *hovered, now);
                    cx.notify();
                }))
                .child(frame);
            // The heading of a closed docked panel opens it; a free floating panel's heading
            // reveals it and, in Edit, moves it ("Painel de {0}").
            if compact || free {
                let (down_id, key_id) = (id.clone(), id.clone());
                let title = crate::i18n::t(widgets::title(&fixture));
                let key = format!("panel-bar-{id}");
                let handle = geppui::button::registered_focus(&SharedString::from(key.clone()), cx);
                let bar_focus = handle.clone();
                let ring = t.ring;
                let bar = div()
                    .id(SharedString::from(key))
                    .role(gpui::Role::Button)
                    .aria_label(crate::i18n::t("Painel de {0}").replace("{0}", &title))
                    .aria_expanded(shown)
                    .track_focus(&handle)
                    .focus_visible(move |s| {
                        s.shadow(vec![
                            gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), ring)
                                .spread_radius(gpui::px(2.0)),
                        ])
                    })
                    .absolute()
                    .top_0()
                    .left_0();
                let bar = if vertical {
                    bar.w(m.px(PANEL_BAR_HEIGHT as f32)).h_full()
                } else {
                    bar.w_full()
                        .h(m.px(if shown { 42.0 } else { PANEL_BAR_HEIGHT as f32 }))
                };
                el = el.child(
                    bar.when(compact, |el| el.cursor_pointer())
                        .when(free && !shown, |el| el.cursor_move())
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(move |this, e: &MouseDownEvent, window, cx| {
                                if !(free && !this.editing()) {
                                    window.focus(&bar_focus, cx);
                                }
                                let z = this.metrics.zoom;
                                let pos =
                                    (f32::from(e.position.x) / z, f32::from(e.position.y) / z);
                                this.panel_down(&down_id, free, compact, pos, cx);
                                cx.stop_propagation();
                            }),
                        )
                        .on_key_down(cx.listener(move |this, e: &KeyDownEvent, _, cx| {
                            this.panel_key(&key_id, free, compact, e, cx);
                        })),
                );
            }
            // Edit controls (`.widget-local-controls`): shown while the frame is hovered or
            // its menu is open.
            if editing {
                let control = self.presentation_control(id, vertical, free && !shown, m, t, cx);
                let rid = id.clone();
                let title = crate::i18n::t(widgets::title(&fixture));
                let remove = div()
                    .id(SharedString::from(format!("panel-remove-{id}")))
                    .role(gpui::Role::Button)
                    .aria_label(crate::i18n::t("Remover {0}").replace("{0}", &title))
                    .flex_none()
                    .size(m.px(24.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(m.px(8.0))
                    .bg(gpui::rgb(0xd72c42))
                    .hover(|s| s.bg(gpui::rgb(0xb92639)))
                    .cursor_pointer()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.removing = Some(rid.clone());
                        cx.notify();
                    }))
                    .child(geppui::icon("x-mark", m).size(14.0).color(gpui::white()));
                let inset = if shown { 9.0 } else { 3.0 };
                let controls = div()
                    .absolute()
                    .right(m.px(inset))
                    .flex()
                    .gap(m.px(4.0))
                    .when(vertical, |el| {
                        el.bottom(m.px(3.0)).flex_col().items_center()
                    })
                    .when(!vertical, |el| el.top(m.px(inset)).items_center())
                    .when(!menu_open, |el| {
                        el.opacity(0.0)
                            .group_hover(group.clone(), |s| s.opacity(1.0))
                    })
                    .children(control)
                    .child(remove);
                el = el.child(controls);
            }
            let raised_now = overlay && (self.edit.panel.inside.contains(id) || menu_open);
            let el = el.into_any_element();
            match state.presentation {
                Presentation::Docked => docked.push(el),
                _ if raised_now => raised.push(el),
                _ => floating.push(el),
            }
            // The divider of an open docked panel (`presentation-splitter`).
            if state.presentation == Presentation::Docked && g.shown {
                dividers.push(self.panel_divider(id, state, window, m, t, cx));
            }
        }
        let mut out = docked;
        out.extend(floating);
        out.extend(dividers);
        out.extend(raised);
        // A pressed panel handle keeps the pointer (`setPointerCapture`): a cover takes the
        // moves and the release, with the gesture's cursor.
        if let Some(d) = self.edit.panel.drag.as_ref() {
            // The pressed handle's own cursor: a closed free bar moves, a closed docked bar
            // points, a divider resizes.
            let closed = self
                .edit
                .panel
                .layout
                .as_ref()
                .and_then(|l| l.panel(&d.id))
                .is_some_and(|g| !g.shown)
                || (d.free && !self.edit.panel.revealed.contains(&d.id));
            let cursor = if d.free {
                if closed {
                    gpui::CursorStyle::ClosedHand
                } else {
                    gpui::CursorStyle::Arrow
                }
            } else if d.compact {
                gpui::CursorStyle::PointingHand
            } else if horizontal(d.state.anchor) {
                gpui::CursorStyle::ResizeRow
            } else {
                gpui::CursorStyle::ResizeColumn
            };
            out.push(
                gpui::deferred(
                    div()
                        .id("panel-drag-cover")
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
                            this.panel_move(pos, pressed, cx);
                        }))
                        .on_mouse_up(
                            MouseButton::Left,
                            cx.listener(|this, e: &gpui::MouseUpEvent, _, cx| {
                                let m = this.metrics;
                                let pos = (m.css(e.position.x), m.css(e.position.y));
                                this.panel_up(pos, cx);
                            }),
                        ),
                )
                .with_priority(5)
                .into_any_element(),
            );
        }
        out
    }

    fn panel_divider(
        &mut self,
        id: &str,
        state: &WidgetPresentation,
        window: Rect,
        m: Metrics,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let h = horizontal(state.anchor);
        let r = match state.anchor {
            Some(Edge::Top) => Rect::new(window.x, window.y + window.h, window.w, 9.0),
            Some(Edge::Bottom) => Rect::new(window.x, window.y - 9.0, window.w, 9.0),
            Some(Edge::Left) => Rect::new(window.x + window.w, window.y, 9.0, window.h),
            _ => Rect::new(window.x - 9.0, window.y, 9.0, window.h),
        };
        let p = m.place(r);
        let title = self
            .session
            .registry()
            .get(&state.type_id)
            .map(|t| crate::i18n::t(&t.title).to_string())
            .unwrap_or_default();
        let label = crate::i18n::t(if h { "Altura de {0}" } else { "Largura de {0}" })
            .replace("{0}", &title);
        let key = format!("panel-divider-{id}");
        let handle = geppui::button::registered_focus(&SharedString::from(key.clone()), cx);
        let active = self.edit.panel.drag.as_ref().is_some_and(|d| d.id == id);
        let divider_focus = handle.clone();
        let (down_id, key_id) = (id.to_owned(), id.to_owned());
        let group = SharedString::from(key.clone());
        let line = if h {
            div()
                .absolute()
                .left(m.px(11.0))
                .right(m.px(11.0))
                .top(m.px(3.5))
                .h(m.px(2.0))
        } else {
            div()
                .absolute()
                .top(m.px(11.0))
                .bottom(m.px(11.0))
                .left(m.px(3.5))
                .w(m.px(2.0))
        };
        div()
            .id(SharedString::from(key))
            .group(group.clone())
            .role(gpui::Role::Splitter)
            .aria_label(label)
            .aria_expanded(true)
            .track_focus(&handle)
            .absolute()
            .left(p.left)
            .top(p.top)
            .w(p.width)
            .h(p.height)
            .when(h, |el| el.cursor_row_resize())
            .when(!h, |el| el.cursor_col_resize())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &MouseDownEvent, window, cx| {
                    window.focus(&divider_focus, cx);
                    let z = this.metrics.zoom;
                    let pos = (f32::from(e.position.x) / z, f32::from(e.position.y) / z);
                    this.panel_down(&down_id, false, false, pos, cx);
                    cx.stop_propagation();
                }),
            )
            .on_key_down(cx.listener(move |this, e: &KeyDownEvent, _, cx| {
                this.panel_key(&key_id, false, false, e, cx);
            }))
            .child(
                line.rounded(m.px(1.0))
                    .bg(t.accent)
                    .when(!active, |el| el.opacity(0.0))
                    .group_hover(group, |s| s.opacity(1.0)),
            )
            .into_any_element()
    }
}
