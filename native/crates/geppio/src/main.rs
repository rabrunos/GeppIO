//! GeppIO native host (Windows first). Composes GeppUI and the pure `geppio-core` model.
#![cfg_attr(not(test), windows_subsystem = "windows")]

mod automation;
mod options;
mod platform;
mod prefs;
mod regions;
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
    let options = Options::from_env(
        |key| std::env::var(key).ok(),
        &std::env::temp_dir(),
        options::canonical_dir,
    );
    let prefs = Prefs::load(options.profile.as_deref());
    let mut appearance = Appearance::new(options.theme.unwrap_or(prefs.theme()));
    appearance.zoom = options.zoom;
    appearance.reduced_motion = options
        .reduced_motion
        .unwrap_or_else(platform::reduced_motion);
    let (width, height) = options.size.unwrap_or((1480.0, 980.0));
    gpui_platform::application()
        .with_assets(Assets)
        .run(move |cx: &mut App| {
            geppui::init(cx, appearance.clone());
            let zoom = options.zoom;
            let bounds = Bounds {
                origin: point(px(40.0), px(20.0)),
                size: size(px(width * zoom), px(height * zoom)),
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
