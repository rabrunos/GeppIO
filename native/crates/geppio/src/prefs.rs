//! Chrome preferences of the native host, in its own profile (`preferences.json`).
//!
//! - Unknown, corrupt, oversized or out-of-range data falls back to defaults.
//! - An unrecognized file is preserved as `preferences.unrecognized-<ms>.json` before the
//!   first write replaces it.
//! - Writes go to a freshly created, uniquely named temporary file that is flushed to disk and
//!   then renamed over the target, so links are never followed and a crash leaves either the
//!   old or the new file.
use std::{
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use geppio_core::shell::{BOTTOM_LIMITS, SIDEBAR_LIMITS};
use geppui::ThemeName;
use serde::{Deserialize, Serialize};

const FILE: &str = "preferences.json";
const MAX_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub version: u32,
    pub theme: String,
    /// Region state kept here up to alpha.104. It now lives in the layout document's
    /// `organization.chrome`: these fields are kept (and written back) only until the
    /// document has taken them or shown it has its own regions, then cleared for good.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar_collapsed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_collapsed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_height: Option<f64>,
    /// "auto", "pt-BR" or "en" (the reference's `geppio.locale`).
    pub locale: String,
    /// "Guia e encaixe no centro" (`geppio:snap-center:v1`, on by default).
    pub snap_center: bool,
    /// "Ativar expansão horizontal" (`geppio:layout:expansion:v1`, off by default).
    pub horizontal_expansion: bool,
    /// Display name of the layout (`geppio:project-name:v1`); empty shows "Laboratório".
    pub project_name: String,
    /// The file on disk was not a readable v1 document; keep its bytes before replacing it.
    #[serde(skip)]
    pub unrecognized: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            version: 1,
            theme: "dark".into(),
            sidebar_collapsed: None,
            bottom_collapsed: None,
            sidebar_width: None,
            bottom_height: None,
            locale: "auto".into(),
            snap_center: true,
            horizontal_expansion: false,
            project_name: String::new(),
            unrecognized: false,
        }
    }
}

/// Characters a displayed name never carries: controls, bidi embeddings/overrides/isolates,
/// zero-width and invisible format characters, and line/paragraph separators (they would
/// let a name spoof the text around it).
pub fn hidden_char(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{FEFF}'
        )
}

/// A layout name as the reference accepts it: trimmed, non-empty, at most 60 UTF-16 units
/// (`ProjectMenu.tsx` `rename`), without hidden characters.
pub fn valid_name(value: &str) -> Option<String> {
    let name = value.trim();
    (!name.is_empty() && name.encode_utf16().count() <= 60 && !name.chars().any(hidden_char))
        .then(|| name.to_owned())
}

fn within(value: f64, min: f64, max: f64, initial: f64) -> f64 {
    if value.is_finite() && (min..=max).contains(&value) {
        value
    } else {
        initial
    }
}

impl Prefs {
    pub fn theme(&self) -> ThemeName {
        ThemeName::parse(&self.theme).unwrap_or_default()
    }
    fn sanitized(mut self) -> Self {
        self.sidebar_width = self.sidebar_width.map(|w| {
            within(
                w,
                SIDEBAR_LIMITS.min,
                SIDEBAR_LIMITS.max,
                SIDEBAR_LIMITS.initial,
            )
        });
        self.bottom_height = self.bottom_height.map(|h| {
            within(
                h,
                BOTTOM_LIMITS.min,
                BOTTOM_LIMITS.max,
                BOTTOM_LIMITS.initial,
            )
        });
        self.theme = self.theme().as_str().into();
        if crate::i18n::Preference::parse(&self.locale).is_none() {
            self.locale = "auto".into();
        }
        self.project_name = valid_name(&self.project_name).unwrap_or_default();
        self
    }
    pub fn locale(&self) -> crate::i18n::Preference {
        crate::i18n::Preference::parse(&self.locale).unwrap_or_default()
    }
    pub fn parse(bytes: &[u8]) -> Self {
        match serde_json::from_slice::<Prefs>(bytes) {
            Ok(p) if p.version == 1 => p.sanitized(),
            _ => Self {
                unrecognized: true,
                ..Self::default()
            },
        }
    }
    /// The region chrome an older host kept here (alpha.100–104).
    /// The region state an older host left here, if any field remains.
    pub fn legacy_chrome(&self) -> Option<geppio_core::workbench::WorkbenchChrome> {
        if self.sidebar_collapsed.is_none()
            && self.bottom_collapsed.is_none()
            && self.sidebar_width.is_none()
            && self.bottom_height.is_none()
        {
            return None;
        }
        let mut chrome = geppio_core::workbench::default_chrome();
        chrome.sidebar.visible = !self.sidebar_collapsed.unwrap_or(false);
        chrome.sidebar.size = self.sidebar_width.unwrap_or(SIDEBAR_LIMITS.initial);
        chrome.bottom.visible = !self.bottom_collapsed.unwrap_or(false);
        chrome.bottom.size = self.bottom_height.unwrap_or(BOTTOM_LIMITS.initial);
        Some(chrome)
    }

    /// Drops the old region fields once the layout document settled them.
    pub fn clear_legacy(&mut self) {
        self.sidebar_collapsed = None;
        self.bottom_collapsed = None;
        self.sidebar_width = None;
        self.bottom_height = None;
    }

    pub fn load(profile: Option<&Path>) -> Self {
        let Some(path) = profile.map(|p| p.join(FILE)) else {
            return Self::default();
        };
        let Ok(file) = std::fs::File::open(&path) else {
            return Self::default();
        };
        let mut bytes = Vec::new();
        if file.take(MAX_BYTES + 1).read_to_end(&mut bytes).is_err()
            || bytes.len() as u64 > MAX_BYTES
        {
            return Self {
                unrecognized: true,
                ..Self::default()
            };
        }
        Self::parse(&bytes)
    }
    pub fn save(&mut self, profile: Option<&PathBuf>) -> std::io::Result<()> {
        let Some(dir) = profile else { return Ok(()) };
        std::fs::create_dir_all(dir)?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let target = dir.join(FILE);
        if self.unrecognized && target.exists() {
            // Moved aside, not copied: the whole file is kept without being read, whatever its
            // size, and a link is moved rather than followed.
            std::fs::rename(
                &target,
                dir.join(format!("preferences.unrecognized-{stamp}.json")),
            )?;
        }
        self.unrecognized = false;
        let clean = self.clone().sanitized();
        let bytes = serde_json::to_vec_pretty(&clean).map_err(std::io::Error::other)?;
        let temp = dir.join(format!("{FILE}.{}-{stamp}.tmp", std::process::id()));
        let written = (|| {
            let mut file = std::fs::File::options()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temp, &target)
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        written
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_profile(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "geppio-native-test-prefs-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn invalid_values_fall_back() {
        assert!(Prefs::parse(b"not json").unrecognized);
        assert_eq!(
            Prefs::parse(br#"{"version":2,"theme":"light"}"#).theme(),
            ThemeName::Dark
        );
        let named = Prefs::parse(
            r#"{"version":1,"locale":"fr","projectName":"  Estúdio  ","snapCenter":false}"#
                .as_bytes(),
        );
        assert_eq!(
            (
                named.locale.as_str(),
                named.project_name.as_str(),
                named.snap_center
            ),
            ("auto", "Estúdio", false)
        );
        assert_eq!(valid_name("a\u{202E}b"), None);
        assert_eq!(valid_name(" Estúdio "), Some("Estúdio".into()));
        let long = format!(r#"{{"version":1,"projectName":"{}"}}"#, "x".repeat(61));
        assert_eq!(Prefs::parse(long.as_bytes()).project_name, "");
        let p = Prefs::parse(br#"{"version":1,"theme":"neon","sidebarWidth":9999,"bottomHeight":200,"sidebarCollapsed":true}"#);
        assert_eq!(
            (
                p.theme(),
                p.sidebar_width,
                p.bottom_height,
                p.sidebar_collapsed,
                p.unrecognized
            ),
            (ThemeName::Dark, Some(283.0), Some(200.0), Some(true), false)
        );
        let chrome = p.legacy_chrome().unwrap();
        assert_eq!(
            (
                chrome.sidebar.visible,
                chrome.sidebar.size,
                chrome.bottom.size
            ),
            (false, 283.0, 200.0)
        );
        assert_eq!(Prefs::parse(br#"{"version":1}"#).legacy_chrome(), None);
    }

    #[test]
    fn round_trip_through_a_profile() {
        let dir = temp_profile("round");
        let mut prefs = Prefs {
            theme: "light".into(),
            bottom_collapsed: Some(true),
            ..Prefs::default()
        };
        prefs.save(Some(&dir)).unwrap();
        let mut loaded = Prefs::load(Some(&dir));
        assert_eq!(loaded.theme, "light");
        // Old region state survives other writes until the layout document settles it...
        assert_eq!(loaded.bottom_collapsed, Some(true));
        // ...then it is cleared for good.
        loaded.clear_legacy();
        loaded.save(Some(&dir)).unwrap();
        assert_eq!(Prefs::load(Some(&dir)).legacy_chrome(), None);
        assert!(
            !std::fs::read_to_string(dir.join(FILE))
                .unwrap()
                .contains("bottomCollapsed")
        );
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(Prefs::load(None), Prefs::default());
    }

    #[test]
    fn non_finite_values_are_never_written_and_foreign_files_are_kept() {
        let dir = temp_profile("foreign");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), br#"{"version":7,"future":true}"#).unwrap();
        let mut prefs = Prefs::load(Some(&dir));
        assert!(prefs.unrecognized);
        prefs.sidebar_width = Some(f64::NAN);
        prefs.bottom_height = Some(f64::INFINITY);
        prefs.save(Some(&dir)).unwrap();
        let saved = Prefs::load(Some(&dir));
        assert_eq!(
            (saved.sidebar_width, saved.bottom_height, saved.unrecognized),
            (Some(283.0), Some(167.0), false)
        );
        let kept: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("preferences.unrecognized-")
            })
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(
            std::fs::read(kept[0].path()).unwrap(),
            br#"{"version":7,"future":true}"#
        );
        std::fs::write(dir.join(FILE), vec![b' '; (MAX_BYTES + 10) as usize]).unwrap();
        assert!(Prefs::load(Some(&dir)).unrecognized);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
