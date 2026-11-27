//! Anchored popovers and menus (`.workspace-popover`, `.profile-menu`).
//!
//! Position follows the reference algorithm: right-aligned to the anchor, 9px below it,
//! clamped 11px from the window edges, flipped above when it does not fit. Opening plays
//! `profile-enter` (opacity 0→1, translateY −4→0, 140ms ease-out); closing is instant.
use std::rc::Rc;

use gpui::{
    AnyElement, App, ClickEvent, ElementId, InteractiveElement, IntoElement, MouseDownEvent,
    ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, anchored,
    deferred, div, point, prelude::FluentBuilder, px,
};

use crate::{AnchorHandle, appearance, button::hover_state, icon, metrics, motion};

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;
type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Popover {
    id: SharedString,
    anchor: AnchorHandle,
    width: f32,
    padding: (f32, f32),
    children: Vec<AnyElement>,
    on_dismiss: Option<Handler>,
}

/// A popover anchored under `anchor`. Sizes are CSS pixels.
pub fn popover(id: impl Into<SharedString>, anchor: &AnchorHandle) -> Popover {
    Popover {
        id: id.into(),
        anchor: anchor.clone(),
        width: 346.0,
        padding: (16.0, 16.0),
        children: Vec::new(),
        on_dismiss: None,
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
        let edge = f32::from(m.px(11.0));
        let width = f32::from(m.px(self.width));
        let (left, top) = match self.anchor.bounds() {
            Some(anchor) => {
                let right = f32::from(anchor.origin.x + anchor.size.width);
                let left = (right - width)
                    .clamp(edge, (f32::from(viewport.width) - width - edge).max(edge));
                (
                    left,
                    f32::from(anchor.origin.y + anchor.size.height) + f32::from(m.px(9.0)),
                )
            }
            None => (f32::from(m.px(70.0)), f32::from(m.px(55.0))),
        };
        let lift = f32::from(m.px(-4.0)) * (1.0 - progress);
        let dismiss = self.on_dismiss.clone();
        deferred(
            anchored().position(point(px(left), px(top + lift))).child(
                div()
                    .id(ElementId::Name(self.id.clone()))
                    .occlude()
                    .w(px(width))
                    .max_h(px(f32::from(viewport.height) - top - edge))
                    .overflow_y_scroll()
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

/// A menu row (`.profile-menu-item`): 18px muted icon, text, optional trailing chevron.
#[derive(IntoElement)]
pub struct MenuItem {
    id: SharedString,
    icon: Option<SharedString>,
    label: SharedString,
    trailing: Option<SharedString>,
    checked: bool,
    on_click: Option<ClickHandler>,
}

pub fn menu_item(id: impl Into<SharedString>, label: impl Into<SharedString>) -> MenuItem {
    MenuItem {
        id: id.into(),
        icon: None,
        label: label.into(),
        trailing: None,
        checked: false,
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
        let handler = self.on_click.clone();
        let hover = crate::button::hover_listener(state);
        div()
            .id(ElementId::Name(self.id.clone()))
            .track_focus(&crate::button::focus_handle(&self.id, None, window, cx))
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
            .min_h(m.px(38.0))
            .px(m.px(11.0))
            .py(m.px(9.0))
            .rounded(m.px(7.0))
            .line_height(m.px(20.0))
            .cursor_pointer()
            .when(self.checked, |el| el.bg(t.accent_soft).text_color(t.accent))
            .when(hovered && !self.checked, |el| el.bg(t.control_hover))
            .on_hover(hover)
            .when_some(handler, |el, h| el.on_click(move |e, w, cx| h(e, w, cx)))
            .when_some(self.icon.clone(), |el, name| {
                el.child(icon(&name, m).size(18.0).color(t.text_muted).scale(scale))
            })
            .child(div().flex_1().child(self.label.clone()))
            .when_some(self.trailing.clone(), |el, name| {
                el.child(icon(&name, m).size(14.0).color(t.text_muted).scale(scale))
            })
    }
}
