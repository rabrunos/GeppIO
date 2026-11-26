//! Buttons: the 36px tool button and the square icon button of the reference
//! (`src/geppui/styles/buttons.css`, tool-button variants).
use std::rc::Rc;

use gpui::{
    AnyView, App, AppContext, ClickEvent, Context, ElementId, Entity, Hsla, InteractiveElement,
    IntoElement, ParentElement, Render, RenderOnce, SharedString, StatefulInteractiveElement,
    Styled, Window, div, prelude::FluentBuilder,
};

use crate::{appearance, css_weight, icon, metrics, motion, motion::Transition};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// Hover progress of one element, animated like the reference's icon `scale` transition.
pub struct HoverState {
    pub hovered: bool,
    progress: Transition,
}

/// Returns the element's hover state and its eased progress at frame time.
pub fn hover_state(
    id: &SharedString,
    window: &mut Window,
    cx: &mut App,
) -> (Entity<HoverState>, bool, f32) {
    let key = ElementId::Name(SharedString::from(format!("{id}::hover")));
    let state = window.use_keyed_state(key, cx, |_, _| HoverState {
        hovered: false,
        progress: Transition::new(0.0),
    });
    let now = appearance(cx).clock.now();
    let (hovered, progress, animating) = state.update(cx, |s, _| {
        let p = s.progress.sample(now) as f32;
        (s.hovered, p, s.progress.animating(now))
    });
    if animating {
        window.request_animation_frame();
    }
    (state, hovered, progress)
}

pub(crate) fn hover_listener(
    state: Entity<HoverState>,
) -> impl Fn(&bool, &mut Window, &mut App) + 'static {
    move |hovered, _window, cx| {
        let duration = appearance(cx).duration(motion::duration::ICON_HOVER);
        let reduced = appearance(cx).reduced_motion;
        state.update(cx, |s, cx| {
            s.hovered = *hovered;
            // Icon scale has `transition: none` under reduced motion.
            s.progress.request(
                if *hovered { 1.0 } else { 0.0 },
                if reduced { 0.0 } else { duration },
                motion::EASE_OUT,
            );
            cx.notify();
        });
    }
}

struct TooltipView {
    text: SharedString,
}

impl Render for TooltipView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        div()
            .font_family(crate::UI_FONT)
            .text_size(m.px(12.0))
            .line_height(m.px(16.0))
            .px(m.px(8.0))
            .py(m.px(4.0))
            .rounded(m.px(6.0))
            .border(m.border(1.0))
            .border_color(t.border)
            .bg(t.elevated)
            .text_color(t.text)
            .shadow(vec![m.shadow(t.shadow_popover)])
            .child(self.text.clone())
    }
}

fn tooltip(text: SharedString) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
    move |_, cx| cx.new(|_| TooltipView { text: text.clone() }).into()
}

/// Square icon button (`.ui-icon-button`): 32px box, 8px radius, 20px icon by default.
#[derive(IntoElement)]
pub struct IconButton {
    id: SharedString,
    icon: SharedString,
    label: Option<SharedString>,
    size: f32,
    icon_size: f32,
    radius: f32,
    color: Option<Hsla>,
    hover_bg: Option<Hsla>,
    hover_color: Option<Hsla>,
    selected: bool,
    destructive: bool,
    disabled: bool,
    on_click: Option<ClickHandler>,
}

pub fn icon_button(id: impl Into<SharedString>, icon: impl Into<SharedString>) -> IconButton {
    IconButton {
        id: id.into(),
        icon: icon.into(),
        label: None,
        size: 32.0,
        icon_size: 20.0,
        radius: 8.0,
        color: None,
        hover_bg: None,
        hover_color: None,
        selected: false,
        destructive: false,
        disabled: false,
        on_click: None,
    }
}

impl IconButton {
    /// Accessible name, also shown as the tooltip (the reference's `title`).
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    pub fn size(mut self, size: f32, icon_size: f32) -> Self {
        self.size = size;
        self.icon_size = icon_size;
        self
    }
    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = radius;
        self
    }
    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }
    pub fn hover_bg(mut self, color: Hsla) -> Self {
        self.hover_bg = Some(color);
        self
    }
    pub fn hover_color(mut self, color: Hsla) -> Self {
        self.hover_color = Some(color);
        self
    }
    /// Current/selected (`aria-current`): accent on accent-soft.
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
    /// Close-button variant: destructive background and white glyph on hover.
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

impl RenderOnce for IconButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let (state, hovered, progress) = hover_state(&self.id, window, cx);
        let hovered = hovered && !self.disabled;
        let rest = self.color.unwrap_or(t.text);
        let (bg, fg) = match (hovered, self.selected, self.destructive) {
            (true, _, true) => (Some(t.destructive), gpui::white()),
            // Hover wins over the selected background, the selected foreground stays accent.
            (true, true, false) => (Some(self.hover_bg.unwrap_or(t.control_hover)), t.accent),
            (true, false, false) => (
                Some(self.hover_bg.unwrap_or(t.control_hover)),
                self.hover_color.unwrap_or(t.text),
            ),
            (false, true, _) => (Some(t.accent_soft), t.accent),
            (false, false, _) => (None, rest),
        };
        let scale = if self.disabled {
            1.0
        } else {
            1.0 + 0.1 * progress
        };
        let on_click = self.on_click.clone();
        div()
            .id(ElementId::Name(self.id.clone()))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(m.px(self.size))
            .rounded(m.px(self.radius))
            .when_some(bg, |el, bg| el.bg(bg))
            .when(self.selected && hovered, |el| {
                el.shadow(vec![
                    gpui::BoxShadow::new(m.px(0.0), m.px(0.0), t.accent_soft)
                        .spread_radius(m.px(1.0)),
                ])
            })
            .when(self.disabled, |el| el.opacity(0.5))
            .when(!self.disabled, |el| el.cursor_pointer())
            .on_hover(hover_listener(state))
            .when_some(self.label.clone(), |el, label| el.tooltip(tooltip(label)))
            .when_some(on_click.filter(|_| !self.disabled), |el, handler| {
                el.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .child(
                icon(&self.icon, m)
                    .size(self.icon_size)
                    .color(fg)
                    .scale(scale),
            )
    }
}

/// The 36px tool button (`.tool-button`) and the experience-switch pressed variant.
#[derive(IntoElement)]
pub struct Button {
    id: SharedString,
    label: Option<SharedString>,
    icon: Option<(SharedString, f32)>,
    width: Option<f32>,
    height: f32,
    radius: f32,
    pressed: bool,
    primary: bool,
    accent: bool,
    text_size: f32,
    weight: f32,
    padding_x: f32,
    disabled: bool,
    tooltip: Option<SharedString>,
    on_click: Option<ClickHandler>,
}

pub fn button(id: impl Into<SharedString>) -> Button {
    Button {
        id: id.into(),
        label: None,
        icon: None,
        width: None,
        height: 36.0,
        radius: 10.0,
        pressed: false,
        primary: false,
        accent: false,
        text_size: 13.0,
        weight: 400.0,
        padding_x: 11.0,
        disabled: false,
        tooltip: None,
        on_click: None,
    }
}

impl Button {
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    /// Leading icon and its size in CSS pixels.
    pub fn icon(mut self, name: impl Into<SharedString>, size: f32) -> Self {
        self.icon = Some((name.into(), size));
        self
    }
    /// Fixed width in CSS pixels (square buttons pass the height).
    pub fn width(mut self, width: f32) -> Self {
        self.width = Some(width);
        self
    }
    pub fn height(mut self, height: f32, radius: f32) -> Self {
        self.height = height;
        self.radius = radius;
        self
    }
    /// `aria-pressed`: accent text and a 1px inset accent ring.
    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }
    pub fn primary(mut self) -> Self {
        self.primary = true;
        self
    }
    /// Accent-soft surface with an accent border and icon (the header Plugins button).
    pub fn accent(mut self) -> Self {
        self.accent = true;
        self
    }
    /// Horizontal padding in CSS pixels (11 by default).
    pub fn padding_x(mut self, padding: f32) -> Self {
        self.padding_x = padding;
        self
    }
    /// Font size and CSS weight of the label.
    pub fn text(mut self, size: f32, weight: f32) -> Self {
        self.text_size = size;
        self.weight = weight;
        self
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn tooltip(mut self, text: impl Into<SharedString>) -> Self {
        self.tooltip = Some(text.into());
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

impl RenderOnce for Button {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let (state, hovered, progress) = hover_state(&self.id, window, cx);
        let hovered = hovered && !self.disabled;
        let mut icon_color = None;
        let (bg, border, fg) = if self.primary {
            (
                if hovered { t.primary_hover } else { t.accent },
                t.primary_border,
                t.primary_foreground,
            )
        } else if self.accent {
            icon_color = Some(t.accent);
            (
                if hovered {
                    t.brand_soft_hover
                } else {
                    t.accent_soft
                },
                t.accent_border,
                t.text,
            )
        } else {
            (
                if hovered { t.control_hover } else { t.surface },
                if self.pressed {
                    t.accent
                } else {
                    t.input_border
                },
                if self.pressed { t.accent } else { t.text },
            )
        };
        let scale = 1.0 + 0.1 * progress;
        let on_click = self.on_click.clone();
        div()
            .id(ElementId::Name(self.id.clone()))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(m.px(11.0))
            .h(m.px(self.height))
            .when_some(self.width, |el, w| el.w(m.px(w)))
            .when(self.width.is_none(), |el| el.px(m.px(self.padding_x)))
            .rounded(m.px(self.radius))
            .border(m.border(1.0))
            .border_color(border)
            .bg(bg)
            .text_color(fg)
            .text_size(m.px(self.text_size))
            .line_height(m.px((self.text_size * 1.33).round()))
            .font_weight(css_weight(self.weight))
            .whitespace_nowrap()
            .when(self.disabled, |el| el.opacity(0.5))
            .when(!self.disabled, |el| el.cursor_pointer())
            .on_hover(hover_listener(state))
            .when_some(self.tooltip.clone(), |el, text| el.tooltip(tooltip(text)))
            .when_some(on_click.filter(|_| !self.disabled), |el, handler| {
                el.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .when_some(self.icon.clone(), |el, (name, size)| {
                el.child(
                    icon(&name, m)
                        .size(size)
                        .color(icon_color.unwrap_or(fg))
                        .scale(scale),
                )
            })
            .when_some(self.label.clone(), |el, label| el.child(label))
    }
}
