//! Interruptible motion with CSS semantics.
//!
//! [`Transition`] reproduces CSS Transitions Level 1 retargeting as Chromium runs it: a new
//! target starts from the current interpolated value with the destination's duration and
//! easing, and sending a running transition back to its reversing-adjusted start shortens
//! the duration by the reversing factor (Stage A measured 340·e ms within 0.001 px).
//! Chromium applies a style change at the next frame, so [`Transition::request`] defers the
//! retarget until [`Transition::sample`] runs with that frame's timestamp.
//! [`Tween`] reproduces a WAAPI animation from an explicit start keyframe.

use crate::metrics::Rect;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CubicBezier {
    ax: f64,
    bx: f64,
    cx: f64,
    ay: f64,
    by: f64,
    cy: f64,
}

impl CubicBezier {
    pub const fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Self {
        let cx = 3.0 * x1;
        let bx = 3.0 * (x2 - x1) - cx;
        let ax = 1.0 - cx - bx;
        let cy = 3.0 * y1;
        let by = 3.0 * (y2 - y1) - cy;
        let ay = 1.0 - cy - by;
        Self {
            ax,
            bx,
            cx,
            ay,
            by,
            cy,
        }
    }
    fn sample_x(&self, t: f64) -> f64 {
        ((self.ax * t + self.bx) * t + self.cx) * t
    }
    fn sample_y(&self, t: f64) -> f64 {
        ((self.ay * t + self.by) * t + self.cy) * t
    }
    fn slope_x(&self, t: f64) -> f64 {
        (3.0 * self.ax * t + 2.0 * self.bx) * t + self.cx
    }
    /// Eased progress for linear progress `x` in [0, 1].
    pub fn ease(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        if x >= 1.0 {
            return 1.0;
        }
        let mut t = x;
        for _ in 0..8 {
            let error = self.sample_x(t) - x;
            if error.abs() < 1e-7 {
                return self.sample_y(t);
            }
            let slope = self.slope_x(t);
            if slope.abs() < 1e-6 {
                break;
            }
            t -= error / slope;
        }
        let (mut lo, mut hi) = (0.0, 1.0);
        t = x;
        while hi - lo > 1e-7 {
            let value = self.sample_x(t);
            if (value - x).abs() < 1e-7 {
                break;
            }
            if value < x {
                lo = t;
            } else {
                hi = t;
            }
            t = (lo + hi) / 2.0;
        }
        self.sample_y(t)
    }
}

/// `--region-easing`.
pub const REGION: CubicBezier = CubicBezier::new(0.22, 0.8, 0.24, 1.0);
/// Drag pickup, flights and FLIP.
pub const FLIGHT: CubicBezier = CubicBezier::new(0.2, 0.8, 0.2, 1.0);
/// CSS `ease`.
pub const EASE: CubicBezier = CubicBezier::new(0.25, 0.1, 0.25, 1.0);
/// CSS `ease-out`.
pub const EASE_OUT: CubicBezier = CubicBezier::new(0.0, 0.0, 0.58, 1.0);

/// Durations of the reference, in milliseconds.
pub mod duration {
    pub const REGION: f64 = 340.0;
    pub const SIDEBAR_HIDE: f64 = 120.0;
    pub const SIDEBAR_HIDE_FADE: f64 = 100.0;
    pub const PEEK_FADE: f64 = 200.0;
    pub const BACKDROP: f64 = 180.0;
    pub const OVERLAY_ENTER: f64 = 140.0;
    pub const ICON_HOVER: f64 = 140.0;
    pub const FLIGHT: f64 = 240.0;
    pub const PICKUP: f64 = 220.0;
    pub const SPLITTER: f64 = 150.0;
    pub const DROP_ZONE: f64 = 140.0;
}

/// Reduced motion as the reference implements it: CSS durations become 1 ms.
pub fn reduce(duration_ms: f64, reduced: bool) -> f64 {
    if reduced {
        duration_ms.min(1.0)
    } else {
        duration_ms
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Running {
    from: f64,
    to: f64,
    start_ms: f64,
    duration_ms: f64,
    reversing_start: f64,
    reversing_factor: f64,
    easing: CubicBezier,
}

impl Running {
    fn end(&self) -> f64 {
        self.start_ms + self.duration_ms
    }
    fn eased(&self, now: f64) -> f64 {
        self.easing
            .ease(((now - self.start_ms) / self.duration_ms).clamp(0.0, 1.0))
    }
    fn value(&self, now: f64) -> f64 {
        self.from + (self.to - self.from) * self.eased(now)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Pending {
    target: f64,
    duration_ms: f64,
    easing: CubicBezier,
}

/// One animatable CSS value.
#[derive(Clone, Debug, PartialEq)]
pub struct Transition {
    target: f64,
    running: Option<Running>,
    pending: Option<Pending>,
}

impl Transition {
    pub fn new(value: f64) -> Self {
        Self {
            target: value,
            running: None,
            pending: None,
        }
    }
    /// The value the property is heading to (including a not yet applied request).
    pub fn target(&self) -> f64 {
        self.pending.map_or(self.target, |p| p.target)
    }
    /// Jumps to `value` without a transition (like a style change with duration 0).
    pub fn jump(&mut self, value: f64) {
        *self = Self::new(value);
    }
    /// Queues a style change; it is applied at the next [`Self::sample`] (frame time).
    pub fn request(&mut self, target: f64, duration_ms: f64, easing: CubicBezier) {
        self.pending = Some(Pending {
            target,
            duration_ms,
            easing,
        });
    }
    /// Applies a pending change at frame time `now` and returns the current value.
    pub fn sample(&mut self, now: f64) -> f64 {
        if let Some(p) = self.pending.take() {
            self.set(now, p.target, p.duration_ms, p.easing);
        }
        if self.running.is_some_and(|r| now >= r.end()) {
            self.running = None;
        }
        self.value(now)
    }
    /// The value at `now` without applying pending changes.
    pub fn value(&self, now: f64) -> f64 {
        match self.running {
            Some(r) if now < r.end() => r.value(now),
            _ => self.target,
        }
    }
    pub fn animating(&self, now: f64) -> bool {
        self.pending.is_some() || self.running.is_some_and(|r| now < r.end())
    }
    /// Immediate style change at `now`.
    pub fn set(&mut self, now: f64, target: f64, duration_ms: f64, easing: CubicBezier) {
        if self.running.is_some_and(|r| now >= r.end()) {
            self.running = None;
        }
        if target == self.target {
            return;
        }
        let next = match self.running {
            Some(r) => {
                let e = r.eased(now);
                let current = r.from + (r.to - r.from) * e;
                if (target - r.reversing_start).abs() < 1e-9 {
                    let factor = (e * r.reversing_factor + 1.0 - r.reversing_factor).abs();
                    Some(Running {
                        from: current,
                        to: target,
                        start_ms: now,
                        duration_ms: duration_ms * factor,
                        reversing_start: r.to,
                        reversing_factor: factor,
                        easing,
                    })
                } else {
                    Some(Running {
                        from: current,
                        to: target,
                        start_ms: now,
                        duration_ms,
                        reversing_start: current,
                        reversing_factor: 1.0,
                        easing,
                    })
                }
            }
            None => Some(Running {
                from: self.target,
                to: target,
                start_ms: now,
                duration_ms,
                reversing_start: self.target,
                reversing_factor: 1.0,
                easing,
            }),
        };
        self.running = next.filter(|r| r.duration_ms > 0.0);
        self.target = target;
    }
    /// Remaining duration of the running transition (for tests and traces).
    pub fn running_duration(&self) -> Option<f64> {
        self.running.map(|r| r.duration_ms)
    }
}

/// WAAPI-like keyframe animation between two rectangles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tween {
    pub from: Rect,
    pub to: Rect,
    pub start_ms: f64,
    pub duration_ms: f64,
    pub easing: CubicBezier,
}

impl Tween {
    pub fn progress(&self, now: f64) -> f32 {
        if self.duration_ms <= 0.0 {
            return 1.0;
        }
        self.easing
            .ease(((now - self.start_ms) / self.duration_ms).clamp(0.0, 1.0)) as f32
    }
    pub fn at(&self, now: f64) -> Rect {
        Rect::lerp(self.from, self.to, self.progress(now))
    }
    pub fn done(&self, now: f64) -> bool {
        now >= self.start_ms + self.duration_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn easing_endpoints_and_midpoint() {
        assert_eq!(REGION.ease(0.0), 0.0);
        assert_eq!(REGION.ease(1.0), 1.0);
        // cubic-bezier(.25,.1,.25,1) at x=.5 is 0.8024 (Chromium/WebKit reference).
        assert!((EASE.ease(0.5) - 0.8024).abs() < 1e-3);
    }

    #[test]
    fn reversal_shortens_like_css() {
        let mut p = Transition::new(331.0);
        p.set(0.0, 48.0, 340.0, REGION);
        let e = REGION.ease(0.5);
        p.set(170.0, 331.0, 340.0, REGION);
        assert!((p.running_duration().unwrap() - 340.0 * e).abs() < 1e-6);
        assert!((p.value(170.0) - (331.0 + (48.0 - 331.0) * e)).abs() < 1e-6);
        // A second reversal back towards 48 uses the compounded factor.
        let mut q = p.clone();
        q.set(200.0, 48.0, 340.0, REGION);
        assert!(q.running_duration().unwrap() < 340.0);
        // Reaches rest at the shortened end.
        assert_eq!(p.sample(170.0 + 340.0 * e + 0.01), 331.0);
    }

    #[test]
    fn requests_apply_at_frame_time() {
        let mut p = Transition::new(0.0);
        p.request(10.0, 100.0, EASE);
        assert_eq!(p.target(), 10.0);
        assert!(p.animating(0.0));
        assert_eq!(p.sample(50.0), 0.0); // starts at the frame that applies it
        assert!((p.sample(100.0) - 10.0 * EASE.ease(0.5)).abs() < 1e-9);
        assert_eq!(p.sample(151.0), 10.0);
        assert!(!p.animating(151.0));
    }

    #[test]
    fn reduced_motion_is_one_millisecond() {
        assert_eq!(reduce(340.0, true), 1.0);
        assert_eq!(reduce(340.0, false), 340.0);
        let mut p = Transition::new(331.0);
        p.set(0.0, 48.0, reduce(340.0, true), REGION);
        assert_eq!(p.sample(1.0), 48.0);
    }

    #[test]
    fn tween_interpolates_rectangles() {
        let t = Tween {
            from: Rect::new(0.0, 0.0, 10.0, 10.0),
            to: Rect::new(10.0, 20.0, 30.0, 40.0),
            start_ms: 0.0,
            duration_ms: 240.0,
            easing: FLIGHT,
        };
        assert_eq!(t.at(0.0), t.from);
        assert_eq!(t.at(240.0), t.to);
        assert!(t.done(240.0));
    }
}
