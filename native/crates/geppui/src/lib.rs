//! GeppUI: GeppIO's independent component library for upstream GPUI.
//!
//! It knows nothing about GeppIO, widgets, bars or persistence. Hosts install an
//! [`Appearance`] (theme, zoom, reduced motion and the motion clock) as a GPUI global and
//! compose the primitives. Labels and open/close decisions always come from the caller.
#![forbid(unsafe_code)]

pub mod anchor;
pub mod assets;
pub mod button;
pub mod dialog;
pub mod icon;
pub mod metrics;
pub mod motion;
pub mod outline;
pub mod popover;
pub mod scroll;
pub mod text;
pub mod theme;
pub mod toast;

use std::time::Instant;

use gpui::{App, Global, Window};

pub use anchor::{AnchorHandle, anchor_probe};
pub use assets::GeppuiAssets;
pub use button::{Button, IconButton, button, icon_button};
pub use dialog::{Dialog, dialog};
pub use icon::{Icon, icon};
pub use metrics::{Metrics, Placed, Rect, UI_FONT, css_weight};
pub use motion::{CubicBezier, Transition, Tween};
pub use outline::{dashed_outline, outline_geometry};
pub use popover::{Popover, menu_item, popover};
pub use scroll::{ScrollArea, bars_needed, scroll_area};
pub use text::{SpacedText, spaced_text};
pub use theme::{Shadow, Theme, ThemeName};
pub use toast::{Toast, toast};

/// Milliseconds since the host started, or a frozen instant for deterministic captures.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    origin: Instant,
    frozen: Option<f64>,
}

impl Default for Clock {
    fn default() -> Self {
        Self {
            origin: Instant::now(),
            frozen: None,
        }
    }
}

impl Clock {
    pub fn now(&self) -> f64 {
        self.frozen
            .unwrap_or_else(|| self.origin.elapsed().as_secs_f64() * 1000.0)
    }
    pub fn freeze(&mut self, at_ms: Option<f64>) {
        self.frozen = at_ms;
    }
    pub fn frozen(&self) -> bool {
        self.frozen.is_some()
    }
}

/// Host-wide presentation state read by every primitive.
#[derive(Clone, Debug)]
pub struct Appearance {
    pub theme: Theme,
    pub zoom: f32,
    pub reduced_motion: bool,
    pub clock: Clock,
}

impl Global for Appearance {}

impl Appearance {
    pub fn new(theme: ThemeName) -> Self {
        Self {
            theme: Theme::new(theme),
            zoom: 1.0,
            reduced_motion: false,
            clock: Clock::default(),
        }
    }
    pub fn set_theme(&mut self, name: ThemeName) {
        self.theme = Theme::new(name);
    }
    /// A CSS duration after the reduced-motion rule.
    pub fn duration(&self, ms: f64) -> f64 {
        motion::reduce(ms, self.reduced_motion)
    }
}

/// Installs the appearance once at startup.
pub fn init(cx: &mut App, appearance: Appearance) {
    cx.set_global(appearance);
}

pub fn appearance(cx: &App) -> &Appearance {
    cx.global::<Appearance>()
}

pub fn theme(cx: &App) -> Theme {
    cx.global::<Appearance>().theme
}

pub fn metrics(window: &Window, cx: &App) -> Metrics {
    Metrics::new(cx.global::<Appearance>().zoom, window.scale_factor())
}

pub fn now(cx: &App) -> f64 {
    cx.global::<Appearance>().clock.now()
}
