//! Continuous CSS-pixel layout engine, ported from `src/geppio-runtime/src/layout/`:
//! constraints, clearance, candidate rectangles, bounded reflow and alignment. Every
//! operation repeats the reference's f64 arithmetic in the same order.
#![warn(missing_docs)]
pub mod alignment;
pub mod geometry;
pub mod reflow;
pub mod types;

pub use alignment::{
    ALIGNMENT_ENTER, ALIGNMENT_EXIT, AlignedGesture, AlignmentCandidate, AlignmentGuide,
    AlignmentLocks, GuideKind, aligned_gesture, aligned_move, alignment_candidates,
    resolve_alignment,
};
pub use geometry::{
    EPSILON, allows_resize, candidate, clamp, collides, distance, same, settle_placements,
    too_close, valid_layout, valid_rect,
};
pub use reflow::{BlockReason, Budget, ReflowResult, Status, reflow};
pub use types::*;

/// Shared policy constants (`policy.ts`).
pub mod policy {
    use super::types::{Region, Size, Surface};

    /// Sidebar inner inset.
    pub const INSET: f64 = 15.0;
    /// Clearance between widgets on a separating axis.
    pub const GAP: f64 = 10.0;
    /// Maximum local travel of a displaced widget during broad search.
    pub const MAX_LOCAL_TRAVEL: f64 = 1024.0;
    /// Coordinate and world cap.
    pub const MAX_COORDINATE: f64 = 100_000.0;
    /// Individual dimension cap.
    pub const MAX_SIZE: f64 = 4096.0;
    /// Engine widget cap per document and region.
    pub const MAX_WIDGETS: usize = 16;
    /// Input byte cap (64 KiB).
    pub const MAX_BYTES: usize = 64 * 1024;

    /// The usable limit of a surface: expanded Main is horizontally unbounded and the
    /// Sidebar is vertically unbounded (`surfaceLimit`).
    pub fn surface_limit(s: &Surface) -> Size {
        Size {
            width: if s.expanded && s.region == Region::Main {
                MAX_COORDINATE
            } else {
                s.width
            },
            height: if s.region == Region::Sidebar {
                MAX_COORDINATE
            } else {
                s.height
            },
        }
    }
}
