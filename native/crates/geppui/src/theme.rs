//! Design tokens for both themes. Values are the resolved literals of the Electron reference
//! (`src/geppui/styles/tokens.css` and the workbench palettes at 0.1.0-alpha.99). Both themes
//! define the same token names; switching a theme swaps the table in one frame.
use gpui::{Hsla, Rgba, rgb, rgba};

/// The two themes. Dark is the reference default.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Hash)]
pub enum ThemeName {
    Light,
    #[default]
    Dark,
}

impl ThemeName {
    pub fn toggled(self) -> Self {
        match self {
            Self::Light => Self::Dark,
            Self::Dark => Self::Light,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }
}

/// A CSS `box-shadow` in CSS pixels. [`crate::Metrics::shadow`] converts it for GPUI.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadow {
    pub x: f32,
    pub y: f32,
    pub blur: f32,
    pub spread: f32,
    pub color: Hsla,
}

/// Every colour a GeppUI primitive or a host screen reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Theme {
    pub name: ThemeName,
    pub canvas: Hsla,
    pub region: Hsla,
    pub workspace: Hsla,
    pub status_surface: Hsla,
    pub surface: Hsla,
    /// Surface of popovers, menus and dialogs (`--color-elevated` in dark).
    pub elevated: Hsla,
    pub text: Hsla,
    pub text_muted: Hsla,
    pub breadcrumb_muted: Hsla,
    pub border: Hsla,
    pub floating_border: Hsla,
    pub input: Hsla,
    pub input_border: Hsla,
    pub accent: Hsla,
    pub accent_soft: Hsla,
    pub accent_border: Hsla,
    pub success: Hsla,
    pub control_hover: Hsla,
    pub chrome_hover: Hsla,
    pub brand_soft_hover: Hsla,
    pub notification: Hsla,
    pub primary_foreground: Hsla,
    pub primary_border: Hsla,
    pub primary_hover: Hsla,
    pub destructive: Hsla,
    pub ring: Hsla,
    pub status_foreground: Hsla,
    pub scroll_thumb: Hsla,
    pub scroll_thumb_hover: Hsla,
    pub scroll_arrow: Hsla,
    pub scroll_arrow_hover: Hsla,
    pub scroll_arrow_disabled: Hsla,
    /// Chromium's Windows `scrollbar-width: thin` (widget contents): track and thumb.
    pub thin_track: Hsla,
    pub thin_thumb: Hsla,
    /// `color-mix(in srgb, accent 55%, input)` (demo chart bars).
    pub accent_muted: Hsla,
    pub peek_backdrop: Hsla,
    pub dialog_backdrop: Hsla,
    pub shadow_side: Shadow,
    pub shadow_popover: Shadow,
    pub shadow_dialog: Shadow,
    pub shadow_flight: Shadow,
}

fn hex(value: u32) -> Hsla {
    rgb(value).into()
}
fn hexa(value: u32) -> Hsla {
    rgba(value).into()
}
/// `color-mix(in srgb, a p, b)`, keeping fractional channels like Chromium.
pub fn mix(a: u32, b: u32, p: f32) -> Hsla {
    let a = rgb(a);
    let b = rgb(b);
    Rgba {
        r: a.r * p + b.r * (1.0 - p),
        g: a.g * p + b.g * (1.0 - p),
        b: a.b * p + b.b * (1.0 - p),
        a: 1.0,
    }
    .into()
}
fn text_alpha(text: u32, alpha: f32) -> Hsla {
    hex(text).opacity(alpha)
}

impl Theme {
    pub fn new(name: ThemeName) -> Self {
        match name {
            ThemeName::Light => Self::light(),
            ThemeName::Dark => Self::dark(),
        }
    }

    pub fn light() -> Self {
        let text = 0x132b4e;
        Self {
            name: ThemeName::Light,
            canvas: hex(0xfbf9f6),
            region: hex(0xfbf9f7),
            workspace: hex(0xfdfcfb),
            status_surface: hex(0xfefbf7),
            surface: hex(0xffffff),
            elevated: hex(0xffffff),
            text: hex(text),
            text_muted: hex(0x59718d),
            breadcrumb_muted: hex(0xa5afbd),
            border: hex(0xe8e4de),
            floating_border: mix(0xe8e4de, 0xfbf9f7, 0.7),
            input: hex(0xf5f7fa),
            input_border: hex(0xdfe5ed),
            accent: hex(0xf58a30),
            accent_soft: hex(0xfff0e4),
            accent_border: hex(0xf6d4ba),
            success: hex(0x1bb77e),
            control_hover: hex(0xf7f3eb),
            chrome_hover: hex(0xeceae6),
            brand_soft_hover: hex(0xffe8d4),
            notification: hex(0xee8c33),
            primary_foreground: hex(0xffffff),
            primary_border: hex(0xe68435),
            primary_hover: hex(0xe67720),
            destructive: hex(0xe81123),
            ring: hex(text),
            status_foreground: hex(0x526a87),
            scroll_thumb: text_alpha(text, 0.18),
            scroll_thumb_hover: text_alpha(text, 0.36),
            scroll_arrow: text_alpha(text, 0.14),
            scroll_arrow_hover: text_alpha(text, 0.36),
            scroll_arrow_disabled: text_alpha(text, 0.08),
            thin_track: hex(0xfcfcfc),
            thin_thumb: hex(0x8b8b8b),
            accent_muted: mix(0xf58a30, 0xf5f7fa, 0.55),
            peek_backdrop: hexa(0x0000000a),
            dialog_backdrop: hexa(0x00000024),
            shadow_side: Shadow {
                x: 10.,
                y: 0.,
                blur: 24.,
                spread: -9.,
                color: hexa(0x132b4e3d),
            },
            shadow_popover: Shadow {
                x: 0.,
                y: 12.,
                blur: 32.,
                spread: -10.,
                color: hexa(0x132b4e38),
            },
            shadow_dialog: Shadow {
                x: 0.,
                y: 18.,
                blur: 60.,
                spread: -18.,
                color: hexa(0x0000004d),
            },
            shadow_flight: Shadow {
                x: 0.,
                y: 18.,
                blur: 48.,
                spread: -14.,
                color: hexa(0x00000052),
            },
        }
    }

    pub fn dark() -> Self {
        let text = 0xf8f8f2;
        let popover = Shadow {
            x: 0.,
            y: 16.,
            blur: 44.,
            spread: -12.,
            color: hexa(0x000000a6),
        };
        Self {
            name: ThemeName::Dark,
            canvas: hex(0x12161e),
            region: hex(0x1a1f29),
            workspace: hex(0x141922),
            status_surface: hex(0x181d26),
            surface: hex(0x232a35),
            elevated: hex(0x2a323f),
            text: hex(text),
            text_muted: hex(0xacb7c9),
            breadcrumb_muted: hex(0x8997ae),
            border: hex(0x3c485b),
            floating_border: mix(0x3c485b, 0x1a1f29, 0.7),
            input: hex(0x1a202b),
            input_border: hex(0x5c6e89),
            accent: hex(0xf49a56),
            accent_soft: hex(0x382c27),
            accent_border: hex(0x775841),
            success: hex(0x65cba1),
            control_hover: hex(0x313c4d),
            chrome_hover: hex(0x303947),
            brand_soft_hover: hex(0x46332c),
            notification: hex(0xf49a56),
            primary_foreground: hex(0x161b23),
            primary_border: hex(0xd48750),
            primary_hover: hex(0xffad6c),
            destructive: hex(0xf38a96),
            ring: hex(0xa4bff0),
            status_foreground: hex(0xaab6c9),
            scroll_thumb: text_alpha(text, 0.18),
            scroll_thumb_hover: text_alpha(text, 0.36),
            scroll_arrow: text_alpha(text, 0.14),
            scroll_arrow_hover: text_alpha(text, 0.36),
            scroll_arrow_disabled: text_alpha(text, 0.08),
            thin_track: hex(0x2c2c2c),
            thin_thumb: hex(0x9f9f9f),
            accent_muted: mix(0xf49a56, 0x1a202b, 0.55),
            peek_backdrop: hexa(0x0000000a),
            dialog_backdrop: hexa(0x06090f7a),
            shadow_side: Shadow {
                x: 10.,
                y: 2.,
                blur: 30.,
                spread: -8.,
                color: hexa(0x00000099),
            },
            shadow_popover: popover,
            shadow_dialog: popover,
            shadow_flight: Shadow {
                x: 0.,
                y: 18.,
                blur: 48.,
                spread: -14.,
                color: hexa(0x00000052),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channels(color: Hsla) -> [f32; 3] {
        let rgba = color.to_rgb();
        [rgba.r * 255.0, rgba.g * 255.0, rgba.b * 255.0]
    }

    #[test]
    fn floating_border_keeps_fractional_channels() {
        // Inventory §1: rgb(237.7, 234.3, 229.5) light and rgb(49.8, 59.7, 76.0) dark.
        let light = channels(Theme::light().floating_border);
        let dark = channels(Theme::dark().floating_border);
        for (got, want) in light
            .iter()
            .zip([237.7, 234.3, 229.5])
            .chain(dark.iter().zip([49.8, 59.7, 76.0]))
        {
            assert!((got - want).abs() < 0.06, "{got} vs {want}");
        }
    }

    #[test]
    fn both_themes_differ_and_toggle() {
        assert_ne!(Theme::light(), Theme::dark());
        assert_eq!(ThemeName::Dark.toggled(), ThemeName::Light);
        assert_eq!(ThemeName::parse("light"), Some(ThemeName::Light));
        assert_eq!(ThemeName::parse("x"), None);
    }
}
