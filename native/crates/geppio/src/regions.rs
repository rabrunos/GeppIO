//! Sidebar and Bottom presentation state (reference `useRegions.ts`), independent of
//! rendering. Durations pass through the reduced-motion rule; every animated value is a
//! CSS-retargeting [`Transition`] sampled at frame time.
use geppio_core::shell::{BOTTOM_LIMITS, RAIL, SIDEBAR_LIMITS};
use geppui::motion::{self, Transition, duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SidebarMode {
    Docked,
    Peek,
    Hidden,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis {
    X,
    Y,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub track: f64,
    pub bottom: f64,
    pub peek_x: f64,
    pub peek_opacity: f64,
    pub backdrop: f64,
}

#[derive(Clone, Debug)]
pub struct Regions {
    pub sidebar_width: f64,
    pub bottom_height: f64,
    pub sidebar_collapsed: bool,
    pub bottom_collapsed: bool,
    /// Collapsed and presented as a floating panel (kept after the peek closes).
    pub floating: bool,
    pub peek: bool,
    /// Set by an explicit collapse: no peek until the pointer leaves and re-enters.
    pub block_peek: bool,
    pub resizing: Option<Axis>,
    pub reduced: bool,
    track: Transition,
    bottom: Transition,
    peek_x: Transition,
    peek_opacity: Transition,
    backdrop: Transition,
}

impl Regions {
    pub fn new(
        sidebar_width: f64,
        bottom_height: f64,
        sidebar_collapsed: bool,
        bottom_collapsed: bool,
    ) -> Self {
        let track = if sidebar_collapsed {
            RAIL
        } else {
            RAIL + sidebar_width
        };
        let bottom = if bottom_collapsed { 0.0 } else { bottom_height };
        Self {
            sidebar_width,
            bottom_height,
            sidebar_collapsed,
            bottom_collapsed,
            floating: false,
            peek: false,
            block_peek: false,
            resizing: None,
            reduced: false,
            track: Transition::new(track),
            bottom: Transition::new(bottom),
            peek_x: Transition::new(-4.0),
            peek_opacity: Transition::new(0.0),
            backdrop: Transition::new(0.0),
        }
    }

    fn d(&self, ms: f64) -> f64 {
        motion::reduce(ms, self.reduced)
    }

    pub fn mode(&self) -> SidebarMode {
        if !self.sidebar_collapsed {
            SidebarMode::Docked
        } else if self.peek {
            SidebarMode::Peek
        } else {
            SidebarMode::Hidden
        }
    }

    /// Pin button, active rail bar or splitter click.
    pub fn toggle_sidebar(&mut self) {
        self.sidebar_collapsed = !self.sidebar_collapsed;
        if self.sidebar_collapsed {
            self.block_peek = true;
            self.floating = false;
        } else {
            // "Fixar barra lateral" from a peek clears both flags in one update: the panel
            // disappears in the same frame and the docked content wipes open from width 0.
            self.floating = false;
            self.peek = false;
            self.peek_x.jump(-4.0);
            self.peek_opacity.jump(0.0);
            let d = self.d(duration::BACKDROP);
            self.backdrop.request(0.0, d, motion::EASE);
        }
        self.retarget_sidebar();
    }

    fn retarget_sidebar(&mut self) {
        let target = if self.sidebar_collapsed {
            RAIL
        } else {
            RAIL + self.sidebar_width
        };
        // 0s while resizing a docked Sidebar (inventory §8).
        let d = if self.resizing == Some(Axis::X) && !self.sidebar_collapsed {
            0.0
        } else {
            self.d(duration::REGION)
        };
        self.track.request(target, d, motion::REGION);
    }

    pub fn toggle_bottom(&mut self) {
        self.bottom_collapsed = !self.bottom_collapsed;
        if !self.bottom_collapsed && self.bottom_height < BOTTOM_LIMITS.min {
            self.bottom_height = BOTTOM_LIMITS.min;
        }
        self.retarget_bottom();
    }

    fn retarget_bottom(&mut self) {
        let target = if self.bottom_collapsed {
            0.0
        } else {
            self.bottom_height
        };
        let d = if self.resizing == Some(Axis::Y) && !self.bottom_collapsed {
            0.0
        } else {
            self.d(duration::REGION)
        };
        self.bottom.request(target, d, motion::REGION);
    }

    /// Live Sidebar resize; below `min − 48` the Sidebar collapses and the rest animates.
    pub fn resize_sidebar(&mut self, width: f64, max: f64) {
        self.resizing = Some(Axis::X);
        if width < SIDEBAR_LIMITS.min - RAIL {
            if !self.sidebar_collapsed {
                self.toggle_sidebar();
            }
            return;
        }
        if self.sidebar_collapsed {
            self.toggle_sidebar();
        }
        self.sidebar_width = width.clamp(SIDEBAR_LIMITS.min, max);
        self.retarget_sidebar();
    }

    /// Live Bottom resize; below `min − 48` it collapses, dragging up from hidden reveals live.
    pub fn resize_bottom(&mut self, height: f64) {
        self.resizing = Some(Axis::Y);
        if height < BOTTOM_LIMITS.min - RAIL {
            if !self.bottom_collapsed {
                self.toggle_bottom();
            }
            return;
        }
        self.bottom_collapsed = false;
        self.bottom_height = height.clamp(BOTTOM_LIMITS.min, BOTTOM_LIMITS.max);
        self.retarget_bottom();
    }

    pub fn end_resize(&mut self) {
        self.resizing = None;
    }

    pub fn can_peek(&self) -> bool {
        self.sidebar_collapsed && !self.block_peek && !self.peek
    }

    /// Opens the floating Sidebar. Every peek animates (owner decision in #73: the
    /// reference's instant first peek is an intentional difference).
    pub fn open_peek(&mut self) {
        if !self.sidebar_collapsed || self.peek {
            return;
        }
        self.floating = true;
        self.peek = true;
        let (x, fade, back) = (
            self.d(duration::REGION),
            self.d(duration::PEEK_FADE),
            self.d(duration::BACKDROP),
        );
        self.peek_x.request(0.0, x, motion::REGION);
        self.peek_opacity.request(1.0, fade, motion::EASE);
        self.backdrop.request(1.0, back, motion::EASE);
    }

    pub fn close_peek(&mut self) {
        if !self.peek {
            return;
        }
        self.peek = false;
        let (x, fade, back) = (
            self.d(duration::SIDEBAR_HIDE),
            self.d(duration::SIDEBAR_HIDE_FADE),
            self.d(duration::BACKDROP),
        );
        self.peek_x.request(-4.0, x, motion::REGION);
        self.peek_opacity.request(0.0, fade, motion::EASE);
        self.backdrop.request(0.0, back, motion::EASE);
    }

    pub fn sample(&mut self, now: f64) -> Frame {
        Frame {
            track: self.track.sample(now),
            bottom: self.bottom.sample(now),
            peek_x: self.peek_x.sample(now),
            peek_opacity: self.peek_opacity.sample(now),
            backdrop: self.backdrop.sample(now),
        }
    }

    pub fn animating(&self, now: f64) -> bool {
        [
            &self.track,
            &self.bottom,
            &self.peek_x,
            &self.peek_opacity,
            &self.backdrop,
        ]
        .iter()
        .any(|t| t.animating(now))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapse_blocks_peek_until_reentry() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        r.toggle_sidebar();
        assert_eq!(r.mode(), SidebarMode::Hidden);
        assert!(!r.can_peek());
        r.block_peek = false;
        assert!(r.can_peek());
        r.open_peek();
        assert_eq!(r.mode(), SidebarMode::Peek);
        assert!(r.floating);
        r.close_peek();
        assert!(r.floating, "floating stays after the peek closes");
    }

    #[test]
    fn collapse_animates_and_reverses_from_current_value() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        r.sample(0.0);
        r.toggle_sidebar();
        assert_eq!(r.sample(0.0).track, 331.0);
        let mid = r.sample(170.0).track;
        assert!(mid < 331.0 && mid > 48.0);
        r.toggle_sidebar();
        assert_eq!(r.sample(170.0).track, mid);
        assert_eq!(r.sample(170.0 + 340.0).track, 331.0);
    }

    #[test]
    fn pin_from_peek_drops_the_panel_and_wipes_open() {
        let mut r = Regions::new(283.0, 167.0, true, false);
        r.open_peek();
        r.sample(0.0);
        r.toggle_sidebar();
        let f = r.sample(1.0);
        assert_eq!(f.peek_opacity, 0.0);
        assert!(f.track < 60.0);
        assert!(!r.floating && !r.peek);
    }

    #[test]
    fn resizing_is_immediate_and_collapses_below_threshold() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        r.resize_sidebar(300.0, 430.0);
        assert_eq!(r.sample(0.0).track, 348.0);
        r.resize_sidebar(100.0, 430.0);
        assert!(r.sidebar_collapsed);
        r.end_resize();
        r.resize_bottom(60.0);
        assert!(r.bottom_collapsed);
        r.resize_bottom(140.0);
        assert!(!r.bottom_collapsed);
        assert_eq!(r.bottom_height, 140.0);
    }

    #[test]
    fn reduced_motion_settles_in_one_millisecond() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        r.reduced = true;
        r.sample(0.0);
        r.toggle_sidebar();
        r.sample(0.0);
        assert_eq!(r.sample(1.0).track, 48.0);
    }
}
