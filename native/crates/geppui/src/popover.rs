//! Anchored popovers and menus (`.workspace-popover`, `.profile-menu`, `.ui-context-menu`).
//!
//! Position follows the reference algorithm (`src/geppui/primitives.tsx` `Popover`):
//! - **below** (default): right-aligned to the anchor, 9px under it, clamped 11px from the
//!   window edges, flipped above the anchor when it does not fit;
//! - **rail**: 11px right of the anchor, bottom-aligned with it, clamped 9px from the edges;
//! - **at**: a pointer position (context menus), flipped above when it does not fit.
//!
//! The height comes from the previous frame, like the reference's hidden pre-measure. Opening
//! plays `profile-enter` (opacity 0→1, translateY −4→0, 140ms ease-out); closing is instant.
//! Menus cycle focus with ArrowUp/ArrowDown (wrapping) and Home/End, and focus their first
//! item on open.
use std::{cell::Cell, rc::Rc};

use gpui::{
    AnyElement, App, ClickEvent, ElementId, InteractiveElement, IntoElement, KeyDownEvent,
    MouseDownEvent, ParentElement, Pixels, Point, RenderOnce, SharedString,
    StatefulInteractiveElement, Styled, Window, anchored, canvas, deferred, div, point,
    prelude::FluentBuilder, px,
};

use crate::{
    AnchorHandle, appearance, button::focus_handle, button::hover_state, css_weight, icon,
    icon_button, metrics, motion,
};

/// Where a popover opens.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Placement {
    /// Right-aligned under the anchor.
    Below,
    /// Beside a rail button, bottom-aligned.
    Rail,
    /// At a window position (context menus).
    At(Point<Pixels>),
}

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Popover {
    id: SharedString,
    anchor: AnchorHandle,
    placement: Placement,
    width: f32,
    padding: (f32, f32),
    max_height: Option<f32>,
    fixed_height: bool,
    contained: bool,
    menu: Vec<SharedString>,
    children: Vec<AnyElement>,
    on_dismiss: Option<Handler>,
    on_escape: Option<Handler>,
}

/// A popover anchored under `anchor`. Sizes are CSS pixels.
pub fn popover(id: impl Into<SharedString>, anchor: &AnchorHandle) -> Popover {
    Popover {
        id: id.into(),
        anchor: anchor.clone(),
        placement: Placement::Below,
        width: 346.0,
        padding: (16.0, 16.0),
        max_height: None,
        fixed_height: false,
        contained: false,
        menu: Vec::new(),
        children: Vec::new(),
        on_dismiss: None,
        on_escape: None,
    }
}

impl Popover {
    pub fn width(mut self, width: f32) -> Self {
        self.width = width;
        self
    }
    /// Vertical and horizontal padding.
    pub fn padding(mut self, y: f32, x: f32) -> Self {
        self.padding = (y, x);
        self
    }
    /// Called on a pointer press outside the popover (light dismiss).
    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
    /// Called on Escape while focus is inside the popover.
    pub fn on_escape(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_escape = Some(Rc::new(handler));
        self
    }
    pub fn placement(mut self, placement: Placement) -> Self {
        self.placement = placement;
        self
    }
    /// A CSS max-height below the available height.
    pub fn max_height(mut self, height: f32) -> Self {
        self.max_height = Some(height);
        self
    }
    /// A fixed height of `min(height, available)` (`.plugins-menu`).
    pub fn height(mut self, height: f32) -> Self {
        self.max_height = Some(height);
        self.fixed_height = true;
        self
    }
    /// The panel clips instead of scrolling; an inner viewport scrolls (the bars library).
    pub fn contained(mut self) -> Self {
        self.contained = true;
        self
    }
    /// Menu item ids, in order, for arrow-key focus cycling and initial focus.
    pub fn menu(mut self, items: Vec<SharedString>) -> Self {
        self.menu = items;
        self
    }
}

/// Top-left of a popover of `size` for `placement` (all in window pixels).
pub fn place(
    placement: Placement,
    anchor: Option<gpui::Bounds<Pixels>>,
    size: (f32, f32),
    viewport: (f32, f32),
    scale: f32,
) -> (f32, f32) {
    let (w, h) = size;
    let (vw, vh) = viewport;
    let edge = if placement == Placement::Rail {
        9.0
    } else {
        11.0
    } * scale;
    let gap = 9.0 * scale;
    let clamp = |v: f32, lo: f32, hi: f32| v.min(hi.max(lo)).max(lo);
    let anchor = anchor.map(|b| {
        (
            f32::from(b.origin.y),
            f32::from(b.origin.x + b.size.width),
            f32::from(b.origin.y + b.size.height),
        )
    });
    let x = match (placement, anchor) {
        (Placement::At(p), _) => f32::from(p.x),
        (Placement::Rail, Some((_, right, _))) => right + 11.0 * scale,
        (Placement::Below, Some((_, right, _))) => right - w,
        _ => 70.0 * scale,
    };
    let left = clamp(x, edge, vw - w - edge);
    let top = match (placement, anchor) {
        (Placement::Rail, Some((_, _, bottom))) => clamp(bottom - h, edge, vh - h - edge),
        _ => {
            let (below, above) = match (placement, anchor) {
                (Placement::At(p), _) => (f32::from(p.y), f32::from(p.y)),
                (_, Some((top, _, bottom))) => (bottom + gap, top),
                _ => (55.0 * scale, 55.0 * scale),
            };
            if below + h <= vh - edge {
                below.max(edge)
            } else {
                (above - h - gap).max(edge)
            }
        }
    };
    (left, top)
}

impl ParentElement for Popover {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements)
    }
}

/// Opening progress: the keyed state records the first frame the overlay was rendered.
pub(crate) fn enter_progress(id: &SharedString, window: &mut Window, cx: &mut App) -> f32 {
    let now = appearance(cx).clock.now();
    let key = ElementId::Name(SharedString::from(format!("{id}::enter")));
    let opened = window.use_keyed_state(key, cx, move |_, _| now);
    let opened = *opened.read(cx);
    let duration = if appearance(cx).reduced_motion {
        0.0
    } else {
        motion::duration::OVERLAY_ENTER
    };
    if duration <= 0.0 {
        return 1.0;
    }
    let linear = ((now - opened) / duration).clamp(0.0, 1.0);
    if linear < 1.0 {
        window.request_animation_frame();
    }
    motion::EASE_OUT.ease(linear) as f32
}

impl RenderOnce for Popover {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let progress = enter_progress(&self.id, window, cx);
        let viewport = window.viewport_size();
        let (vw, vh) = (f32::from(viewport.width), f32::from(viewport.height));
        let scale = f32::from(m.px(1.0));
        let edge = if self.placement == Placement::Rail {
            9.0
        } else {
            11.0
        } * scale;
        let width = f32::from(m.px(self.width)).min(vw - 22.0 * scale);
        // Height measured on the previous frame (the reference's hidden pre-measure).
        let height_key = ElementId::Name(SharedString::from(format!("{}::height", self.id)));
        let measured = window
            .use_keyed_state(height_key, cx, |_, _| Rc::new(Cell::new(None::<f32>)))
            .read(cx)
            .clone();
        let height = measured.get();
        if height.is_none() {
            window.request_animation_frame();
        }
        let (left, top) = place(
            self.placement,
            self.anchor.bounds(),
            (width, height.unwrap_or(0.0)),
            (vw, vh),
            scale,
        );
        let mut available = vh - top - edge;
        if let Some(max) = self.max_height {
            available = available.min(f32::from(m.px(max)));
        }
        // Menus focus their first item once, when they open.
        if let Some(first) = self.menu.first() {
            let key = ElementId::Name(SharedString::from(format!("{}::focused", self.id)));
            let done = window.use_keyed_state(key, cx, |_, _| Cell::new(false));
            if !done.read(cx).get() {
                done.read(cx).set(true);
                let handle = focus_handle(first, None, window, cx);
                window.focus(&handle, cx);
            }
        }
        let items: Vec<_> = self
            .menu
            .iter()
            .map(|id| focus_handle(id, None, window, cx))
            .collect();
        let lift = f32::from(m.px(-4.0)) * (1.0 - progress);
        let dismiss = self.on_dismiss.clone();
        let escape = self.on_escape.clone();
        let probe = measured.clone();
        deferred(
            anchored().position(point(px(left), px(top + lift))).child(
                div()
                    .id(ElementId::Name(self.id.clone()))
                    .occlude()
                    .relative()
                    .w(px(width))
                    .max_h(px(available))
                    .when(self.fixed_height, |el| el.h(px(available)))
                    .when(self.contained, |el| el.flex().flex_col().overflow_hidden())
                    .when(!self.contained, |el| el.overflow_y_scroll())
                    .on_key_down(move |e: &KeyDownEvent, window, cx| {
                        let key = e.keystroke.key.as_str();
                        if key == "escape" {
                            if let Some(h) = &escape {
                                cx.stop_propagation();
                                h(window, cx);
                            }
                            return;
                        }
                        if items.is_empty() {
                            return;
                        }
                        let at = items.iter().position(|h| h.is_focused(window));
                        let n = items.len();
                        let next = match key {
                            "down" => Some(at.map_or(0, |i| (i + 1) % n)),
                            "up" => Some(at.map_or(n - 1, |i| (i + n - 1) % n)),
                            "home" => Some(0),
                            "end" => Some(n - 1),
                            _ => None,
                        };
                        if let Some(i) = next {
                            cx.stop_propagation();
                            window.focus(&items[i], cx);
                        }
                    })
                    .child(
                        canvas(
                            move |bounds, _, _| probe.set(Some(f32::from(bounds.size.height))),
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                    )
                    .py(m.px(self.padding.0))
                    .px(m.px(self.padding.1))
                    .rounded(m.px(14.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.elevated)
                    .shadow(vec![m.shadow(t.shadow_popover)])
                    .text_size(m.px(13.0))
                    .line_height(m.px(17.0))
                    .text_color(t.text)
                    .font_family(crate::UI_FONT)
                    .opacity(progress)
                    .when_some(dismiss, |el, handler| {
                        el.on_mouse_down_out(move |_: &MouseDownEvent, window, cx| {
                            handler(window, cx)
                        })
                    })
                    .children(self.children),
            ),
        )
        .with_priority(1)
    }
}

/// `.workspace-popover-heading`: a 15/24/650 title, an optional 12/18 muted description and
/// a muted close button pulled 4px into the corner.
pub fn popover_heading(
    id: impl Into<SharedString>,
    title: impl Into<SharedString>,
    description: Option<SharedString>,
    close_label: impl Into<SharedString>,
    on_close: impl Fn(&mut Window, &mut App) + 'static,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let t = crate::theme(cx);
    let m = metrics(window, cx);
    let id: SharedString = id.into();
    div()
        .flex()
        .justify_between()
        .items_start()
        .gap(m.px(11.0))
        .mb(m.px(16.0))
        .child(
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(m.px(15.0))
                        .line_height(m.px(24.0))
                        .font_weight(css_weight(650.0))
                        .child(title.into()),
                )
                .when_some(description, |el, d| {
                    el.child(
                        div()
                            .mt(m.px(3.0))
                            .text_size(m.px(12.0))
                            .line_height(m.px(18.0))
                            .text_color(t.text_muted)
                            .child(d),
                    )
                }),
        )
        .child(
            div().mt(m.px(-4.0)).mr(m.px(-4.0)).child(
                icon_button(SharedString::from(format!("{id}::close")), "x-mark")
                    .label(close_label.into())
                    .size(32.0, 18.0)
                    .color(t.text_muted)
                    .on_click(move |_, w, cx| on_close(w, cx)),
            ),
        )
}

/// A menu row (`.profile-menu-item` / `.workspace-command`): 18px muted icon, text, optional
/// trailing chevron. `compact` is the context-menu height (34px).
#[derive(IntoElement)]
pub struct MenuItem {
    id: SharedString,
    icon: Option<SharedString>,
    label: SharedString,
    trailing: Option<SharedString>,
    checked: bool,
    compact: bool,
    /// Accessible name when it differs from the visible label (`aria-label`).
    aria: Option<SharedString>,
    destructive: bool,
    disabled: bool,
    on_click: Option<ClickHandler>,
}

pub fn menu_item(id: impl Into<SharedString>, label: impl Into<SharedString>) -> MenuItem {
    MenuItem {
        id: id.into(),
        icon: None,
        label: label.into(),
        trailing: None,
        checked: false,
        compact: false,
        aria: None,
        destructive: false,
        disabled: false,
        on_click: None,
    }
}

impl MenuItem {
    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }
    pub fn trailing(mut self, name: impl Into<SharedString>) -> Self {
        self.trailing = Some(name.into());
        self
    }
    /// `menuitemradio` checked: accent on accent-soft.
    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }
    /// Context-menu row height (`.ui-context-menu` items, 34px).
    /// Accessible name when it differs from the visible label (`aria-label`).
    pub fn aria(mut self, label: impl Into<SharedString>) -> Self {
        self.aria = Some(label.into());
        self
    }
    pub fn compact(mut self) -> Self {
        self.compact = true;
        self
    }
    /// `.is-destructive` text.
    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for MenuItem {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let (state, hovered, progress) = hover_state(&self.id, window, cx);
        let scale = 1.0 + 0.1 * progress;
        let handler = self.on_click.clone().filter(|_| !self.disabled);
        let hover = crate::button::hover_listener(state);
        let hovered = hovered && !self.disabled;
        div()
            .id(ElementId::Name(self.id.clone()))
            .role(gpui::Role::MenuItem)
            .aria_label(self.aria.clone().unwrap_or_else(|| self.label.clone()))
            .when(self.checked, |el| el.aria_toggled(gpui::Toggled::True))
            .when(!self.disabled, |el| {
                el.track_focus(&crate::button::focus_handle(&self.id, None, window, cx))
            })
            .when(self.disabled, |el| el.opacity(0.5))
            .when(self.destructive, |el| el.text_color(t.destructive))
            .focus_visible(move |s| {
                s.bg(t.control_hover).shadow(vec![
                    gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), t.accent_border)
                        .spread_radius(gpui::px(1.0)),
                ])
            })
            .flex()
            .items_center()
            .gap(m.px(11.0))
            .w_full()
            .min_h(m.px(if self.compact { 34.0 } else { 38.0 }))
            .px(m.px(11.0))
            .py(m.px(9.0))
            .rounded(m.px(7.0))
            .line_height(m.px(20.0))
            .when(!self.disabled, |el| el.cursor_pointer())
            .when(self.checked, |el| el.bg(t.accent_soft).text_color(t.accent))
            .when(hovered && !self.checked, |el| el.bg(t.control_hover))
            .on_hover(hover)
            .when_some(handler, |el, h| el.on_click(move |e, w, cx| h(e, w, cx)))
            .when_some(self.icon.clone(), |el, name| {
                let color = if self.destructive {
                    t.destructive
                } else {
                    t.text_muted
                };
                el.child(icon(&name, m).size(18.0).color(color).scale(scale))
            })
            .child(div().flex_1().child(self.label.clone()))
            .when_some(self.trailing.clone(), |el, name| {
                el.child(icon(&name, m).size(14.0).color(t.text_muted).scale(scale))
            })
    }
}
