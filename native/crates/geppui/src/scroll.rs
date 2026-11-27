//! Vertical scroll area with the reference's custom scrollbar: a stable gutter (15px by
//! default), a 5px pill thumb (text at 18%, 36% while hovered; minimum 28px) and end arrow
//! buttons (15×9px with a 5×3px triangle; 14%, hovered 36%, cannot scroll 8%).
//! [`ScrollArea::thin`] reproduces Chromium's Windows `scrollbar-width: thin` used by widget
//! contents: a 10px track that takes space only while the content overflows, a 6px thumb
//! and end arrows. [`ScrollArea::both_axes`] scrolls horizontally too, with the same thin
//! bars on the right and bottom edges.
use gpui::{
    AnyElement, App, Bounds, ElementId, Hsla, InteractiveElement, IntoElement, ParentElement,
    PathBuilder, Pixels, RenderOnce, ScrollHandle, SharedString, StatefulInteractiveElement,
    Styled, Window, canvas, div, point, px, size,
};

use crate::{Metrics, metrics};

#[derive(IntoElement)]
pub struct ScrollArea {
    id: SharedString,
    handle: ScrollHandle,
    gutter: f32,
    thumb: f32,
    arrows: bool,
    thin: bool,
    both: bool,
    /// Bars decided from known sizes (vertical, horizontal); otherwise from the last frame.
    bars: Option<(bool, bool)>,
    children: Vec<AnyElement>,
}

/// A scroll area; keep `handle` in the owning view so the offset survives frames.
pub fn scroll_area(id: impl Into<SharedString>, handle: &ScrollHandle) -> ScrollArea {
    ScrollArea {
        id: id.into(),
        handle: handle.clone(),
        gutter: 15.0,
        thumb: 5.0,
        arrows: true,
        thin: false,
        both: false,
        bars: None,
        children: Vec::new(),
    }
}

impl ScrollArea {
    /// Gutter width and visible thumb width in CSS pixels.
    pub fn gutter(mut self, gutter: f32, thumb: f32) -> Self {
        self.gutter = gutter;
        self.thumb = thumb;
        self
    }
    pub fn arrows(mut self, arrows: bool) -> Self {
        self.arrows = arrows;
        self
    }
    /// Chromium's thin platform scrollbar (widget contents).
    pub fn thin(mut self) -> Self {
        self.thin = true;
        self.gutter = 10.0;
        self.thumb = 6.0;
        self
    }
    /// Thin bars on both axes for `content` inside a `viewport` (CSS pixels, width and
    /// height). The bars follow [`bars_needed`], so content that fits exactly never shows one.
    pub fn both_axes(mut self, content: (f32, f32), viewport: (f32, f32)) -> Self {
        self = self.thin();
        self.both = true;
        self.bars = Some(bars_needed(content, viewport, self.gutter));
        self
    }
}

/// Which classic scrollbars a box shows (vertical, horizontal), as browsers decide it: an
/// axis overflows the full viewport, or overflows what is left once the other bar takes
/// its gutter.
pub fn bars_needed(content: (f32, f32), viewport: (f32, f32), gutter: f32) -> (bool, bool) {
    const EPSILON: f32 = 0.5;
    let (mut vertical, mut horizontal) = (
        content.1 > viewport.1 + EPSILON,
        content.0 > viewport.0 + EPSILON,
    );
    for _ in 0..2 {
        horizontal |= vertical && content.0 > viewport.0 - gutter + EPSILON;
        vertical |= horizontal && content.1 > viewport.1 - gutter + EPSILON;
    }
    (vertical, horizontal)
}

impl ParentElement for ScrollArea {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements)
    }
}

/// Thumb rectangle (top, height) inside a track, from scroll metrics in any unit.
pub fn thumb_geometry(
    track: f32,
    viewport: f32,
    content: f32,
    offset: f32,
    min_thumb: f32,
) -> Option<(f32, f32)> {
    if content <= viewport + 0.5 || track <= 0.0 {
        return None;
    }
    let height = (track * viewport / content).max(min_thumb).min(track);
    let max_offset = content - viewport;
    let top = (track - height) * (offset / max_offset).clamp(0.0, 1.0);
    Some((top, height))
}

struct Paint {
    bounds: Bounds<Pixels>,
    m: Metrics,
    gutter: f32,
    thumb: f32,
    arrows: bool,
    thin: bool,
    track_color: Hsla,
    thumb_color: Hsla,
    arrow_color: Hsla,
    arrow_disabled: Hsla,
}

#[derive(Clone, Copy, PartialEq)]
enum Axis {
    Vertical,
    Horizontal,
}

/// Paints one bar. `corner` shortens the track where the other axis' bar also shows.
fn paint_scrollbar(p: &Paint, handle: &ScrollHandle, axis: Axis, corner: f32, window: &mut Window) {
    let vertical = axis == Axis::Vertical;
    let bounds = handle.bounds().size;
    let (viewport, max, offset) = if vertical {
        (
            f32::from(bounds.height),
            f32::from(handle.max_offset().y),
            -f32::from(handle.offset().y),
        )
    } else {
        (
            f32::from(bounds.width),
            f32::from(handle.max_offset().x),
            -f32::from(handle.offset().x),
        )
    };
    if p.thin && max <= 0.5 {
        return;
    }
    let content = viewport + max;
    let viewport = viewport - corner;
    let arrow_h = if p.arrows {
        f32::from(p.m.px(if p.thin { 10.0 } else { 9.0 }))
    } else {
        0.0
    };
    let gutter = f32::from(p.m.px(p.gutter));
    // Work in (along, across) coordinates; `at` and `extent` map them back to the window.
    let (along0, across0) = if vertical {
        (
            f32::from(p.bounds.origin.y),
            f32::from(p.bounds.origin.x + p.bounds.size.width) - gutter,
        )
    } else {
        (
            f32::from(p.bounds.origin.x),
            f32::from(p.bounds.origin.y + p.bounds.size.height) - gutter,
        )
    };
    let at = |along: f32, across: f32| {
        if vertical {
            point(px(across), px(along))
        } else {
            point(px(along), px(across))
        }
    };
    let extent = |along: f32, across: f32| {
        if vertical {
            size(px(across), px(along))
        } else {
            size(px(along), px(across))
        }
    };
    let track = viewport - 2.0 * arrow_h;
    if p.thin {
        let bounds = Bounds {
            origin: at(along0, across0),
            size: extent(viewport, gutter),
        };
        window.paint_quad(gpui::fill(bounds, p.track_color));
    }
    if let Some((start, length)) = thumb_geometry(
        track,
        viewport,
        content - corner,
        offset,
        f32::from(p.m.px(28.0)),
    ) {
        let width = f32::from(p.m.px(p.thumb));
        let bounds = Bounds {
            origin: at(along0 + arrow_h + start, across0 + (gutter - width) / 2.0),
            size: extent(length, width),
        };
        window.paint_quad(gpui::fill(bounds, p.thumb_color).corner_radii(px(width / 2.0)));
    }
    if p.arrows && max > 0.5 {
        let (w, h) = (f32::from(p.m.px(5.0)), f32::from(p.m.px(3.0)));
        let mid = across0 + gutter / 2.0;
        for (back, centre) in [
            (true, along0 + arrow_h / 2.0),
            (false, along0 + viewport - arrow_h / 2.0),
        ] {
            let enabled = if back {
                offset > 0.5
            } else {
                offset < max - 0.5
            };
            let mut path = PathBuilder::fill();
            let (tip, base) = if back {
                (centre - h / 2.0, centre + h / 2.0)
            } else {
                (centre + h / 2.0, centre - h / 2.0)
            };
            path.move_to(at(tip, mid));
            path.line_to(at(base, mid + w / 2.0));
            path.line_to(at(base, mid - w / 2.0));
            path.close();
            if let Ok(path) = path.build() {
                window.paint_path(
                    path,
                    if enabled {
                        p.arrow_color
                    } else {
                        p.arrow_disabled
                    },
                );
            }
        }
    }
}

impl RenderOnce for ScrollArea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let handle = self.handle.clone();
        // The thin platform scrollbar takes space only while the content overflows (read from the
        // previous frame); the reference Sidebar gutter is stable.
        let (reserve, reserve_x) = self.bars.unwrap_or((
            !self.thin || f32::from(self.handle.max_offset().y) > 0.5,
            false,
        ));
        let bars = self.bars;
        let both = self.both;
        let paint = Paint {
            bounds: Bounds::default(),
            m,
            gutter: self.gutter,
            thumb: self.thumb,
            arrows: self.arrows,
            thin: self.thin,
            track_color: t.thin_track,
            thumb_color: if self.thin {
                t.thin_thumb
            } else {
                t.scroll_thumb
            },
            arrow_color: if self.thin {
                t.thin_thumb
            } else {
                t.scroll_arrow
            },
            arrow_disabled: if self.thin {
                t.thin_thumb.opacity(0.5)
            } else {
                t.scroll_arrow_disabled
            },
        };
        let scroller = div()
            .id(ElementId::Name(self.id.clone()))
            .size_full()
            .track_scroll(&self.handle)
            .pr(if reserve { m.px(self.gutter) } else { px(0.0) })
            .pb(if reserve_x {
                m.px(self.gutter)
            } else {
                px(0.0)
            })
            .children(self.children);
        div()
            .relative()
            .size_full()
            .child(if both {
                scroller.overflow_scroll()
            } else {
                scroller.overflow_y_scroll()
            })
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let p = Paint { bounds, ..paint };
                        let gutter = f32::from(p.m.px(p.gutter));
                        let (vertical, horizontal) = bars.unwrap_or((
                            f32::from(handle.max_offset().y) > 0.5,
                            both && f32::from(handle.max_offset().x) > 0.5,
                        ));
                        let corner = |shown: bool| if shown { gutter } else { 0.0 };
                        // Decided bars paint only where a gutter was reserved.
                        if bars.is_none_or(|(v, _)| v) {
                            paint_scrollbar(
                                &p,
                                &handle,
                                Axis::Vertical,
                                corner(horizontal),
                                window,
                            );
                        }
                        if both && horizontal {
                            paint_scrollbar(
                                &p,
                                &handle,
                                Axis::Horizontal,
                                corner(vertical),
                                window,
                            );
                        }
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::{bars_needed, thumb_geometry};

    #[test]
    fn bars_appear_only_for_real_overflow() {
        // Exactly fitting content shows nothing (no self-sustaining gutter).
        assert_eq!(
            bars_needed((949.0, 512.0), (949.0, 512.0), 10.0),
            (false, false)
        );
        assert_eq!(
            bars_needed((949.0, 600.0), (949.0, 512.0), 10.0),
            (true, true)
        );
        assert_eq!(
            bars_needed((930.0, 600.0), (949.0, 512.0), 10.0),
            (true, false)
        );
        assert_eq!(
            bars_needed((1200.0, 505.0), (949.0, 512.0), 10.0),
            (true, true)
        );
        assert_eq!(
            bars_needed((1200.0, 400.0), (949.0, 512.0), 10.0),
            (false, true)
        );
    }

    #[test]
    fn thumb_tracks_offset_and_respects_minimum() {
        assert_eq!(thumb_geometry(100.0, 100.0, 100.0, 0.0, 28.0), None);
        let (top, height) = thumb_geometry(100.0, 100.0, 400.0, 0.0, 28.0).unwrap();
        assert_eq!((top, height), (0.0, 28.0));
        let (top, _) = thumb_geometry(100.0, 100.0, 400.0, 300.0, 28.0).unwrap();
        assert_eq!(top, 72.0);
        let (_, height) = thumb_geometry(100.0, 100.0, 200.0, 0.0, 28.0).unwrap();
        assert_eq!(height, 50.0);
    }
}
