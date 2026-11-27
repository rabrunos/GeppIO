//! Confirmed region chrome (`shared/workbench/chrome.ts`).
use crate::freeform::CodecError;
use crate::freeform::schema::reject;
use crate::json::{Json, ObjectWriter};
use crate::shell::{BOTTOM_LIMITS, Limits, SIDEBAR_LIMITS};

/// A region with chrome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChromeRegion {
    /// The docked Sidebar.
    Sidebar,
    /// The Bottom tray.
    Bottom,
}

impl ChromeRegion {
    /// Both regions in reference order.
    pub const ALL: [ChromeRegion; 2] = [ChromeRegion::Sidebar, ChromeRegion::Bottom];
    /// `'sidebar' | 'bottom'`.
    pub fn as_str(self) -> &'static str {
        match self {
            ChromeRegion::Sidebar => "sidebar",
            ChromeRegion::Bottom => "bottom",
        }
    }
    /// Accepted size limits (`CHROME_LIMITS`).
    pub fn limits(self) -> Limits {
        match self {
            ChromeRegion::Sidebar => SIDEBAR_LIMITS,
            ChromeRegion::Bottom => BOTTOM_LIMITS,
        }
    }
}

/// Visibility and size of one region.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RegionChrome {
    /// Whether the region is shown.
    pub visible: bool,
    /// Requested size in CSS pixels.
    pub size: f64,
    /// JSON key order: parsed documents write `size` first, the default writes `visible` first.
    pub size_first: bool,
}

/// Chrome of both regions.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorkbenchChrome {
    /// Sidebar.
    pub sidebar: RegionChrome,
    /// Bottom.
    pub bottom: RegionChrome,
}

impl WorkbenchChrome {
    /// The chrome of a region.
    pub fn get(&self, region: ChromeRegion) -> &RegionChrome {
        match region {
            ChromeRegion::Sidebar => &self.sidebar,
            ChromeRegion::Bottom => &self.bottom,
        }
    }
}

/// A partial chrome record (saved compositions).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChromePatchEntry {
    /// Size, when recorded.
    pub size: Option<f64>,
    /// Visibility, when recorded.
    pub visible: Option<bool>,
}

/// Partial chrome of both regions (`ChromePatch`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChromePatch {
    /// Sidebar part.
    pub sidebar: Option<ChromePatchEntry>,
    /// Bottom part.
    pub bottom: Option<ChromePatchEntry>,
}

/// The default chrome: both regions visible at their initial sizes.
pub fn default_chrome() -> WorkbenchChrome {
    WorkbenchChrome {
        sidebar: RegionChrome {
            visible: true,
            size: 283.0,
            size_first: false,
        },
        bottom: RegionChrome {
            visible: true,
            size: 167.0,
            size_first: false,
        },
    }
}

/// Validates chrome (`parseChrome`); `partial` allows missing regions and fields.
pub fn parse_chrome(value: Option<&Json>, partial: bool) -> Result<ChromePatch, CodecError> {
    let Some(source) = value.and_then(Json::as_object) else {
        return reject("Invalid region chrome");
    };
    if source.keys().any(|k| k != "sidebar" && k != "bottom") {
        return reject("Unknown chrome region");
    }
    let mut result = ChromePatch::default();
    for region in ChromeRegion::ALL {
        let item = source.get(region.as_str());
        if item.is_none() && partial {
            continue;
        }
        let Some(record) = item.and_then(Json::as_object) else {
            return reject("Invalid chrome region");
        };
        let visible = record.get("visible");
        let size = record.get("size");
        let limits = region.limits();
        if record.keys().any(|k| k != "visible" && k != "size")
            || record.is_empty()
            || (!partial && (visible.is_none() || size.is_none()))
            || visible.is_some_and(|v| v.as_bool().is_none())
            || size.is_some_and(|s| s.finite().is_none_or(|n| n < limits.min || n > limits.max))
        {
            return reject("Invalid chrome size/visibility");
        }
        let entry = ChromePatchEntry {
            size: size.and_then(Json::as_f64),
            visible: visible.and_then(Json::as_bool),
        };
        match region {
            ChromeRegion::Sidebar => result.sidebar = Some(entry),
            ChromeRegion::Bottom => result.bottom = Some(entry),
        }
    }
    Ok(result)
}

/// A complete chrome from a validated non-partial patch.
pub(crate) fn complete(patch: &ChromePatch) -> WorkbenchChrome {
    let full = |entry: Option<ChromePatchEntry>| {
        let entry = entry.expect("non-partial chrome has both regions");
        RegionChrome {
            visible: entry.visible.expect("non-partial visibility"),
            size: entry.size.expect("non-partial size"),
            size_first: true,
        }
    };
    WorkbenchChrome {
        sidebar: full(patch.sidebar),
        bottom: full(patch.bottom),
    }
}

/// Applies a patch over a chrome, keeping each record's key order (`applyChrome`).
pub fn apply_chrome(source: &WorkbenchChrome, patch: &ChromePatch) -> WorkbenchChrome {
    let merge = |base: RegionChrome, entry: Option<ChromePatchEntry>| match entry {
        Some(e) => RegionChrome {
            visible: e.visible.unwrap_or(base.visible),
            size: e.size.unwrap_or(base.size),
            size_first: base.size_first,
        },
        None => base,
    };
    WorkbenchChrome {
        sidebar: merge(source.sidebar, patch.sidebar),
        bottom: merge(source.bottom, patch.bottom),
    }
}

pub(crate) fn write_region_chrome(out: &mut String, chrome: &RegionChrome) {
    let mut w = ObjectWriter::new(out);
    if chrome.size_first {
        w.number("size", chrome.size)
            .bool("visible", chrome.visible);
    } else {
        w.bool("visible", chrome.visible)
            .number("size", chrome.size);
    }
    w.end();
}

pub(crate) fn write_chrome(out: &mut String, chrome: &WorkbenchChrome) {
    let mut w = ObjectWriter::new(out);
    w.raw("sidebar", |o| write_region_chrome(o, &chrome.sidebar));
    w.raw("bottom", |o| write_region_chrome(o, &chrome.bottom));
    w.end();
}

pub(crate) fn write_patch(out: &mut String, patch: &ChromePatch) {
    let entry = |o: &mut String, e: &ChromePatchEntry| {
        let mut w = ObjectWriter::new(o);
        if let Some(size) = e.size {
            w.number("size", size);
        }
        if let Some(visible) = e.visible {
            w.bool("visible", visible);
        }
        w.end();
    };
    let mut w = ObjectWriter::new(out);
    if let Some(e) = &patch.sidebar {
        w.raw("sidebar", |o| entry(o, e));
    }
    if let Some(e) = &patch.bottom {
        w.raw("bottom", |o| entry(o, e));
    }
    w.end();
}
