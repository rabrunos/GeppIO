//! Sidebar and Bottom presentation state (reference `useRegions.ts`), independent of
//! rendering. The confirmed sizes and visibility live in the layout document
//! (`organization.chrome`); this state holds the requested values, the Edit forcing rule,
//! live drags and keyboard adjustments, and returns a [`Publish`] whenever an intention must
//! be recorded. Durations pass through the reduced-motion rule; every animated value is a
//! CSS-retargeting [`Transition`] sampled at frame time.
use geppio_core::shell::{BOTTOM_LIMITS, RAIL, SIDEBAR_LIMITS};
use geppio_core::workbench::WorkbenchChrome;
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

/// An intention to record in `organization.chrome` (`publish`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Publish {
    pub axis: Axis,
    pub size: f64,
    pub visible: bool,
}

/// The reference's `REGION_POLICY`: keyboard steps and the collapse distance.
pub const STEP: f64 = 10.0;
pub const SHIFT_STEP: f64 = 40.0;
pub const COLLAPSE_DISTANCE: f64 = 48.0;

/// A splitter drag in progress.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Drag {
    axis: Axis,
    /// Displayed size when the pointer went down.
    original: f64,
    requested: f64,
    collapsed: bool,
    gesture_collapsed: bool,
    started: bool,
    preview_size: f64,
    preview_collapsed: bool,
    reveal: Option<f64>,
}

/// A keyboard adjustment not yet committed (committed on blur, reverted by Esc).
#[derive(Clone, Copy, Debug, PartialEq)]
struct KeyAdjust {
    axis: Axis,
    requested: f64,
    collapsed: bool,
}

#[derive(Clone, Debug)]
pub struct Regions {
    /// Requested sizes (the displayed size is clamped to the measured bounds).
    pub sidebar_width: f64,
    pub bottom_height: f64,
    pub sidebar_collapsed: bool,
    pub bottom_collapsed: bool,
    /// Edit forces the Sidebar docked and the Bottom visible (`forced`).
    pub forced: bool,
    /// Collapsed and presented as a floating panel (kept after the peek closes).
    pub floating: bool,
    pub peek: bool,
    /// Set by an explicit collapse: no peek until the pointer leaves and re-enters.
    pub block_peek: bool,
    pub resizing: Option<Axis>,
    pub reduced: bool,
    /// Bottom height while dragging it open from collapsed (`bottomReveal`).
    pub bottom_reveal: Option<f64>,
    sidebar_max: f64,
    bottom_max: f64,
    drag: Option<Drag>,
    keyboard: Option<KeyAdjust>,
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
            forced: false,
            floating: false,
            peek: false,
            block_peek: false,
            resizing: None,
            reduced: false,
            bottom_reveal: None,
            sidebar_max: SIDEBAR_LIMITS.max,
            bottom_max: BOTTOM_LIMITS.max,
            drag: None,
            keyboard: None,
            track: Transition::new(track),
            bottom: Transition::new(bottom),
            peek_x: Transition::new(-4.0),
            peek_opacity: Transition::new(0.0),
            backdrop: Transition::new(0.0),
        }
    }

    /// Regions as the confirmed chrome describes them.
    pub fn from_chrome(chrome: &WorkbenchChrome) -> Self {
        Self::new(
            chrome.sidebar.size,
            chrome.bottom.size,
            !chrome.sidebar.visible,
            !chrome.bottom.visible,
        )
    }

    fn d(&self, ms: f64) -> f64 {
        motion::reduce(ms, self.reduced)
    }

    /// `regionBounds`: the minimum never exceeds the maximum.
    fn bounds(&self, axis: Axis) -> (f64, f64) {
        let (min, max) = match axis {
            Axis::X => (SIDEBAR_LIMITS.min, self.sidebar_max),
            Axis::Y => (BOTTOM_LIMITS.min, self.bottom_max),
        };
        (min.min(max), max)
    }

    /// The splitter's accessible value: now, min and max (`aria-valuenow/min/max`). The
    /// Sidebar reports 0 while hidden; Bottom's minimum is 0 while collapsed or revealing.
    pub fn aria(&self, axis: Axis) -> (f64, f64, f64) {
        let (min, max) = self.bounds(axis);
        match axis {
            Axis::X => (
                if self.sidebar_hidden() {
                    0.0
                } else {
                    self.shown_sidebar_width()
                },
                min,
                max,
            ),
            Axis::Y => {
                let open = !(self.bottom_collapsed && !self.forced) && self.bottom_reveal.is_none();
                (self.shown_bottom(), if open { min } else { 0.0 }, max)
            }
        }
    }

    /// `regionSize`.
    fn clamp(&self, axis: Axis, value: f64) -> f64 {
        let (min, max) = self.bounds(axis);
        if value.is_finite() {
            value.max(min).min(max)
        } else {
            min
        }
    }

    fn requested(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => self.sidebar_width,
            Axis::Y => self.bottom_height,
        }
    }

    fn set_requested(&mut self, axis: Axis, value: f64) {
        let value = self.clamp(axis, value);
        match axis {
            Axis::X => self.sidebar_width = value,
            Axis::Y => self.bottom_height = value,
        }
    }

    fn collapsed(&self, axis: Axis) -> bool {
        match axis {
            Axis::X => self.sidebar_collapsed,
            Axis::Y => self.bottom_collapsed,
        }
    }

    fn set_collapsed(&mut self, axis: Axis, collapsed: bool) {
        match axis {
            Axis::X => self.sidebar_collapsed = collapsed,
            Axis::Y => self.bottom_collapsed = collapsed,
        }
    }

    /// Whether the Sidebar is out of the layout (collapsed and not forced by Edit).
    pub fn sidebar_hidden(&self) -> bool {
        self.sidebar_collapsed && !self.forced
    }

    /// The displayed Sidebar content width.
    pub fn shown_sidebar_width(&self) -> f64 {
        self.clamp(Axis::X, self.sidebar_width)
    }

    /// The displayed Bottom height (0 when collapsed, the reveal while dragging it open).
    pub fn shown_bottom(&self) -> f64 {
        self.bottom_reveal
            .unwrap_or(if self.bottom_collapsed && !self.forced {
                0.0
            } else {
                self.clamp(Axis::Y, self.bottom_height)
            })
    }

    pub fn mode(&self) -> SidebarMode {
        if !self.sidebar_hidden() {
            SidebarMode::Docked
        } else if self.peek {
            SidebarMode::Peek
        } else {
            SidebarMode::Hidden
        }
    }

    /// Whether a drag or a keyboard adjustment is in progress (`changing`).
    pub fn changing(&self) -> bool {
        self.drag.is_some() || self.keyboard.is_some()
    }

    pub fn dragging(&self) -> bool {
        self.drag.is_some()
    }

    /// The measured bounds (`regionBounds` of the work area).
    pub fn set_bounds(&mut self, sidebar_max: f64, bottom_max: f64) {
        let (sidebar_max, bottom_max) = (sidebar_max.max(0.0), bottom_max.max(0.0));
        if sidebar_max != self.sidebar_max || bottom_max != self.bottom_max {
            self.sidebar_max = sidebar_max;
            self.bottom_max = bottom_max;
            self.retarget_sidebar();
            self.retarget_bottom();
        }
    }

    /// Adopts the confirmed chrome (`synchronize`); ignored during a drag or keyboard
    /// adjustment, which own the requested values until they end.
    pub fn sync(&mut self, chrome: &WorkbenchChrome) {
        if self.changing() {
            return;
        }
        self.sidebar_width = chrome.sidebar.size;
        self.bottom_height = chrome.bottom.size;
        let docked = chrome.sidebar.visible;
        if docked && self.sidebar_collapsed {
            self.dock_now();
        }
        self.sidebar_collapsed = !docked;
        self.bottom_collapsed = !chrome.bottom.visible;
        self.retarget_sidebar();
        self.retarget_bottom();
    }

    /// Edit forces both regions visible (`useLayoutEffect(..., [forced])`): any drag or
    /// keyboard adjustment is dropped and an open peek closes.
    pub fn set_forced(&mut self, forced: bool) {
        if forced == self.forced {
            return;
        }
        self.drag = None;
        self.keyboard = None;
        self.bottom_reveal = None;
        self.resizing = None;
        self.forced = forced;
        if forced {
            self.close_peek();
        }
        self.retarget_sidebar();
        self.retarget_bottom();
    }

    /// The docked content wipes open from width 0 and the panel disappears in one frame.
    fn dock_now(&mut self) {
        self.floating = false;
        self.peek = false;
        self.peek_x.jump(-4.0);
        self.peek_opacity.jump(0.0);
        let d = self.d(duration::BACKDROP);
        self.backdrop.request(0.0, d, motion::EASE);
    }

    /// Pin button or active rail bar (`toggle('sidebar')`); nothing while forced.
    pub fn toggle_sidebar(&mut self) -> Option<Publish> {
        if self.forced {
            return None;
        }
        let was = self.sidebar_collapsed;
        self.sidebar_collapsed = !was;
        self.block_peek = true;
        if self.sidebar_collapsed {
            self.floating = false;
            self.peek = false;
        } else {
            self.dock_now();
        }
        self.retarget_sidebar();
        Some(Publish {
            axis: Axis::X,
            size: self.sidebar_width,
            visible: was,
        })
    }

    /// `toggle('bottom')` (automation hooks); nothing while forced.
    pub fn toggle_bottom(&mut self) -> Option<Publish> {
        if self.forced {
            return None;
        }
        let was = self.bottom_collapsed;
        self.bottom_collapsed = !was;
        self.block_peek = true;
        self.retarget_bottom();
        Some(Publish {
            axis: Axis::Y,
            size: self.bottom_height,
            visible: was,
        })
    }

    /// The Bottom tray height for layout: the reveal while dragging it open, else the
    /// requested height within bounds.
    pub fn bottom_layout_height(&self) -> f64 {
        self.bottom_reveal
            .unwrap_or_else(|| self.clamp(Axis::Y, self.bottom_height))
    }

    fn retarget_sidebar(&mut self) {
        let target = if self.sidebar_hidden() {
            RAIL
        } else {
            RAIL + self.shown_sidebar_width()
        };
        // 0s while resizing a docked Sidebar (inventory §8).
        let d = if self.resizing == Some(Axis::X) && !self.sidebar_hidden() {
            0.0
        } else {
            self.d(duration::REGION)
        };
        self.track.request(target, d, motion::REGION);
    }

    fn retarget_bottom(&mut self) {
        let target = self.shown_bottom();
        let live = self.resizing == Some(Axis::Y) && !(self.bottom_collapsed && !self.forced);
        let d = if live || self.bottom_reveal.is_some() {
            0.0
        } else {
            self.d(duration::REGION)
        };
        self.bottom.request(target, d, motion::REGION);
    }

    fn retarget(&mut self, axis: Axis) {
        match axis {
            Axis::X => self.retarget_sidebar(),
            Axis::Y => self.retarget_bottom(),
        }
    }

    fn displayed(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => {
                if self.sidebar_hidden() {
                    0.0
                } else {
                    self.shown_sidebar_width()
                }
            }
            Axis::Y => self.shown_bottom(),
        }
    }

    // ---- splitter drags (`handlers().onPointer*`) ---------------------------------------

    pub fn begin_drag(&mut self, axis: Axis) {
        if self.drag.is_some() {
            return;
        }
        self.keyboard = None;
        let requested = self.requested(axis);
        let collapsed = self.collapsed(axis);
        self.drag = Some(Drag {
            axis,
            original: self.displayed(axis),
            requested,
            collapsed,
            gesture_collapsed: false,
            started: false,
            preview_size: requested,
            preview_collapsed: collapsed,
            reveal: None,
        });
    }

    /// One pointer frame: `delta` grows the region (right for the Sidebar, up for Bottom).
    pub fn drag_by(&mut self, delta: f64) {
        let Some(mut a) = self.drag else {
            return;
        };
        let value = a.original + delta;
        if !a.started && (value - a.original).abs() < 4.0 {
            return;
        }
        a.started = true;
        self.resizing = Some(a.axis);
        let (min, max) = self.bounds(a.axis);
        if a.axis == Axis::Y && a.collapsed && !self.forced {
            let reveal = value.max(0.0).min(max);
            a.preview_size = if reveal > 0.0 {
                min.max(reveal)
            } else {
                a.requested
            };
            a.preview_collapsed = reveal == 0.0;
            a.reveal = Some(reveal);
            self.bottom_reveal = Some(reveal);
            self.bottom_collapsed = reveal == 0.0;
            self.drag = Some(a);
            self.retarget_bottom();
            return;
        }
        if a.gesture_collapsed && value < min {
            self.drag = Some(a);
            return;
        }
        let collapse = !self.forced && value < min - COLLAPSE_DISTANCE;
        a.gesture_collapsed = collapse;
        a.preview_size = self.clamp(a.axis, value);
        a.preview_collapsed = collapse;
        a.reveal = None;
        if collapse && a.axis == Axis::X {
            self.floating = false;
        }
        self.drag = Some(a);
        self.set_collapsed(a.axis, collapse);
        self.set_requested(a.axis, value);
        self.retarget(a.axis);
    }

    /// Pointer release; `travel` is the pointer's total movement. A press under 4px toggles
    /// the region (Bottom reopens at its minimum).
    pub fn end_drag(&mut self, travel: f64) -> Option<Publish> {
        let a = self.drag.take()?;
        self.resizing = None;
        if a.axis == Axis::Y && a.reveal.is_some() {
            if a.reveal.is_some_and(|r| r > 0.0) {
                self.set_requested(Axis::Y, a.preview_size);
            }
            self.bottom_collapsed = a.preview_collapsed;
            self.bottom_reveal = None;
        }
        let publish = if !a.started && travel < 4.0 && !self.forced {
            let reopen_bottom = a.axis == Axis::Y && a.collapsed;
            if reopen_bottom {
                let (min, _) = self.bounds(Axis::Y);
                self.set_requested(Axis::Y, min);
            }
            self.set_collapsed(a.axis, !a.collapsed);
            if a.axis == Axis::X && !a.collapsed {
                self.floating = false;
            }
            Publish {
                axis: a.axis,
                size: self.requested(a.axis),
                visible: a.collapsed,
            }
        } else {
            Publish {
                axis: a.axis,
                size: a.preview_size,
                visible: !a.preview_collapsed,
            }
        };
        self.retarget(a.axis);
        Some(publish)
    }

    /// Esc, window blur, a viewport change or a lost pointer (`cancel`): the request and
    /// visibility from before the drag come back.
    pub fn cancel_drag(&mut self) -> bool {
        let Some(a) = self.drag.take() else {
            return false;
        };
        self.resizing = None;
        self.bottom_reveal = None;
        match a.axis {
            Axis::X => self.sidebar_width = a.requested,
            Axis::Y => self.bottom_height = a.requested,
        }
        self.set_collapsed(a.axis, a.collapsed);
        self.retarget(a.axis);
        true
    }

    // ---- splitter keyboard (`handlers().onKeyDown`, `onBlur`) ---------------------------

    /// A key on a focused splitter. Returns whether it was handled and what to record now
    /// (Enter/Space record at once; arrows, Home and End record on blur).
    pub fn key(&mut self, axis: Axis, key: &str, shift: bool) -> (bool, Option<Publish>) {
        if key == "escape" && self.drag.is_some() {
            self.cancel_drag();
            return (true, None);
        }
        if key == "escape" && self.keyboard.is_some_and(|k| k.axis == axis) {
            self.revert_keyboard();
            return (true, None);
        }
        let (min, max) = self.bounds(axis);
        if key == "enter" || key == "space" {
            if self.forced {
                return (true, None);
            }
            self.keyboard = None;
            let collapsed = self.collapsed(axis);
            if axis == Axis::Y && collapsed {
                self.set_requested(Axis::Y, min);
            }
            self.set_collapsed(axis, !collapsed);
            if axis == Axis::X && !collapsed {
                self.floating = false;
            }
            self.retarget(axis);
            return (
                true,
                Some(Publish {
                    axis,
                    size: self.requested(axis),
                    visible: collapsed,
                }),
            );
        }
        if key == "home" || key == "end" {
            self.start_keyboard(axis);
            self.set_requested(axis, if key == "home" { min } else { max });
            self.set_collapsed(axis, false);
            self.retarget(axis);
            return (true, None);
        }
        let (less, more) = match axis {
            Axis::X => ("left", "right"),
            Axis::Y => ("down", "up"),
        };
        if key != less && key != more {
            return (false, None);
        }
        if self.drag.is_some() {
            return (true, None);
        }
        self.start_keyboard(axis);
        let delta = if key == less { -1.0 } else { 1.0 } * if shift { SHIFT_STEP } else { STEP };
        if self.collapsed(axis) && !self.forced && delta > 0.0 {
            if axis == Axis::Y {
                self.set_requested(Axis::Y, min);
            }
            self.set_collapsed(axis, false);
            self.retarget(axis);
            return (true, None);
        }
        let value = self.displayed(axis) + delta;
        if !self.forced && value < min - 5.0 {
            self.set_collapsed(axis, true);
        } else {
            self.set_collapsed(axis, false);
            self.set_requested(axis, value);
        }
        self.retarget(axis);
        (true, None)
    }

    fn start_keyboard(&mut self, axis: Axis) {
        if self.keyboard.is_none() {
            self.keyboard = Some(KeyAdjust {
                axis,
                requested: self.requested(axis),
                collapsed: self.collapsed(axis),
            });
        }
    }

    /// The splitter lost focus (`commitKeyboard`).
    /// Whether a keyboard resize of `axis` is pending (not yet saved or reverted).
    pub fn keyboard_pending(&self, axis: Axis) -> bool {
        self.keyboard.is_some_and(|k| k.axis == axis)
    }

    pub fn commit_keyboard(&mut self) -> Option<Publish> {
        let k = self.keyboard.take()?;
        Some(Publish {
            axis: k.axis,
            size: self.requested(k.axis),
            visible: !self.collapsed(k.axis),
        })
    }

    /// Esc on the splitter or a window blur: the values from before the keys come back.
    pub fn revert_keyboard(&mut self) {
        if let Some(k) = self.keyboard.take() {
            match k.axis {
                Axis::X => self.sidebar_width = k.requested,
                Axis::Y => self.bottom_height = k.requested,
            }
            self.set_collapsed(k.axis, k.collapsed);
            self.retarget(k.axis);
        }
    }

    /// "Ampliar Bottom" (`expand('bottom')`).
    pub fn expand_bottom(&mut self) -> Publish {
        let (_, max) = self.bounds(Axis::Y);
        self.bottom_height = max;
        self.bottom_collapsed = false;
        self.retarget_bottom();
        Publish {
            axis: Axis::Y,
            size: max,
            visible: true,
        }
    }

    pub fn can_peek(&self) -> bool {
        self.sidebar_hidden() && !self.block_peek && !self.peek
    }

    /// Opens the floating Sidebar. Every peek animates (owner decision in #73: the
    /// reference's instant first peek is an intentional difference).
    pub fn open_peek(&mut self) {
        if !self.sidebar_hidden() || self.peek {
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
    fn toggles_publish_and_edit_forces_both_regions() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        assert_eq!(
            r.toggle_sidebar(),
            Some(Publish {
                axis: Axis::X,
                size: 283.0,
                visible: false
            })
        );
        r.set_forced(true);
        assert_eq!(r.mode(), SidebarMode::Docked);
        assert_eq!(r.toggle_sidebar(), None, "the pin does nothing in Edit");
        r.set_forced(false);
        assert_eq!(
            r.mode(),
            SidebarMode::Hidden,
            "leaving Edit restores the state"
        );
    }

    #[test]
    fn sidebar_drag_collapses_and_reopens_only_at_the_minimum() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        r.begin_drag(Axis::X);
        r.drag_by(17.0);
        assert_eq!(r.sidebar_width, 300.0);
        r.drag_by(-160.0); // 123 < 180 − 48: collapses
        assert!(r.sidebar_collapsed);
        r.drag_by(-130.0); // 153: still below the minimum, stays collapsed
        assert!(r.sidebar_collapsed);
        r.drag_by(-100.0); // 183: reopens
        assert!(!r.sidebar_collapsed);
        let p = r.end_drag(200.0).unwrap();
        assert_eq!((p.axis, p.visible), (Axis::X, true));
        assert_eq!(p.size, 183.0);
    }

    #[test]
    fn bottom_reveals_from_zero_and_click_reopens_at_the_minimum() {
        let mut r = Regions::new(283.0, 200.0, false, true);
        r.begin_drag(Axis::Y);
        r.drag_by(60.0);
        assert_eq!(r.shown_bottom(), 60.0);
        assert!(!r.bottom_collapsed);
        let p = r.end_drag(60.0).unwrap();
        assert_eq!(
            p,
            Publish {
                axis: Axis::Y,
                size: 125.0,
                visible: true
            }
        );
        assert_eq!(r.shown_bottom(), 125.0);
        // Collapse by click, then a click reopens at 125.
        r.bottom_height = 220.0;
        r.begin_drag(Axis::Y);
        assert!(!r.end_drag(0.0).unwrap().visible);
        r.begin_drag(Axis::Y);
        assert_eq!(
            r.end_drag(1.0).unwrap(),
            Publish {
                axis: Axis::Y,
                size: 125.0,
                visible: true
            }
        );
    }

    #[test]
    fn escape_restores_a_drag_and_keyboard_adjustments() {
        let mut r = Regions::new(283.0, 167.0, false, false);
        r.begin_drag(Axis::X);
        r.drag_by(80.0);
        assert!(r.cancel_drag());
        assert_eq!(r.sidebar_width, 283.0);
        let (handled, publish) = r.key(Axis::X, "right", true);
        assert!(handled && publish.is_none());
        assert_eq!(r.sidebar_width, 323.0);
        r.key(Axis::X, "escape", false);
        assert_eq!(r.sidebar_width, 283.0);
        r.key(Axis::Y, "end", false);
        assert_eq!(r.bottom_height, 250.0);
        assert_eq!(
            r.commit_keyboard(),
            Some(Publish {
                axis: Axis::Y,
                size: 250.0,
                visible: true
            })
        );
        let (_, publish) = r.key(Axis::Y, "enter", false);
        assert_eq!(
            publish,
            Some(Publish {
                axis: Axis::Y,
                size: 250.0,
                visible: false
            })
        );
    }

    #[test]
    fn bounds_clamp_the_display_not_the_request() {
        let mut r = Regions::new(400.0, 240.0, false, false);
        r.set_bounds(300.0, 200.0);
        assert_eq!(r.shown_sidebar_width(), 300.0);
        assert_eq!(r.sidebar_width, 400.0);
        assert_eq!(r.shown_bottom(), 200.0);
        assert_eq!(r.expand_bottom().size, 200.0);
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
