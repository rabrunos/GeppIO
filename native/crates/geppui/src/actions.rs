//! Text actions and dialog buttons of the reference:
//! - [`TextAction`] is `.workspace-text-action`: a 28px muted text button that darkens on hover;
//! - [`DialogButton`] is `.workspace-secondary` / `.workspace-primary`, the 36px dialog buttons,
//!   with the `.is-destructive` primary.
use std::rc::Rc;

use gpui::{
    App, ClickEvent, ElementId, FocusHandle, InteractiveElement, IntoElement, ParentElement,
    RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, div,
    prelude::FluentBuilder, px,
};

use crate::{button::focus_handle, css_weight, icon, metrics};

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

fn ring(t: crate::Theme, m: crate::Metrics) -> gpui::BoxShadow {
    gpui::BoxShadow::new(px(0.0), px(0.0), t.ring).spread_radius(m.px(2.0))
}

#[derive(IntoElement)]
pub struct TextAction {
    id: SharedString,
    label: SharedString,
    icon: Option<SharedString>,
    trailing: Option<SharedString>,
    size: (f32, f32),
    disabled: bool,
    pressed: bool,
    destructive: bool,
    on_click: Option<ClickHandler>,
    focus: Option<FocusHandle>,
}

pub fn text_action(id: impl Into<SharedString>, label: impl Into<SharedString>) -> TextAction {
    TextAction {
        id: id.into(),
        label: label.into(),
        icon: None,
        trailing: None,
        size: (11.0, 18.0),
        disabled: false,
        pressed: false,
        destructive: false,
        on_click: None,
        focus: None,
    }
}

impl TextAction {
    /// A leading 15px icon.
    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }
    /// A trailing 13px icon (the plugin card "Detalhes ›").
    pub fn trailing(mut self, name: impl Into<SharedString>) -> Self {
        self.trailing = Some(name.into());
        self
    }
    /// Font size and line height in CSS pixels.
    pub fn text(mut self, size: f32, line: f32) -> Self {
        self.size = (size, line);
        self
    }
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    /// `aria-pressed`: accent on accent-soft.
    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }
    /// The muted destructive action ("Arquivar barra"): destructive text, text color on hover.
    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }
    pub fn focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
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

impl RenderOnce for TextAction {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let focus = focus_handle(&self.id, self.focus.clone(), window, cx);
        let color = if self.pressed {
            t.accent
        } else if self.destructive {
            t.destructive
        } else {
            t.text_muted
        };
        let handler = self.on_click.clone().filter(|_| !self.disabled);
        div()
            .id(ElementId::Name(self.id.clone()))
            .when(!self.disabled, |el| el.track_focus(&focus))
            .focus_visible(move |s| s.shadow(vec![ring(t, m)]))
            .flex()
            .flex_none()
            .items_center()
            .gap(m.px(5.0))
            .min_h(m.px(28.0))
            .px(m.px(6.0))
            .py(m.px(4.0))
            .rounded(m.px(6.0))
            .text_size(m.px(self.size.0))
            .line_height(m.px(self.size.1))
            .text_color(color)
            .whitespace_nowrap()
            .when(self.pressed, |el| el.bg(t.accent_soft))
            .when(self.disabled, |el| el.opacity(0.5))
            .when(!self.disabled, |el| {
                el.cursor_pointer().hover(move |s| {
                    s.bg(t.control_hover)
                        .text_color(if self.pressed { t.accent } else { t.text })
                })
            })
            .when_some(handler, |el, h| el.on_click(move |e, w, cx| h(e, w, cx)))
            .when_some(self.icon.clone(), |el, name| {
                el.child(icon(&name, m).size(15.0).color(color))
            })
            .child(self.label.clone())
            .when_some(self.trailing.clone(), |el, name| {
                el.child(icon(&name, m).size(13.0).color(color))
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DialogButtonKind {
    Secondary,
    Primary,
    Destructive,
}

#[derive(IntoElement)]
pub struct DialogButton {
    id: SharedString,
    label: SharedString,
    kind: DialogButtonKind,
    disabled: bool,
    on_click: Option<ClickHandler>,
    focus: Option<FocusHandle>,
}

pub fn dialog_button(
    id: impl Into<SharedString>,
    label: impl Into<SharedString>,
    kind: DialogButtonKind,
) -> DialogButton {
    DialogButton {
        id: id.into(),
        label: label.into(),
        kind,
        disabled: false,
        on_click: None,
        focus: None,
    }
}

impl DialogButton {
    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
    pub fn focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
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

impl RenderOnce for DialogButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let focus = focus_handle(&self.id, self.focus.clone(), window, cx);
        let (fg, bg, border, hover) = match self.kind {
            DialogButtonKind::Secondary => {
                (t.text, gpui::transparent_black(), t.border, t.control_hover)
            }
            DialogButtonKind::Primary => (
                t.primary_foreground,
                t.accent,
                t.accent_border,
                t.primary_hover,
            ),
            // `filter: brightness(.94)` on hover.
            DialogButtonKind::Destructive => {
                let mut dim = t.destructive;
                dim.l *= 0.94;
                (gpui::white(), t.destructive, t.destructive, dim)
            }
        };
        let handler = self.on_click.clone().filter(|_| !self.disabled);
        div()
            .id(ElementId::Name(self.id.clone()))
            .when(!self.disabled, |el| el.track_focus(&focus))
            .focus_visible(move |s| s.shadow(vec![ring(t, m)]))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .min_h(m.px(36.0))
            .px(m.px(13.0))
            .py(m.px(8.0))
            .rounded(m.px(8.0))
            .border(m.border(1.0))
            .border_color(border)
            .bg(bg)
            .text_color(fg)
            .text_size(m.px(12.0))
            .line_height(m.px(18.0))
            .font_weight(css_weight(600.0))
            .whitespace_nowrap()
            .when(self.disabled, |el| el.opacity(0.5))
            .when(!self.disabled, |el| {
                el.cursor_pointer().hover(move |s| s.bg(hover))
            })
            .when_some(handler, |el, h| el.on_click(move |e, w, cx| h(e, w, cx)))
            .child(self.label.clone())
    }
}
