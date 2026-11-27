//! Shell geometry of the workbench, derived each frame from the viewport and the animated
//! region tracks, as the reference derives it from `--sidebar-track` and `--bottom-track`
//! (inventory §2, §5, §7–§13). Every value is in CSS pixels.
use crate::geometry::Rect;

pub const HEADER: f64 = 46.0;
pub const CONTEXT: f64 = 50.0;
pub const STATUS: f64 = 25.0;
pub const RAIL: f64 = 48.0;
pub const SPACE_X: f64 = 11.0;
pub const SPACE_Y: f64 = 9.0;
pub const FLOATING_WIDTH: f64 = 238.0;
pub const FLOATING_GAP: f64 = 11.0;
pub const SIDEBAR_INSET: f64 = 15.0;
pub const WORKSPACE_RADIUS: f64 = 22.0;
pub const BOTTOM_RADIUS: f64 = 17.0;

/// Accepted region size limits (`shared/workbench/chrome.ts`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    pub min: f64,
    pub max: f64,
    pub initial: f64,
}

pub const SIDEBAR_LIMITS: Limits = Limits {
    min: 180.0,
    max: 430.0,
    initial: 283.0,
};
pub const BOTTOM_LIMITS: Limits = Limits {
    min: 125.0,
    max: 250.0,
    initial: 167.0,
};

/// The Sidebar maximum also leaves 160px for Main (`region-policy.ts`).
pub fn sidebar_max(area_width: f64) -> f64 {
    SIDEBAR_LIMITS
        .max
        .min(area_width - RAIL - 160.0)
        .max(SIDEBAR_LIMITS.min)
}

/// Requested region sizes and the current animated tracks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tracks {
    /// `48 + sidebar width` when docked, `48` when hidden (animated).
    pub sidebar: f64,
    /// Bottom height when docked, `0` when hidden (animated).
    pub bottom: f64,
    /// Requested Sidebar content width (`--sidebar-width`), fixed while the track animates.
    pub sidebar_width: f64,
    /// Requested Bottom height (`--bottom-height`).
    pub bottom_height: f64,
    /// Widget catalog column (`--catalog-track`, 0↔480 while editing).
    pub catalog: f64,
}

impl Default for Tracks {
    fn default() -> Self {
        Self {
            sidebar: RAIL + SIDEBAR_LIMITS.initial,
            bottom: BOTTOM_LIMITS.initial,
            sidebar_width: SIDEBAR_LIMITS.initial,
            bottom_height: BOTTOM_LIMITS.initial,
            catalog: 0.0,
        }
    }
}

/// Every rectangle of the shell for one frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShellLayout {
    pub viewport: Rect,
    pub header: Rect,
    pub context: Rect,
    pub status: Rect,
    /// Window area between the header and the status bar (`.work-area` plus the context row).
    pub work: Rect,
    pub rail: Rect,
    /// Clip box of the docked Sidebar (`.host-sidebar-content`), width follows the track.
    pub sidebar_clip: Rect,
    /// Fixed-width Sidebar viewport (content does not reflow while the track animates).
    pub sidebar_viewport: Rect,
    /// Workspace surface whose 22px top-left corner is the concave join.
    pub workspace: Rect,
    /// Context row to the right of the track (project title and actions).
    pub project: Rect,
    /// Main region and its port (inside 9/11px padding).
    pub main: Rect,
    pub main_port: Rect,
    /// Clip box of the Bottom region (height = track) and the fixed-height tray inside it.
    pub bottom_clip: Rect,
    pub bottom_surface: Rect,
    /// Floating Sidebar panel and the peek backdrop (1px inside the outline).
    pub floating: Rect,
    pub backdrop: Rect,
    /// The catalog column at the right of Main and Bottom (width = catalog track).
    pub catalog: Rect,
}

impl ShellLayout {
    pub fn compute(width: f64, height: f64, tracks: Tracks) -> Self {
        let track = tracks.sidebar.max(RAIL);
        let work_top = HEADER + CONTEXT;
        let work_bottom = height - STATUS;
        let bottom_track = tracks.bottom.max(0.0);
        let catalog = tracks.catalog.clamp(0.0, width);
        let main = Rect::new(
            track,
            work_top,
            (width - track - catalog).max(0.0),
            (work_bottom - bottom_track - work_top).max(0.0),
        );
        let bottom_clip = Rect::new(
            track + SPACE_X,
            work_bottom - bottom_track,
            (width - track - catalog - 2.0 * SPACE_X).max(0.0),
            bottom_track,
        );
        let floating_top = HEADER + SPACE_Y;
        Self {
            viewport: Rect::new(0.0, 0.0, width, height),
            header: Rect::new(0.0, 0.0, width, HEADER),
            context: Rect::new(0.0, HEADER, width, CONTEXT),
            status: Rect::new(0.0, work_bottom, width, STATUS),
            work: Rect::new(0.0, HEADER, width, (work_bottom - HEADER).max(0.0)),
            rail: Rect::new(0.0, HEADER, RAIL, (work_bottom - HEADER).max(0.0)),
            sidebar_clip: Rect::new(
                RAIL,
                HEADER,
                (track - RAIL).max(0.0),
                (work_bottom - HEADER).max(0.0),
            ),
            sidebar_viewport: Rect::new(
                RAIL,
                HEADER,
                tracks.sidebar_width,
                (work_bottom - HEADER).max(0.0),
            ),
            workspace: Rect::new(
                track,
                HEADER,
                (width - track).max(0.0),
                (work_bottom - HEADER).max(0.0),
            ),
            project: Rect::new(track, HEADER, (width - track).max(0.0), CONTEXT),
            main,
            main_port: main.inset(SPACE_X, SPACE_Y),
            bottom_clip,
            // The tray keeps its height and is anchored to the clip's top: it slides down.
            bottom_surface: Rect::new(
                bottom_clip.x,
                bottom_clip.y,
                bottom_clip.w,
                tracks.bottom_height,
            ),
            floating: Rect::new(
                RAIL + FLOATING_GAP,
                floating_top,
                FLOATING_WIDTH.min(width - RAIL - FLOATING_GAP),
                (work_bottom - SPACE_Y - floating_top).max(0.0),
            ),
            backdrop: Rect::new(
                track + 1.0,
                HEADER + 1.0,
                (width - track - 1.0).max(0.0),
                (work_bottom - HEADER - 1.0).max(0.0),
            ),
            catalog: Rect::new(
                width - catalog,
                work_top,
                catalog,
                (work_bottom - work_top).max(0.0),
            ),
        }
    }
}

/// Responsive rules of the reference at a given window width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Responsive {
    /// `max-width: 1350px`: greeting text and the explorer button label are hidden.
    pub compact_header: bool,
    /// `max-width: 1100px`: branch info, version and 12px breadcrumbs.
    pub narrow: bool,
}

impl Responsive {
    pub fn at(width: f64) -> Self {
        Self {
            compact_header: width <= 1350.0,
            narrow: width <= 1100.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_window_matches_inventory_coordinates() {
        // Inventory §2 at 1480×980, Sidebar 283, Bottom 167.
        let s = ShellLayout::compute(1480.0, 980.0, Tracks::default());
        assert_eq!(s.main, Rect::new(331.0, 96.0, 1149.0, 692.0));
        assert_eq!(s.bottom_clip.y, 788.0);
        assert_eq!(s.status, Rect::new(0.0, 955.0, 1480.0, 25.0));
        assert_eq!(s.sidebar_clip.w, 283.0);
        assert_eq!(s.workspace.x, 331.0);
    }

    #[test]
    fn collapsed_track_moves_every_dependent() {
        let tracks = Tracks {
            sidebar: RAIL,
            bottom: 0.0,
            ..Tracks::default()
        };
        let s = ShellLayout::compute(1280.0, 800.0, tracks);
        assert_eq!(s.sidebar_clip.w, 0.0);
        assert_eq!(s.sidebar_viewport.w, 283.0);
        assert_eq!(s.main, Rect::new(48.0, 96.0, 1232.0, 679.0));
        assert_eq!(s.bottom_surface.h, 167.0);
        assert_eq!(s.floating, Rect::new(59.0, 55.0, 238.0, 711.0));
        assert_eq!(s.backdrop.x, 49.0);
    }

    #[test]
    fn catalog_track_narrows_main_and_bottom() {
        let tracks = Tracks {
            catalog: 480.0,
            ..Tracks::default()
        };
        let s = ShellLayout::compute(1280.0, 800.0, tracks);
        assert_eq!(s.main, Rect::new(331.0, 96.0, 469.0, 512.0));
        assert_eq!(s.bottom_clip.w, 469.0 - 22.0);
        assert_eq!(s.catalog, Rect::new(800.0, 96.0, 480.0, 679.0));
    }

    #[test]
    fn limits_and_responsive_rules() {
        assert_eq!(sidebar_max(1280.0), 430.0);
        assert_eq!(sidebar_max(500.0), 292.0);
        assert_eq!(
            Responsive::at(1280.0),
            Responsive {
                compact_header: true,
                narrow: false
            }
        );
        assert_eq!(
            Responsive::at(1480.0),
            Responsive {
                compact_header: false,
                narrow: false
            }
        );
        assert!(Responsive::at(1000.0).narrow);
    }
}
