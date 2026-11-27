//! GeppIO's pure Rust model. No GPUI, no window and no platform services: every behaviour
//! here is testable headless.
//!
//! - [`geometry`] and [`shell`]: the shell rectangles the app draws every frame.
//! - [`layout`]: the continuous widget engine (clearance, reflow, alignment).
//! - [`freeform`]: region policy, viewport projection, the freeform codec and transfers.
//! - [`workbench`]: the widget registry, the `geppio:workbench:v1` envelope, edit commands,
//!   history and the [`workbench::EditSession`] transaction the app drives.
//!
//! The layout, freeform and workbench modules are ports of the Electron reference
//! (`src/geppio-runtime/src/layout`, `src/geppio/src/shared/{freeform,workbench}`); the
//! differential tests in `tests/differential.rs` prove identical outputs.
#![forbid(unsafe_code)]

pub mod freeform;
pub mod geometry;
pub mod js;
pub mod json;
pub mod layout;
pub mod shell;
pub mod workbench;

pub use geometry::Rect;
