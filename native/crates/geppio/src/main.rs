//! GeppIO native host (Windows first). Composes GeppUI and the pure `geppio-core` model.
#![cfg_attr(not(test), windows_subsystem = "windows")]

mod automation;
mod bars;
mod catalog;
mod compositions_view;
mod drag_layer;
mod edit;
mod edit_chrome;
mod edit_view;
mod i18n;
mod options;
mod pairs_view;
mod panels;
mod platform;
mod prefs;
mod presentations_view;
mod regions;
mod widgets;
mod workbench;

use std::borrow::Cow;

use geppui::{Appearance, GeppuiAssets};
use gpui::{
    App, AppContext, AssetSource, Bounds, SharedString, TitlebarOptions, WindowBounds,
    WindowOptions, point, px, size,
};

use crate::{options::Options, prefs::Prefs, workbench::Workbench};

/// GeppIO-owned artwork; GeppUI serves the shared icons.
struct Assets;

impl Assets {
    fn get(path: &str) -> Option<&'static [u8]> {
        match path {
            "avatar.png" => Some(include_bytes!("../assets/avatar.png")),
            "icons/workspace.svg" => Some(include_bytes!("../assets/icons/workspace.svg")),
            "icons/sidebar.svg" => Some(include_bytes!("../assets/icons/sidebar.svg")),
            "icons/empty-region.svg" => Some(include_bytes!("../assets/icons/empty-region.svg")),
            "icons/undo.svg" => Some(include_bytes!("../assets/icons/undo.svg")),
            "icons/redo.svg" => Some(include_bytes!("../assets/icons/redo.svg")),
            "icons/move.svg" => Some(include_bytes!("../assets/icons/move.svg")),
            "icons/git.svg" => Some(include_bytes!("../assets/icons/git.svg")),
            "icons/pin.svg" => Some(include_bytes!("../assets/icons/pin.svg")),
            "icons/star-filled.svg" => Some(include_bytes!("../assets/icons/star-filled.svg")),
            _ => GeppuiAssets::get(path),
        }
    }
}

impl AssetSource for Assets {
    fn load(&self, path: &str) -> gpui::Result<Option<Cow<'static, [u8]>>> {
        Ok(Self::get(path).map(Cow::Borrowed))
    }
    fn list(&self, path: &str) -> gpui::Result<Vec<SharedString>> {
        Ok(GeppuiAssets::list(path))
    }
}

fn main() {
    let mut options = Options::from_env(
        |key| std::env::var(key).ok(),
        &std::env::temp_dir(),
        options::canonical_dir,
    );
    options.demo_fixtures = options::demo_requested(std::env::args_os());
    let prefs = Prefs::load(options.profile.as_deref());
    let mut appearance = Appearance::new(options.theme.unwrap_or(prefs.theme()));
    // The emulated comparison zoom times the user's page zoom (View → Zoom).
    appearance.zoom = options.zoom * prefs.zoom_factor();
    appearance.reduced_motion = options
        .reduced_motion
        .unwrap_or_else(platform::reduced_motion);
    let (width, height) = options.size.unwrap_or((1480.0, 980.0));
    gpui_platform::application()
        .with_assets(Assets)
        .run(move |cx: &mut App| {
            geppui::init(cx, appearance.clone());
            let zoom = options.zoom;
            // Centred on the work area, as a BrowserWindow without a position; a window
            // larger than the work area starts at its top-left so the header stays on screen.
            let wanted = size(px(width * zoom), px(height * zoom));
            let bounds = match cx.primary_display() {
                Some(display) => {
                    let area = display.visible_bounds();
                    let x = area.origin.x + (area.size.width - wanted.width).max(px(0.0)) / 2.0;
                    let y = area.origin.y + (area.size.height - wanted.height).max(px(0.0)) / 2.0;
                    Bounds::new(point(x, y), wanted)
                }
                None => Bounds::centered(None, wanted, cx),
            };
            let window = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("GeppIO".into()),
                    appears_transparent: true,
                    traffic_light_position: None,
                }),
                window_min_size: Some(size(px(1000.0 * zoom), px(720.0 * zoom))),
                app_id: Some("geppio-native".into()),
                ..Default::default()
            };
            let options = options.clone();
            cx.open_window(window, move |window, cx| {
                cx.new(|cx| Workbench::new(&options, window, cx))
            })
            .expect("open the main window");
            cx.activate(true);
        });
}
