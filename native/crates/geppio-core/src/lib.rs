//! GeppIO's pure Rust model. No GPUI, no window and no platform services: every behaviour
//! here is testable headless.
#![forbid(unsafe_code)]

pub mod geometry;
pub mod shell;

pub use geometry::Rect;
