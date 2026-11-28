//! The browser's constraint-validation bubble (`required` on an empty field): a small box
//! under the field with a warning mark and the message, shown when a form is submitted
//! empty. Chromium draws it outside the page in its own platform style, so the Electron
//! captures cannot include it; this follows Chromium's Windows bubble (light box, 1px
//! border, soft shadow, orange warning square, 12px text) and stays an approximation.
//!
//! The message follows the system language, like Chromium's, not the app language.
use gpui::{
    AnyElement, App, IntoElement, ParentElement, PathBuilder, RenderOnce, SharedString, Styled,
    Window, canvas, deferred, div, point, px,
};

use crate::{css_weight, metrics};

/// How long the bubble stays (`max(5 s, 50 ms per character)` in Chromium).
pub fn validation_duration_ms(message: &str) -> f64 {
    (message.chars().count() as f64 * 50.0).max(5000.0)
}

/// Chromium's `valueMissing` message for a text field.
pub fn value_missing(portuguese: bool) -> &'static str {
    if portuguese {
        "Preencha este campo."
    } else {
        "Please fill out this field."
    }
}

#[derive(IntoElement)]
pub struct ValidationBubble {
    message: SharedString,
}

/// A bubble to place as the last child of a `relative()` field box; it opens below it.
pub fn validation_bubble(message: impl Into<SharedString>) -> ValidationBubble {
    ValidationBubble {
        message: message.into(),
    }
}

impl RenderOnce for ValidationBubble {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let m = metrics(window, cx);
        let _ = cx;
        let bubble: AnyElement = div()
            .absolute()
            .top(gpui::relative(1.0))
            .left(m.px(8.0))
            .mt(m.px(6.0))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(m.px(8.0))
                    .px(m.px(10.0))
                    .py(m.px(8.0))
                    .rounded(m.px(4.0))
                    .border(m.border(1.0))
                    .border_color(gpui::rgba(0x0000_0033))
                    .bg(gpui::white())
                    .shadow(vec![
                        gpui::BoxShadow::new(px(0.0), m.px(2.0), gpui::hsla(0.0, 0.0, 0.0, 0.25))
                            .blur_radius(m.px(6.0)),
                    ])
                    .child(
                        div()
                            .flex_none()
                            .size(m.px(20.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(m.px(3.0))
                            .bg(gpui::rgb(0xf29900))
                            .text_color(gpui::white())
                            .text_size(m.px(14.0))
                            .font_weight(css_weight(700.0))
                            .child("!"),
                    )
                    .child(
                        div()
                            .whitespace_nowrap()
                            .text_size(m.px(12.0))
                            .line_height(m.px(16.0))
                            .font_weight(css_weight(400.0))
                            .text_color(gpui::rgb(0x202124))
                            .child(self.message),
                    ),
            )
            .child(
                // The arrow: a bordered triangle above the box, 14px from its left edge.
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let (x, y) = (bounds.origin.x, bounds.origin.y);
                        let (w, h) = (bounds.size.width, bounds.size.height);
                        for (inset, color) in [
                            (px(0.0), gpui::Hsla::from(gpui::rgba(0x0000_0033))),
                            (px(1.0), gpui::white()),
                        ] {
                            let mut path = PathBuilder::fill();
                            path.move_to(point(x + w / 2.0, y + inset));
                            path.line_to(point(x + w - inset, y + h + px(1.0)));
                            path.line_to(point(x + inset, y + h + px(1.0)));
                            path.close();
                            if let Ok(path) = path.build() {
                                window.paint_path(path, color);
                            }
                        }
                    },
                )
                .absolute()
                .top(m.px(-6.0))
                .left(m.px(14.0))
                .w(m.px(12.0))
                .h(m.px(6.0)),
            )
            .into_any_element();
        deferred(bubble).with_priority(2)
    }
}

#[cfg(test)]
mod tests {
    use super::{validation_duration_ms, value_missing};

    #[test]
    fn duration_and_message_follow_chromium() {
        assert_eq!(validation_duration_ms(value_missing(true)), 5000.0);
        assert_eq!(validation_duration_ms(&"x".repeat(200)), 10000.0);
        assert_eq!(value_missing(false), "Please fill out this field.");
    }
}
