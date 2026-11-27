//! Gesture visuals of edit mode (`DragLayer.tsx`, `EditOutline.tsx`, `AlignmentGuides.tsx`
//! and the drag/drop CSS at alpha.99): drag picture and label, origin placeholder, drop
//! zones and alignment/spacing guides. Geometry arrives in window CSS pixels.
use geppui::{Metrics, Rect, Theme, css_weight, dashed_outline};
use gpui::{AnyElement, Div, ParentElement, Styled, div, prelude::FluentBuilder};

fn placed(m: Metrics, r: Rect) -> Div {
    let p = m.place(r);
    div()
        .absolute()
        .left(p.left)
        .top(p.top)
        .w(p.width)
        .h(p.height)
}

/// The lifted picture: square 1px accent-border outline and the flight shadow, no radius.
/// `content` is the widget frame rendered at the picture size.
pub fn picture(m: Metrics, t: &Theme, r: Rect, content: AnyElement, flying: bool) -> Div {
    placed(m, r)
        .when(!flying, |el| {
            el.border(m.border(1.0)).border_color(t.accent_border)
        })
        .shadow(vec![m.shadow(t.shadow_flight)])
        .overflow_hidden()
        .child(content)
}

/// `.layout-drag-label` beside the pointer (clamped to the window, above the picture).
pub fn label(
    m: Metrics,
    t: &Theme,
    pointer: (f32, f32),
    viewport: (f32, f32),
    text: &'static str,
) -> Div {
    let width = 11.0 * 0.55 * text.chars().count() as f32 + 20.0;
    let left = (pointer.0 + 12.0).clamp(8.0, (viewport.0 - width - 8.0).max(8.0));
    let top = (pointer.1 - 28.0 - 12.0).max(8.0);
    div()
        .absolute()
        .left(m.px(left))
        .top(m.px(top))
        .px(m.px(10.0))
        .py(m.px(6.0))
        .rounded(m.px(8.0))
        .border(m.border(1.0))
        .border_color(t.accent_border)
        .bg(t.surface)
        .shadow(vec![m.shadow(t.shadow_side)])
        .text_size(m.px(11.0))
        .line_height(m.px(16.0))
        .font_weight(css_weight(600.0))
        .text_color(t.text)
        .whitespace_nowrap()
        .child(text)
}

/// Dashed placeholder left at the origin of a frame drag.
pub fn origin(m: Metrics, t: &Theme, r: Rect) -> Div {
    placed(m, r)
        .rounded(m.px(12.0))
        .border(m.border(1.0))
        .border_dashed()
        .border_color(t.accent.opacity(0.35))
        .bg(t.accent.opacity(0.02))
}

/// A region drop zone: the region port expanded by 3px, 12px radius, accent fill 3% (7%
/// under the pointer) and the reference dashed outline at 50% (65%). `over` is the eased
/// 0→1 progress of the 140ms hover transition.
pub fn drop_zone(m: Metrics, t: &Theme, port: Rect, over: f32) -> Div {
    let r = Rect::new(port.x - 3.0, port.y - 3.0, port.w + 6.0, port.h + 6.0);
    let fill = 0.03 + 0.04 * over;
    let stroke = 0.5 + 0.15 * over;
    placed(m, r)
        .rounded(m.px(12.0))
        .bg(t.accent.opacity(fill))
        .child(dashed_outline(
            r.w as f64,
            r.h as f64,
            m,
            t.accent.opacity(stroke),
        ))
}

/// Alignment (1px line) or spacing (gap rectangle with a `{gap}px` label) guide.
#[derive(Clone, Debug, PartialEq)]
pub enum Guide {
    Alignment {
        vertical: bool,
        line: f32,
        from: f32,
        to: f32,
    },
    Spacing {
        vertical: bool,
        line: f32,
        gap: f32,
        from: f32,
        to: f32,
    },
}

pub fn guide(m: Metrics, t: &Theme, g: &Guide) -> Div {
    match *g {
        Guide::Alignment {
            vertical,
            line,
            from,
            to,
        } => {
            let r = if vertical {
                Rect::new(line, from, 1.0, to - from)
            } else {
                Rect::new(from, line, to - from, 1.0)
            };
            placed(m, r).bg(t.accent).shadow(vec![
                gpui::BoxShadow::new(m.px(0.0), m.px(0.0), t.accent_soft).spread_radius(m.px(1.0)),
            ])
        }
        Guide::Spacing {
            vertical,
            line,
            gap,
            from,
            to,
        } => {
            let r = if vertical {
                Rect::new(line - gap, from, gap, to - from)
            } else {
                Rect::new(from, line - gap, to - from, gap)
            };
            placed(m, r)
                .flex()
                .items_center()
                .justify_center()
                .bg(t.accent_soft)
                .border(m.border(1.0))
                .border_dashed()
                .border_color(t.accent)
                .child(
                    div()
                        .px(m.px(4.0))
                        .py(m.px(2.0))
                        .rounded(m.px(3.0))
                        .bg(t.surface)
                        .text_size(m.px(10.0))
                        .line_height(m.px(13.0))
                        .text_color(t.accent)
                        .child(format!("{gap}px")),
                )
        }
    }
}
