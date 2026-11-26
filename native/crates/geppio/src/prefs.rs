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
    pub sidebar_collapsed: bool,
    pub bottom_collapsed: bool,
    pub sidebar_width: f64,
    pub bottom_height: f64,
    /// The file on disk was not a readable v1 document; keep its bytes before replacing it.
    #[serde(skip)]
    pub unrecognized: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            version: 1,
            theme: "dark".into(),
            sidebar_collapsed: false,
            bottom_collapsed: false,
            sidebar_width: SIDEBAR_LIMITS.initial,
            bottom_height: BOTTOM_LIMITS.initial,
            unrecognized: false,
        }
    }
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
        self.sidebar_width = within(
            self.sidebar_width,
            SIDEBAR_LIMITS.min,
            SIDEBAR_LIMITS.max,
            SIDEBAR_LIMITS.initial,
        );
        self.bottom_height = within(
            self.bottom_height,
            BOTTOM_LIMITS.min,
            BOTTOM_LIMITS.max,
            BOTTOM_LIMITS.initial,
        );
        self.theme = self.theme().as_str().into();
        self
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
            std::fs::copy(
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
        let p = Prefs::parse(br#"{"version":1,"theme":"neon","sidebarWidth":9999,"bottomHeight":200,"sidebarCollapsed":true}"#);
        assert_eq!(
            (
                p.theme(),
                p.sidebar_width,
                p.bottom_height,
                p.sidebar_collapsed,
                p.unrecognized
            ),
            (ThemeName::Dark, 283.0, 200.0, true, false)
        );
    }

    #[test]
    fn round_trip_through_a_profile() {
        let dir = temp_profile("round");
        let mut prefs = Prefs {
            theme: "light".into(),
            bottom_collapsed: true,
            ..Prefs::default()
        };
        prefs.save(Some(&dir)).unwrap();
        assert_eq!(Prefs::load(Some(&dir)), prefs);
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
        prefs.sidebar_width = f64::NAN;
        prefs.bottom_height = f64::INFINITY;
        prefs.save(Some(&dir)).unwrap();
        let saved = Prefs::load(Some(&dir));
        assert_eq!(
            (saved.sidebar_width, saved.bottom_height, saved.unrecognized),
            (283.0, 167.0, false)
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
