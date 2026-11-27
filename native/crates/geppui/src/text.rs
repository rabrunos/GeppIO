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
    /// `min-width: 0; text-overflow: ellipsis`: shrinks in a flex row and ends with "…".
    truncate: bool,
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
        truncate: false,
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
    /// Lets the label shrink below its width, cutting it with an ellipsis.
    pub fn truncate(mut self) -> Self {
        self.truncate = true;
        self
    }
}

/// How many glyphs fit before an ellipsis of `ellipsis` width in `available`, given each
/// glyph's end (its advance plus the spacing after it). All glyphs fit when the whole line
/// does.
pub fn fitting_glyphs(ends: &[f32], available: f32, ellipsis: f32) -> usize {
    if ends.last().is_none_or(|&w| w <= available + 0.5) {
        return ends.len();
    }
    ends.iter()
        .take_while(|&&end| end + ellipsis <= available)
        .count()
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
            font: font.clone(),
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
        let ellipsis = self.truncate.then(|| {
            let run = TextRun {
                len: "…".len(),
                font,
                color,
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            window
                .text_system()
                .shape_line("…".into(), font_size, &[run], None)
        });
        let element = canvas(
            move |_, _, _| (line, ellipsis),
            move |bounds, (line, ellipsis), window, _| {
                let padding: Pixels = (line_height - line.ascent - line.descent) / 2.0;
                let baseline = bounds.origin.y + padding + line.ascent;
                // Glyph ends (advance plus the spacing after it), for the ellipsis cut.
                let positions: Vec<f32> = line
                    .runs
                    .iter()
                    .flat_map(|r| r.glyphs.iter().map(|g| f32::from(g.position.x)))
                    .collect();
                let ends: Vec<f32> = (0..positions.len())
                    .map(|i| {
                        positions
                            .get(i + 1)
                            .copied()
                            .unwrap_or(f32::from(line.width))
                            + spacing * (i + 1) as f32
                    })
                    .collect();
                let fits = match &ellipsis {
                    Some(e) => {
                        fitting_glyphs(&ends, f32::from(bounds.size.width), f32::from(e.width))
                    }
                    None => ends.len(),
                };
                let mut index = 0usize;
                for run in &line.runs {
                    for glyph in &run.glyphs {
                        if index >= fits {
                            break;
                        }
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
                if let Some(e) = ellipsis.filter(|_| fits < ends.len()) {
                    let x = bounds.origin.x + px(if fits == 0 { 0.0 } else { ends[fits - 1] });
                    for run in &e.runs {
                        for glyph in &run.glyphs {
                            let _ = window.paint_glyph(
                                point(x + glyph.position.x, baseline),
                                run.font_id,
                                glyph.id,
                                e.font_size,
                                color,
                            );
                        }
                    }
                }
            },
        )
        .w(px(width))
        .h(line_height);
        if self.truncate {
            element.flex_shrink(1.0).min_w_0()
        } else {
            element.flex_none()
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn ellipsis_keeps_the_glyphs_that_fit() {
        let ends = [10.0, 20.0, 30.0, 40.0];
        assert_eq!(super::fitting_glyphs(&ends, 40.0, 8.0), 4);
        assert_eq!(super::fitting_glyphs(&ends, 39.0, 8.0), 3);
        assert_eq!(super::fitting_glyphs(&ends, 25.0, 8.0), 1);
        assert_eq!(super::fitting_glyphs(&ends, 5.0, 8.0), 0);
        assert_eq!(super::fitting_glyphs(&[], 5.0, 8.0), 0);
    }

    #[test]
    fn spacing_accumulates_per_glyph() {
        let offsets: Vec<f32> = super::spacing_offsets(4, 1.12).collect();
        for (got, want) in offsets.iter().zip([0.0, 1.12, 2.24, 3.36]) {
            assert!((got - want).abs() < 1e-5);
        }
    }
}
