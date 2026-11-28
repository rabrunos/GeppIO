//! Transient status toast (`.workspace-toast`): centred at the bottom of the window,
//! `bottom_offset` CSS pixels above it, surface colours, 10px radius, no hit testing.
//! The host decides the lifetime (the reference keeps it for 3.2s).
use gpui::{
    App, Font, FontFeatures, FontStyle, FontWeight, InteractiveElement, IntoElement, ParentElement,
    RenderOnce, SharedString, StatefulInteractiveElement, Styled, TextRun, Window, deferred, div,
    rgba,
};

use crate::{Shadow, metrics};

#[derive(IntoElement)]
pub struct Toast {
    message: SharedString,
    bottom_offset: f32,
}

pub fn toast(message: impl Into<SharedString>, bottom_offset: f32) -> Toast {
    Toast {
        message: message.into(),
        bottom_offset,
    }
}

impl RenderOnce for Toast {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let shadow = Shadow {
            x: 0.0,
            y: 6.0,
            blur: 20.0,
            spread: 0.0,
            color: rgba(0x00000026).into(),
        };
        // `position: fixed; left: 50%` shrink-to-fit: the box wraps at half the viewport
        // before `max-width: calc(100vw - 32px)` applies.
        let viewport = f32::from(window.viewport_size().width);
        let max_width = (viewport - f32::from(m.px(32.0))).min(viewport / 2.0);
        // A definite width lets GPUI wrap the text and size the box for every line; the
        // natural single-line width keeps short messages shrink-wrapped.
        let run = TextRun {
            len: self.message.len(),
            font: Font {
                family: crate::UI_FONT.into(),
                features: FontFeatures::default(),
                fallbacks: None,
                weight: FontWeight::NORMAL,
                style: FontStyle::Normal,
            },
            color: t.text,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let natural = f32::from(
            window
                .text_system()
                .shape_line(self.message.clone(), m.px(12.0), &[run], None)
                .width,
        ) + f32::from(m.px(32.0))
            + 2.0 * f32::from(m.border(1.0));
        let width = natural.ceil().min(max_width);
        deferred(
            div()
                .absolute()
                .left_0()
                .bottom(m.px(self.bottom_offset))
                .w_full()
                .flex()
                .justify_center()
                .child(
                    div()
                        // `role="status"`, `aria-live="polite"`.
                        .id("geppui-toast")
                        .role(gpui::Role::Status)
                        .aria_label(self.message.clone())
                        .w(gpui::px(width))
                        .px(m.px(16.0))
                        .py(m.px(10.0))
                        .rounded(m.px(10.0))
                        .border(m.border(1.0))
                        .border_color(t.border)
                        .bg(t.surface)
                        .shadow(vec![m.shadow(shadow)])
                        .text_size(m.px(12.0))
                        .line_height(m.px(16.0))
                        .text_color(t.text)
                        .font_family(crate::UI_FONT)
                        .child(self.message),
                ),
        )
        .with_priority(3)
    }
}
