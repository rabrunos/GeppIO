//! A single-line label with CSS `letter-spacing`.
//!
//! GPUI has no letter-spacing. The line is shaped once (keeping kerning) and each glyph is
//! painted with an extra offset of `spacing × glyph index`, as Chromium adds the spacing
//! after every character, including the last one.
use gpui::{
    App, Font, FontFeatures, FontStyle, FontWeight, Hsla, IntoElement, Pixels, RenderOnce,
    SharedString, Styled, TextRun, Window, canvas, point, px,
};

use crate::metrics::{Metrics, UI_FONT};

#[derive(IntoElement)]
pub struct SpacedText {
    text: SharedString,
    size: f32,
    line_height: f32,
    weight: FontWeight,
    color: Hsla,
    /// Letter spacing in `em`.
    spacing_em: f32,
    metrics: Metrics,
}

/// Creates a spaced label; sizes are in CSS pixels.
pub fn spaced_text(text: impl Into<SharedString>, metrics: Metrics) -> SpacedText {
    SpacedText {
        text: text.into(),
        size: 13.0,
        line_height: 20.0,
        weight: FontWeight::NORMAL,
        color: gpui::black(),
        spacing_em: 0.0,
        metrics,
    }
}

impl SpacedText {
    pub fn size(mut self, size: f32, line_height: f32) -> Self {
        self.size = size;
        self.line_height = line_height;
        self
    }
    pub fn weight(mut self, weight: FontWeight) -> Self {
        self.weight = weight;
        self
    }
    pub fn color(mut self, color: Hsla) -> Self {
        self.color = color;
        self
    }
    pub fn letter_spacing_em(mut self, em: f32) -> Self {
        self.spacing_em = em;
        self
    }
}

/// Glyph x offsets added by letter-spacing, for `count` glyphs.
pub fn spacing_offsets(count: usize, spacing: f32) -> impl Iterator<Item = f32> {
    (0..count).map(move |i| i as f32 * spacing)
}

impl RenderOnce for SpacedText {
    fn render(self, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let m = self.metrics;
        let font = Font {
            family: UI_FONT.into(),
            features: FontFeatures::default(),
            fallbacks: None,
            weight: self.weight,
            style: FontStyle::Normal,
        };
        let run = TextRun {
            len: self.text.len(),
            font,
            color: self.color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let font_size = m.px(self.size);
        let line = window
            .text_system()
            .shape_line(self.text.clone(), font_size, &[run], None);
        let spacing = f32::from(m.px(self.size * self.spacing_em));
        let glyphs: usize = line.runs.iter().map(|r| r.glyphs.len()).sum();
        let width = f32::from(line.width) + spacing * glyphs as f32;
        let line_height = m.px(self.line_height);
        let color = self.color;
        canvas(
            move |_, _, _| line,
            move |bounds, line, window, _| {
                let padding: Pixels = (line_height - line.ascent - line.descent) / 2.0;
                let baseline = bounds.origin.y + padding + line.ascent;
                let mut index = 0usize;
                for run in &line.runs {
                    for glyph in &run.glyphs {
                        let x = bounds.origin.x + glyph.position.x + px(spacing * index as f32);
                        let _ = window.paint_glyph(
                            point(x, baseline),
                            run.font_id,
                            glyph.id,
                            line.font_size,
                            color,
                        );
                        index += 1;
                    }
                }
            },
        )
        .w(px(width))
        .h(line_height)
        .flex_none()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn spacing_accumulates_per_glyph() {
        let offsets: Vec<f32> = super::spacing_offsets(4, 1.12).collect();
        for (got, want) in offsets.iter().zip([0.0, 1.12, 2.24, 3.36]) {
            assert!((got - want).abs() < 1e-5);
        }
    }
}
