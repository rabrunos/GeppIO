//! Stroked SVG icons (24 viewBox) tinted with `currentColor`.
use gpui::{
    App, Hsla, IntoElement, RenderOnce, SharedString, Size, Styled, Transformation, Window, svg,
};

use crate::metrics::Metrics;

#[derive(IntoElement)]
pub struct Icon {
    path: SharedString,
    size: f32,
    color: Hsla,
    scale: f32,
    rotation: f32,
    metrics: Metrics,
}

/// An icon by asset name: `icons/<name>.svg`, served by [`crate::GeppuiAssets`] or the host.
pub fn icon(name: &str, metrics: Metrics) -> Icon {
    Icon {
        path: SharedString::from(format!("icons/{name}.svg")),
        size: 20.0,
        color: gpui::black(),
        scale: 1.0,
        rotation: 0.0,
        metrics,
    }
}

impl Icon {
    /// Square size in CSS pixels.
    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }
    pub fn color(mut self, color: Hsla) -> Self {
        self.color = color;
        self
    }
    /// Paint scale around the centre (the reference's hover `scale: 1.1`).
    pub fn scale(mut self, scale: f32) -> Self {
        self.scale = scale;
        self
    }
    /// Rotation in half turns (1.0 = 180°), like the profile chevron when expanded.
    pub fn rotate_half_turns(mut self, turns: f32) -> Self {
        self.rotation = turns;
        self
    }
}

impl RenderOnce for Icon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let element = svg()
            .path(self.path)
            .size(self.metrics.px(self.size))
            .flex_none()
            .text_color(self.color);
        if (self.scale - 1.0).abs() > f32::EPSILON || self.rotation != 0.0 {
            let t = Transformation::scale(Size {
                width: self.scale,
                height: self.scale,
            })
            .with_rotation(gpui::radians(self.rotation * std::f32::consts::PI));
            element.with_transformation(t)
        } else {
            element
        }
    }
}
