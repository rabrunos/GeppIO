//! Transient status toast (`.workspace-toast`): centred at the bottom of the window,
//! `bottom_offset` CSS pixels above it, surface colours, 10px radius, no hit testing.
//! The host decides the lifetime (the reference keeps it for 3.2s).
use gpui::{
    App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, deferred, div, rgba,
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
        let max_width = f32::from(window.viewport_size().width) - f32::from(m.px(32.0));
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
                        .max_w(gpui::px(max_width))
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
