//! CSS-pixel geometry on top of GPUI logical pixels.
//!
//! Host screens are specified in CSS pixels. `zoom` multiplies them before GPUI applies the
//! OS scale factor; it is 1 in normal use and lets automated comparisons emulate 125% on a
//! 100% display (Electron's `--force-device-scale-factor`). Device-pixel snapping follows
//! Chromium: box edges land on whole device pixels and a 1px border stays one device pixel.
use gpui::{BoxShadow, FontWeight, Pixels, px};

use crate::theme::Shadow;

/// A rectangle in CSS pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
    pub fn right(&self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f32 {
        self.y + self.h
    }
    pub fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && y >= self.y && x < self.right() && y < self.bottom()
    }
    pub fn inset(&self, dx: f32, dy: f32) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            w: (self.w - 2.0 * dx).max(0.0),
            h: (self.h - 2.0 * dy).max(0.0),
        }
    }
    pub fn lerp(a: Self, b: Self, t: f32) -> Self {
        Self {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            w: a.w + (b.w - a.w) * t,
            h: a.h + (b.h - a.h) * t,
        }
    }
}

/// Snapped device geometry of a [`Rect`], in GPUI logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub left: Pixels,
    pub top: Pixels,
    pub width: Pixels,
    pub height: Pixels,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics {
    /// Emulated page zoom (1.0 or 1.25 in comparisons).
    pub zoom: f32,
    /// The window's OS scale factor.
    pub os: f32,
}

impl Default for Metrics {
    fn default() -> Self {
        Self { zoom: 1.0, os: 1.0 }
    }
}

impl Metrics {
    pub fn new(zoom: f32, os: f32) -> Self {
        Self {
            zoom: if zoom > 0.0 { zoom } else { 1.0 },
            os: if os > 0.0 { os } else { 1.0 },
        }
    }
    /// Device pixels per CSS pixel.
    pub fn device(&self) -> f32 {
        self.zoom * self.os
    }
    /// An unsnapped length (font sizes, radii, glyph positions).
    pub fn px(&self, css: f32) -> Pixels {
        px(css * self.zoom)
    }
    /// Exactly n device pixels (a nudge that means the same at every scale).
    pub fn device_px(&self, n: f32) -> Pixels {
        px(n / self.os)
    }
    /// A CSS length rounded up to whole device pixels.
    pub fn ceil(&self, css: f32) -> Pixels {
        px((css * self.device() - 1e-4).ceil() / self.os)
    }
    /// GPUI snaps layout edges that land exactly on a half device pixel toward zero, while
    /// Chromium keeps the fractional position and paints (and rounds the text baseline) half
    /// up. For an element whose reference position is `abs_css`, this returns the one device
    /// pixel that restores the reference rounding, and zero when the position is not a half.
    pub fn half_pixel_nudge(&self, abs_css: f32) -> Pixels {
        let frac = (abs_css * self.device()).fract();
        if (frac - 0.5).abs() < 1e-3 {
            self.device_px(1.0)
        } else {
            px(0.0)
        }
    }
    /// A coordinate snapped to the device grid.
    pub fn snap(&self, css: f32) -> Pixels {
        px((css * self.device()).round() / self.os)
    }
    /// Chromium border widths: at least one device pixel, otherwise floored.
    pub fn border(&self, css: f32) -> Pixels {
        if css <= 0.0 {
            return px(0.0);
        }
        px((css * self.device()).floor().max(1.0) / self.os)
    }
    /// Converts a window position (GPUI logical pixels) back to CSS pixels.
    pub fn css(&self, logical: Pixels) -> f32 {
        f32::from(logical) / self.zoom
    }
    /// Snaps both edges so adjacent boxes share device pixels and sizes never drift.
    pub fn place(&self, rect: Rect) -> Placed {
        let k = self.device();
        let x0 = (rect.x * k).round();
        let y0 = (rect.y * k).round();
        let x1 = (rect.right() * k).round();
        let y1 = (rect.bottom() * k).round();
        Placed {
            left: px(x0 / self.os),
            top: px(y0 / self.os),
            width: px((x1 - x0).max(0.0) / self.os),
            height: px((y1 - y0).max(0.0) / self.os),
        }
    }
    /// CSS `box-shadow` to GPUI: GPUI's blur radius is a Gaussian sigma, half the CSS blur.
    pub fn shadow(&self, shadow: Shadow) -> BoxShadow {
        BoxShadow::new(self.px(shadow.x), self.px(shadow.y), shadow.color)
            .blur_radius(self.px(shadow.blur / 2.0))
            .spread_radius(self.px(shadow.spread))
    }
}

/// Face selected by Chromium for the static Windows "Segoe UI" family
/// (300/350/400/600/700/900) with `font-synthesis: none`. Observed in the Stage A captures:
/// CSS 500 and 550 render Semibold, 650 renders Bold.
pub fn css_weight(css: f32) -> FontWeight {
    let face = if css < 500.0 {
        400.0
    } else if css <= 600.0 {
        600.0
    } else {
        700.0
    };
    FontWeight(face)
}

/// The UI font of the reference: system "Segoe UI" with Arial fallback.
pub const UI_FONT: &str = "Segoe UI";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapping_at_125_percent_matches_chromium_edges() {
        let m = Metrics::new(1.25, 1.0);
        // Docked track 331 CSS px = 413.75 device px; Chromium paints the edge at 414.
        assert_eq!(m.snap(331.0), px(414.0));
        let placed = m.place(Rect::new(331.0, 46.0, 949.0, 729.0));
        assert_eq!(placed.left, px(414.0));
        assert_eq!(f32::from(placed.left) + f32::from(placed.width), 1600.0);
        // 1px borders stay one device pixel.
        assert_eq!(m.border(1.0), px(1.0));
        assert_eq!(Metrics::new(1.0, 1.5).border(1.0), px(1.0 / 1.5));
        // Half-pixel nudges only where the device position is exactly x.5.
        assert_eq!(Metrics::new(1.0, 1.0).half_pixel_nudge(780.5), px(1.0));
        assert_eq!(Metrics::new(1.25, 1.0).half_pixel_nudge(780.5), px(0.0));
        assert_eq!(Metrics::new(1.0, 1.0).half_pixel_nudge(780.0), px(0.0));
    }

    #[test]
    fn shadow_blur_is_half_the_css_blur() {
        let m = Metrics::new(1.0, 1.0);
        let shadow = m.shadow(Shadow {
            x: 10.0,
            y: 0.0,
            blur: 24.0,
            spread: -9.0,
            color: gpui::black(),
        });
        assert_eq!(shadow.blur_radius, px(12.0));
        assert_eq!(shadow.spread_radius, px(-9.0));
    }

    #[test]
    fn weights_follow_static_segoe_faces() {
        assert_eq!(css_weight(400.0), FontWeight(400.0));
        assert_eq!(css_weight(500.0), FontWeight(600.0));
        assert_eq!(css_weight(650.0), FontWeight(700.0));
    }
}
