//! Continuous geometry in CSS pixels (`f64`, never rounded early).

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub const fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
    pub fn right(&self) -> f64 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.right() && y < self.bottom()
    }
    /// Shrinks by `dx` on the left and right and `dy` on the top and bottom.
    pub fn inset(&self, dx: f64, dy: f64) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            w: (self.w - 2.0 * dx).max(0.0),
            h: (self.h - 2.0 * dy).max(0.0),
        }
    }
    pub fn intersects(&self, other: &Self) -> bool {
        self.x < other.right()
            && other.x < self.right()
            && self.y < other.bottom()
            && other.y < self.bottom()
    }
}

#[cfg(test)]
mod tests {
    use super::Rect;

    #[test]
    fn rect_basics() {
        let r = Rect::new(10.0, 20.0, 30.0, 40.0);
        assert_eq!((r.right(), r.bottom()), (40.0, 60.0));
        assert!(r.contains(10.0, 20.0) && !r.contains(40.0, 20.0));
        assert_eq!(r.inset(5.0, 5.0), Rect::new(15.0, 25.0, 20.0, 30.0));
        assert!(r.intersects(&Rect::new(39.0, 59.0, 5.0, 5.0)));
        assert!(!r.intersects(&Rect::new(40.0, 20.0, 5.0, 5.0)));
    }
}
