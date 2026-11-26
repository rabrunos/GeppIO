//! Vertical scroll area with the reference's custom scrollbar: a stable gutter (15px by
//! default), a 5px pill thumb (text at 18%, 36% while hovered; minimum 28px) and end arrow
//! buttons (15×9px with a 5×3px triangle; 14%, hovered 36%, cannot scroll 8%).
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
    thumb_color: Hsla,
    arrow_color: Hsla,
    arrow_disabled: Hsla,
}

fn paint_scrollbar(p: &Paint, handle: &ScrollHandle, window: &mut Window) {
    let viewport = f32::from(handle.bounds().size.height);
    let max = f32::from(handle.max_offset().y);
    let offset = -f32::from(handle.offset().y);
    let arrow_h = if p.arrows {
        f32::from(p.m.px(9.0))
    } else {
        0.0
    };
    let gutter = f32::from(p.m.px(p.gutter));
    let x0 = f32::from(p.bounds.origin.x + p.bounds.size.width) - gutter;
    let y0 = f32::from(p.bounds.origin.y);
    let track = viewport - 2.0 * arrow_h;
    if let Some((top, height)) = thumb_geometry(
        track,
        viewport,
        viewport + max,
        offset,
        f32::from(p.m.px(28.0)),
    ) {
        let width = f32::from(p.m.px(p.thumb));
        let bounds = Bounds {
            origin: point(px(x0 + (gutter - width) / 2.0), px(y0 + arrow_h + top)),
            size: size(px(width), px(height)),
        };
        window.paint_quad(gpui::fill(bounds, p.thumb_color).corner_radii(px(width / 2.0)));
    }
    if p.arrows && max > 0.5 {
        let (w, h) = (f32::from(p.m.px(5.0)), f32::from(p.m.px(3.0)));
        let cx = x0 + gutter / 2.0;
        for (up, cy) in [
            (true, y0 + arrow_h / 2.0),
            (false, y0 + viewport - arrow_h / 2.0),
        ] {
            let enabled = if up { offset > 0.5 } else { offset < max - 0.5 };
            let mut path = PathBuilder::fill();
            let (tip, base) = if up {
                (cy - h / 2.0, cy + h / 2.0)
            } else {
                (cy + h / 2.0, cy - h / 2.0)
            };
            path.move_to(point(px(cx), px(tip)));
            path.line_to(point(px(cx + w / 2.0), px(base)));
            path.line_to(point(px(cx - w / 2.0), px(base)));
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
        let paint = Paint {
            bounds: Bounds::default(),
            m,
            gutter: self.gutter,
            thumb: self.thumb,
            arrows: self.arrows,
            thumb_color: t.scroll_thumb,
            arrow_color: t.scroll_arrow,
            arrow_disabled: t.scroll_arrow_disabled,
        };
        div()
            .relative()
            .size_full()
            .child(
                div()
                    .id(ElementId::Name(self.id.clone()))
                    .size_full()
                    .overflow_y_scroll()
                    .track_scroll(&self.handle)
                    .pr(m.px(self.gutter))
                    .children(self.children),
            )
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        paint_scrollbar(&Paint { bounds, ..paint }, &handle, window)
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
    use super::thumb_geometry;

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
