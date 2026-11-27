//! The drop-zone outline: solid rounded corner brackets joined by a 17/15 dashed line on each
//! side, 1px with round caps and joins, inset by half a pixel. Geometry follows the reference
//! `EditOutline` exactly; it is a project-owned path because GPUI's dashed borders differ.
use gpui::{
    Bounds, Hsla, IntoElement, LineCap, LineJoin, PathBuilder, PathStyle, Pixels, Point,
    StrokeOptions, Styled, Window, canvas, point, px,
};

use crate::Metrics;

/// One side's dash layout: `count` dashes and the straight `end` of each corner bracket.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SidePattern {
    pub count: usize,
    pub end: f64,
}

pub fn side_pattern(length: f64) -> SidePattern {
    let count = ((length - 15.0) / 32.0).floor().max(0.0);
    SidePattern {
        count: count as usize,
        end: ((length - count * 17.0 - (count + 1.0) * 15.0) / 2.0).max(0.0),
    }
}

/// A point in CSS pixels.
pub type Point2 = (f64, f64);
/// A dashed segment (start, end).
pub type Segment = (Point2, Point2);

/// Outline geometry in CSS pixels relative to the zone's top-left corner.
#[derive(Clone, Debug, PartialEq)]
pub struct OutlineGeometry {
    pub radius: f64,
    /// Four corner brackets: start, corner start, arc end, bracket end.
    pub corners: [[Point2; 4]; 4],
    /// Dashed lines (start, end) per side; `None` when the side has no dash.
    pub lines: [Option<Segment>; 4],
}

pub fn outline_geometry(width: f64, height: f64) -> OutlineGeometry {
    let (x, y, right, bottom) = (0.5, 0.5, width - 0.5, height - 0.5);
    let r = 11.5f64
        .min((width - 1.0) / 2.0)
        .min((height - 1.0) / 2.0)
        .max(0.0);
    let horizontal = side_pattern((width - 1.0 - 2.0 * r).max(0.0));
    let vertical = side_pattern((height - 1.0 - 2.0 * r).max(0.0));
    let (h, v) = (horizontal.end, vertical.end);
    let corners = [
        [(x + r + h, y), (x + r, y), (x, y + r), (x, y + r + v)],
        [
            (right - r - h, y),
            (right - r, y),
            (right, y + r),
            (right, y + r + v),
        ],
        [
            (right, bottom - r - v),
            (right, bottom - r),
            (right - r, bottom),
            (right - r - h, bottom),
        ],
        [
            (x + r + h, bottom),
            (x + r, bottom),
            (x, bottom - r),
            (x, bottom - r - v),
        ],
    ];
    let (hs, vs) = (x + r + h + 15.0, y + r + v + 15.0);
    let length = |p: SidePattern| (p.count as f64 * 17.0 + (p.count as f64 - 1.0) * 15.0).max(0.0);
    let (hl, vl) = (length(horizontal), length(vertical));
    let line = |count: usize, from: (f64, f64), to: (f64, f64)| (count > 0).then_some((from, to));
    OutlineGeometry {
        radius: r,
        corners,
        lines: [
            line(horizontal.count, (hs, y), (hs + hl, y)),
            line(vertical.count, (right, vs), (right, vs + vl)),
            line(horizontal.count, (hs, bottom), (hs + hl, bottom)),
            line(vertical.count, (x, vs), (x, vs + vl)),
        ],
    }
}

fn stroke(m: Metrics) -> PathBuilder {
    PathBuilder::stroke(m.px(1.0)).with_style(PathStyle::Stroke(StrokeOptions {
        line_width: f32::from(m.px(1.0)),
        line_cap: LineCap::Round,
        line_join: LineJoin::Round,
        miter_limit: 4.0,
    }))
}

fn paint(
    bounds: Bounds<Pixels>,
    width: f64,
    height: f64,
    m: Metrics,
    color: Hsla,
    window: &mut Window,
) {
    let g = outline_geometry(width, height);
    let at = |(x, y): (f64, f64)| -> Point<Pixels> {
        point(
            bounds.origin.x + m.px(x as f32),
            bounds.origin.y + m.px(y as f32),
        )
    };
    let mut corners = stroke(m);
    let radius = m.px(g.radius as f32);
    // Sweep flags of the reference path: 0 for the top-left bracket, 1 for the others.
    for (i, c) in g.corners.iter().enumerate() {
        corners.move_to(at(c[0]));
        corners.line_to(at(c[1]));
        corners.arc_to(point(radius, radius), px(0.0), false, i != 0, at(c[2]));
        corners.line_to(at(c[3]));
    }
    if let Ok(path) = corners.build() {
        window.paint_path(path, color);
    }
    let mut dashes = stroke(m).dash_array(&[m.px(17.0), m.px(15.0)]);
    let mut any = false;
    for (from, to) in g.lines.iter().flatten() {
        dashes.move_to(at(*from));
        dashes.line_to(at(*to));
        any = true;
    }
    if any && let Ok(path) = dashes.build() {
        window.paint_path(path, color);
    }
}

/// A canvas element that paints the outline over its own bounds (CSS size `width × height`).
pub fn dashed_outline(width: f64, height: f64, m: Metrics, color: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| paint(bounds, width, height, m, color, window),
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_patterns_match_the_reference_formula() {
        // L = 15 → no dash; L = 47 → one dash and 0 end; L = 100 → two dashes.
        assert_eq!(side_pattern(15.0), SidePattern { count: 0, end: 0.0 });
        assert_eq!(side_pattern(47.0), SidePattern { count: 1, end: 0.0 });
        assert_eq!(
            side_pattern(100.0),
            SidePattern {
                count: 2,
                end: (100.0 - 34.0 - 45.0) / 2.0
            }
        );
    }

    #[test]
    fn geometry_of_a_main_zone() {
        // Main port 927×494 at 1280×800, expanded by 3px on each side.
        let g = outline_geometry(933.0, 500.0);
        assert_eq!(g.radius, 11.5);
        let horizontal = side_pattern(933.0 - 1.0 - 23.0);
        assert_eq!(g.corners[0][0], (0.5 + 11.5 + horizontal.end, 0.5));
        let (from, to) = g.lines[0].unwrap();
        assert_eq!(from.0, 0.5 + 11.5 + horizontal.end + 15.0);
        assert_eq!(
            to.0 - from.0,
            horizontal.count as f64 * 17.0 + (horizontal.count as f64 - 1.0) * 15.0
        );
        // A tiny zone has no dashes and a reduced radius.
        let small = outline_geometry(20.0, 12.0);
        assert_eq!(small.radius, 5.5);
        assert!(small.lines.iter().all(Option::is_none));
    }
}
