//! Form controls of the reference:
//! - [`Switch`] is `.workspace-switch` (30×18 track, 12px thumb, no transition);
//! - [`Checkbox`] is Chromium's native checkbox with `accent-color`;
//! - [`Select`] stands in for the native `<select>`. Chromium draws the closed control and the
//!   OS draws its list; GeppUI draws both, with the list as an anchored popover.
use std::rc::Rc;

use gpui::{
    AnyElement, App, ElementId, FocusHandle, Hsla, InteractiveElement, IntoElement, MouseButton,
    ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, anchored,
    deferred, div, point, prelude::FluentBuilder, px,
};

use crate::{AnchorHandle, anchor_probe, button::focus_handle, css_weight, icon, metrics};

type Toggle = Rc<dyn Fn(&bool, &mut Window, &mut App)>;
type Pick = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

/// Focus ring of `button:focus-visible` (2px `--ring`, offset 3px), as a spread shadow.
fn ring(color: Hsla, m: crate::Metrics, radius_offset: f32) -> gpui::BoxShadow {
    gpui::BoxShadow::new(px(0.0), px(0.0), color).spread_radius(m.px(2.0 + radius_offset))
}

#[derive(IntoElement)]
pub struct Switch {
    id: SharedString,
    checked: bool,
    disabled: bool,
    label: Option<SharedString>,
    on_toggle: Option<Toggle>,
    focus: Option<FocusHandle>,
}

/// A `role=switch` checkbox.
pub fn switch(id: impl Into<SharedString>, checked: bool) -> Switch {
    Switch {
        id: id.into(),
        checked,
        disabled: false,
        label: None,
        on_toggle: None,
        focus: None,
    }
}

impl Switch {
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    /// Accessible name (the visible label lives in the host row).
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    pub fn focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }
    pub fn on_toggle(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let on = self.checked;
        let handler = self.on_toggle.clone().filter(|_| !self.disabled);
        let focus = focus_handle(&self.id, self.focus.clone(), window, cx);
        div()
            .id(ElementId::Name(self.id.clone()))
            .when(!self.disabled, |el| el.track_focus(&focus))
            .focus_visible(move |s| s.shadow(vec![ring(t.ring, m, 1.0)]))
            .flex_none()
            .relative()
            .w(m.px(30.0))
            .h(m.px(18.0))
            .rounded(m.px(20.0))
            .border(m.border(1.0))
            .border_color(if on { t.accent } else { t.input_border })
            .bg(if on { t.accent } else { t.input })
            .when(self.disabled, |el| el.opacity(0.5))
            .when(!self.disabled, |el| el.cursor_pointer())
            .when_some(handler, |el, h| el.on_click(move |_, w, cx| h(&!on, w, cx)))
            .child(
                div()
                    .absolute()
                    .top(m.px(2.0))
                    // The thumb sits inside the 1px border: CSS left 2px → 14px.
                    .left(m.px(if on { 14.0 } else { 2.0 } - 1.0))
                    .size(m.px(12.0))
                    .rounded_full()
                    .bg(if on {
                        t.primary_foreground
                    } else {
                        t.text_muted
                    }),
            )
    }
}

#[derive(IntoElement)]
pub struct Checkbox {
    id: SharedString,
    checked: bool,
    disabled: bool,
    size: f32,
    on_toggle: Option<Toggle>,
    focus: Option<FocusHandle>,
}

/// Chromium's native checkbox with `accent-color: var(--color-accent)`, 13px by default.
pub fn checkbox(id: impl Into<SharedString>, checked: bool) -> Checkbox {
    Checkbox {
        id: id.into(),
        checked,
        disabled: false,
        size: 13.0,
        on_toggle: None,
        focus: None,
    }
}

impl Checkbox {
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }
    pub fn focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }
    pub fn on_toggle(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Checkbox {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let dark = crate::appearance(cx).theme.name == crate::ThemeName::Dark;
        let on = self.checked;
        // Chromium's unchecked box follows `color-scheme`.
        let (box_bg, box_border) = if dark {
            (gpui::rgb(0x3b3b3b), gpui::rgb(0x858585))
        } else {
            (gpui::rgb(0xffffff), gpui::rgb(0x767676))
        };
        let handler = self.on_toggle.clone().filter(|_| !self.disabled);
        let focus = focus_handle(&self.id, self.focus.clone(), window, cx);
        div()
            .id(ElementId::Name(self.id.clone()))
            .when(!self.disabled, |el| el.track_focus(&focus))
            .focus_visible(move |s| s.shadow(vec![ring(t.ring, m, 1.0)]))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .size(m.px(self.size))
            .rounded(m.px(2.0))
            .border(m.border(1.0))
            .border_color(if on { t.accent } else { box_border.into() })
            .bg(if on { t.accent } else { box_bg.into() })
            .when(!self.disabled, |el| el.cursor_pointer())
            .when_some(handler, |el, h| {
                el.on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, w, cx| {
                        cx.stop_propagation();
                        h(&!on, w, cx)
                    })
            })
            .when(on, |el| {
                el.child(
                    icon("check", m)
                        .size(self.size - 2.0)
                        .color(t.primary_foreground),
                )
            })
    }
}

/// Open state of a [`Select`], kept per element id.
#[derive(Default)]
struct SelectState {
    open: bool,
}

#[derive(IntoElement)]
pub struct Select {
    id: SharedString,
    options: Vec<(SharedString, SharedString)>,
    selected: SharedString,
    label: Option<SharedString>,
    height: f32,
    text: (f32, f32),
    bordered: bool,
    on_change: Option<Pick>,
    focus: Option<FocusHandle>,
}

/// A select over `(value, label)` options.
pub fn select(
    id: impl Into<SharedString>,
    options: Vec<(SharedString, SharedString)>,
    selected: impl Into<SharedString>,
) -> Select {
    Select {
        id: id.into(),
        options,
        selected: selected.into(),
        label: None,
        height: 36.0,
        text: (11.0, 15.0),
        bordered: true,
        on_change: None,
        focus: None,
    }
}

impl Select {
    /// Accessible name (`aria-label`).
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    /// Control height and text size / line height in CSS pixels.
    pub fn metrics(mut self, height: f32, size: f32, line: f32) -> Self {
        self.height = height;
        self.text = (size, line);
        self
    }
    /// The Settings language select has no author border or background.
    pub fn plain(mut self) -> Self {
        self.bordered = false;
        self
    }
    pub fn focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }
    pub fn on_change(
        mut self,
        handler: impl Fn(&SharedString, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Select {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let key = ElementId::Name(SharedString::from(format!("{}::select", self.id)));
        let state = window.use_keyed_state(key, cx, |_, _| SelectState::default());
        let anchor_key = ElementId::Name(SharedString::from(format!("{}::anchor", self.id)));
        let anchor = window
            .use_keyed_state(anchor_key, cx, |_, _| AnchorHandle::default())
            .read(cx)
            .clone();
        let open = state.read(cx).open;
        let current = self
            .options
            .iter()
            .find(|(v, _)| *v == self.selected)
            .map(|(_, l)| l.clone())
            .unwrap_or_default();
        let focus = focus_handle(&self.id, self.focus.clone(), window, cx);
        let toggle = state.clone();
        let list: Option<AnyElement> = open.then(|| {
            let close = state.clone();
            let width = anchor
                .bounds()
                .map_or(m.px(160.0), |b| b.size.width.max(m.px(120.0)));
            let (left, top) = anchor.bounds().map_or((px(0.0), px(0.0)), |b| {
                (b.origin.x, b.origin.y + b.size.height + m.px(2.0))
            });
            let items = self.options.iter().map(|(value, label)| {
                let pick = self.on_change.clone();
                let close = close.clone();
                let value = value.clone();
                let chosen = value == self.selected;
                div()
                    .id(ElementId::Name(
                        format!("{}::option::{value}", self.id).into(),
                    ))
                    .px(m.px(9.0))
                    .py(m.px(5.0))
                    .rounded(m.px(5.0))
                    .text_size(m.px(self.text.0.max(12.0)))
                    .line_height(m.px(18.0))
                    .cursor_pointer()
                    .when(chosen, |el| el.bg(t.accent_soft).text_color(t.accent))
                    .hover(move |s| s.bg(t.control_hover))
                    .on_click(move |_, w, cx| {
                        close.update(cx, |s, cx| {
                            s.open = false;
                            cx.notify();
                        });
                        if let Some(pick) = &pick {
                            pick(&value, w, cx);
                        }
                    })
                    .child(label.clone())
            });
            let dismiss = state.clone();
            deferred(
                anchored().position(point(left, top)).child(
                    div()
                        .id(ElementId::Name(format!("{}::list", self.id).into()))
                        .occlude()
                        .w(width)
                        .p(m.px(4.0))
                        .rounded(m.px(8.0))
                        .border(m.border(1.0))
                        .border_color(t.border)
                        .bg(t.elevated)
                        .shadow(vec![m.shadow(t.shadow_popover)])
                        .text_color(t.text)
                        .font_family(crate::UI_FONT)
                        .on_mouse_down_out(move |_, _, cx| {
                            dismiss.update(cx, |s, cx| {
                                s.open = false;
                                cx.notify();
                            })
                        })
                        .children(items),
                ),
            )
            .with_priority(3)
            .into_any_element()
        });
        div()
            .id(ElementId::Name(self.id.clone()))
            .track_focus(&focus)
            .focus_visible(move |s| s.shadow(vec![ring(t.ring, m, 0.0)]))
            .relative()
            .flex()
            .items_center()
            .justify_between()
            .gap(m.px(7.0))
            .h(m.px(self.height))
            .w_full()
            .px(m.px(if self.bordered { 11.0 } else { 4.0 }))
            .text_size(m.px(self.text.0))
            .line_height(m.px(self.text.1))
            .font_weight(css_weight(400.0))
            .cursor_pointer()
            .when(self.bordered, |el| {
                el.rounded(m.px(7.0))
                    .border(m.border(1.0))
                    .border_color(t.input_border)
                    .bg(t.input)
            })
            .on_click(move |_, _, cx| {
                toggle.update(cx, |s, cx| {
                    s.open = !s.open;
                    cx.notify();
                })
            })
            .child(anchor_probe(&anchor))
            .child(
                div()
                    .flex_1()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .child(current),
            )
            .child(icon("chevron-down", m).size(12.0).color(t.text_muted))
            .children(list)
    }
}
