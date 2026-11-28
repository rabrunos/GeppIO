//! Launch options. Normal use reads none of the `GEPPIO_NATIVE_TEST_*` hooks: they take
//! effect only together with a valid `GEPPIO_NATIVE_TEST_PROFILE`, an existing directory
//! named `geppio-native-test-*` directly under the system temp folder, confirmed on disk
//! after resolving links, junctions and short names. A present but rejected test profile
//! disables persistence instead of falling back to the owner's profile.
use std::path::{Component, Path, PathBuf};

use geppui::ThemeName;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Options {
    /// Data directory (preferences). `None` disables persistence.
    pub profile: Option<PathBuf>,
    pub theme: Option<ThemeName>,
    /// Emulated zoom for 125% comparisons on a 100% display.
    pub zoom: f32,
    pub reduced_motion: Option<bool>,
    /// Content size in CSS pixels.
    pub size: Option<(f32, f32)>,
    pub start: Start,
    /// A motion state frozen at a fraction of its duration, for stills.
    pub freeze: Option<(Freeze, f64)>,
    /// Scripted input scenario for traces.
    pub script: Option<Script>,
    /// JSON-lines trace file (inside the test profile).
    pub trace: Option<PathBuf>,
    /// `--geppio-demo-fixtures`: the demonstration widgets. Without it the first run is
    /// empty and stored demo widgets are retired, as in the reference, which keeps the demos
    /// for its test profiles only.
    pub demo_fixtures: bool,
}

/// Whether the command line asks for the demonstration widgets (`--geppio-demo-fixtures`).
/// Raw OS arguments: a non-Unicode argument never panics and simply does not match.
pub fn demo_requested(args: impl IntoIterator<Item = std::ffi::OsString>) -> bool {
    args.into_iter()
        .skip(1)
        .any(|a| a == "--geppio-demo-fixtures")
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Start {
    #[default]
    Docked,
    Collapsed,
    Peek,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Freeze {
    Collapse,
    Expand,
    Peek,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Script {
    CollapseFull,
    CollapseInterrupt,
    Peek,
    PeekInterrupt,
    Bottom,
    Theme,
}

impl Script {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "collapse-full" => Self::CollapseFull,
            "collapse-interrupt" => Self::CollapseInterrupt,
            "peek" => Self::Peek,
            "peek-interrupt" => Self::PeekInterrupt,
            "bottom" => Self::Bottom,
            "theme" => Self::Theme,
            _ => return None,
        })
    }
}

fn parse_freeze(value: &str) -> Option<(Freeze, f64)> {
    let (state, fraction) = value.split_once('@')?;
    let fraction: f64 = fraction
        .parse()
        .ok()
        .filter(|f: &f64| (0.0..=1.0).contains(f))?;
    let state = match state {
        "collapse" => Freeze::Collapse,
        "expand" => Freeze::Expand,
        "peek" => Freeze::Peek,
        "bottom" => Freeze::Bottom,
        _ => return None,
    };
    Some((state, fraction))
}

/// The owner's native profile: `%APPDATA%\geppio-native`, never Electron's `geppio`.
pub fn default_profile(app_data: Option<&Path>) -> Option<PathBuf> {
    app_data
        .filter(|p| p.is_absolute())
        .map(|base| base.join("geppio-native"))
}

/// The owner profile, refused when an existing `geppio-native` is not a plain directory
/// (`canonical` rejects links and junctions) or resolves inside Electron's
/// `%APPDATA%\geppio`, so the native host can never write the Electron folder. A missing
/// folder is created later as a plain directory.
pub fn owner_profile(
    app_data: Option<&Path>,
    exists: impl Fn(&Path) -> bool,
    canonical: impl Fn(&Path) -> Option<PathBuf>,
) -> Option<PathBuf> {
    let profile = default_profile(app_data)?;
    if !exists(&profile) {
        return Some(profile);
    }
    let resolved = canonical(&profile)?;
    let electron = app_data.and_then(|base| canonical(&base.join("geppio")));
    (!electron.is_some_and(|electron| within(&resolved, &electron))).then_some(profile)
}

fn same_component(a: &std::ffi::OsStr, b: &std::ffi::OsStr) -> bool {
    match (a.to_str(), b.to_str()) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => a == b,
    }
}

/// `path` equals `base` or lies under it, per component and without regard to ASCII case.
fn within(path: &Path, base: &Path) -> bool {
    let (path, base): (Vec<_>, Vec<_>) = (path.components().collect(), base.components().collect());
    path.len() >= base.len()
        && path
            .iter()
            .zip(&base)
            .all(|(a, b)| same_component(a.as_os_str(), b.as_os_str()))
}

/// `value` is exactly `<temp>\geppio-native-test-<[A-Za-z0-9_-]+>`, compared per component
/// without regard to ASCII case, with no `.`/`..` components.
pub fn lexically_valid(value: &Path, temp: &Path) -> bool {
    if !value.is_absolute()
        || value
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return false;
    }
    let (value, temp): (Vec<_>, Vec<_>) =
        (value.components().collect(), temp.components().collect());
    if value.len() != temp.len() + 1
        || !value
            .iter()
            .zip(&temp)
            .all(|(a, b)| same_component(a.as_os_str(), b.as_os_str()))
    {
        return false;
    }
    value
        .last()
        .and_then(|c| c.as_os_str().to_str())
        .and_then(|name| {
            name.get(..19)
                .filter(|p| p.eq_ignore_ascii_case("geppio-native-test-"))
                .map(|_| &name[19..])
        })
        .is_some_and(|tail| {
            !tail.is_empty()
                && tail.len() <= 64
                && tail
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
}

/// Lexical rule plus the same rule on the resolved paths: a junction, symbolic link or
/// redirected temp component makes the canonical paths disagree and the profile is rejected.
pub fn validated_test_profile(
    value: &Path,
    temp: &Path,
    canonical: &impl Fn(&Path) -> Option<PathBuf>,
) -> Option<PathBuf> {
    if !lexically_valid(value, temp) {
        return None;
    }
    let (resolved, resolved_temp) = (canonical(value)?, canonical(temp)?);
    lexically_valid(&resolved, &resolved_temp).then(|| value.to_path_buf())
}

/// Resolves an existing, non-link directory.
pub fn canonical_dir(path: &Path) -> Option<PathBuf> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

fn trace_name(value: &str) -> Option<&str> {
    let stem = value.strip_suffix(".jsonl")?;
    let upper = stem.to_ascii_uppercase();
    let device = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT")) && upper.len() == 4);
    if device {
        return None;
    }
    (!stem.is_empty()
        && stem.len() <= 64
        && stem
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    .then_some(value)
}

impl Options {
    pub fn from_env(
        get: impl Fn(&str) -> Option<String>,
        temp: &Path,
        canonical: impl Fn(&Path) -> Option<PathBuf>,
    ) -> Self {
        let owner = owner_profile(
            get("APPDATA").as_deref().map(Path::new),
            |p| std::fs::symlink_metadata(p).is_ok(),
            &canonical,
        );
        let Some(requested) = get("GEPPIO_NATIVE_TEST_PROFILE") else {
            return Self {
                profile: owner,
                zoom: 1.0,
                ..Self::default()
            };
        };
        // A redirected TMP/TEMP must not place a test profile inside the roaming profiles
        // (Electron's `geppio` or the owner's `geppio-native`).
        let app_data = get("APPDATA").and_then(|a| canonical(Path::new(&a)));
        let inside_app_data = |p: &Path| app_data.as_ref().is_some_and(|app| within(p, app));
        let checked = validated_test_profile(Path::new(&requested), temp, &canonical)
            .filter(|p| canonical(p).is_some_and(|resolved| !inside_app_data(&resolved)));
        let Some(test_profile) = checked else {
            // Never fall back to the owner's data when a test asked for isolation.
            return Self {
                profile: None,
                zoom: 1.0,
                ..Self::default()
            };
        };
        let size = get("GEPPIO_NATIVE_TEST_SIZE").and_then(|v| {
            let (w, h) = v.split_once('x')?;
            let (w, h): (f32, f32) = (w.parse().ok()?, h.parse().ok()?);
            let ok = |v: f32| v.is_finite() && (320.0..=8192.0).contains(&v);
            (ok(w) && ok(h)).then_some((w, h))
        });
        Self {
            theme: get("GEPPIO_NATIVE_TEST_THEME")
                .as_deref()
                .and_then(ThemeName::parse),
            zoom: get("GEPPIO_NATIVE_TEST_ZOOM")
                .and_then(|v| v.parse().ok())
                .filter(|z: &f32| (0.5..=3.0).contains(z))
                .unwrap_or(1.0),
            reduced_motion: get("GEPPIO_NATIVE_TEST_REDUCED_MOTION").map(|v| v == "1"),
            size,
            start: match get("GEPPIO_NATIVE_TEST_START").as_deref() {
                Some("collapsed") => Start::Collapsed,
                Some("peek") => Start::Peek,
                _ => Start::Docked,
            },
            freeze: get("GEPPIO_NATIVE_TEST_FREEZE")
                .as_deref()
                .and_then(parse_freeze),
            script: get("GEPPIO_NATIVE_TEST_SCRIPT")
                .as_deref()
                .and_then(Script::parse),
            trace: get("GEPPIO_NATIVE_TEST_TRACE")
                .as_deref()
                .and_then(trace_name)
                .map(|name| test_profile.join(name)),
            profile: Some(test_profile),
            demo_fixtures: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_fixtures_need_the_exact_argument() {
        let args = |list: &[&str]| {
            list.iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        };
        assert!(!demo_requested(args(&["geppio.exe"])));
        assert!(demo_requested(args(&[
            "geppio.exe",
            "--geppio-demo-fixtures"
        ])));
        // The program name never counts, and near misses are ignored.
        assert!(!demo_requested(args(&["--geppio-demo-fixtures"])));
        assert!(!demo_requested(args(&[
            "geppio.exe",
            "--geppio-demo-fixtures=1"
        ])));
        assert!(!demo_requested(args(&[
            "geppio.exe",
            "--GEPPIO-DEMO-FIXTURES"
        ])));
    }

    fn identity(p: &Path) -> Option<PathBuf> {
        Some(p.to_path_buf())
    }

    #[test]
    fn test_profiles_are_confined_to_temp() {
        let temp = Path::new(r"C:\Temp");
        let ok = |v: &str| validated_test_profile(Path::new(v), temp, &identity).is_some();
        assert!(ok(r"C:\Temp\geppio-native-test-abc"));
        assert!(
            ok(r"c:\temp\GEPPIO-NATIVE-TEST-abc"),
            "case-insensitive like the file system"
        );
        assert!(
            !ok(r"C:\Temp\geppio-native-test-abc\data"),
            "only the directory itself"
        );
        assert!(!ok(r"C:\Temp\geppio-native-test-"));
        assert!(!ok(r"C:\Temp\geppio-native-test-a.b"));
        assert!(
            !ok(r"C:\Temp2\geppio-native-test-abc"),
            "prefix of another path"
        );
        assert!(!ok(r"C:\Temp\geppio-smoke-abc"));
        assert!(!ok(r"C:\Temp\geppio-native-test-a\..\..\x"));
        assert!(!ok(r"C:\Users\x\AppData\Roaming\geppio"));
        assert!(!ok("relative"));
    }

    #[test]
    fn a_resolved_path_outside_temp_is_rejected() {
        let temp = Path::new(r"C:\Temp");
        // A junction at the test directory resolves into the Electron profile.
        let junction = |p: &Path| {
            Some(if p.ends_with("geppio-native-test-j") {
                PathBuf::from(r"C:\Users\x\AppData\Roaming\geppio")
            } else {
                p.to_path_buf()
            })
        };
        assert!(
            validated_test_profile(Path::new(r"C:\Temp\geppio-native-test-j"), temp, &junction)
                .is_none()
        );
        // A missing directory is rejected.
        assert!(
            validated_test_profile(
                Path::new(r"C:\Temp\geppio-native-test-m"),
                temp,
                &|_: &Path| None
            )
            .is_none()
        );
    }

    #[test]
    fn hooks_need_a_valid_test_profile_and_never_reach_the_owner_profile() {
        let temp = Path::new(r"C:\Temp");
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |k: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == k)
                    .map(|(_, v)| v.to_string())
            }
        };
        let owner = Options::from_env(
            env(&[
                ("APPDATA", r"C:\Users\x\AppData\Roaming"),
                ("GEPPIO_NATIVE_TEST_SCRIPT", "theme"),
            ]),
            temp,
            identity,
        );
        assert_eq!(
            owner.profile.unwrap(),
            Path::new(r"C:\Users\x\AppData\Roaming\geppio-native")
        );
        assert_eq!(owner.script, None, "hooks are ignored outside test mode");
        let rejected = Options::from_env(
            env(&[
                ("APPDATA", r"C:\Users\x\AppData\Roaming"),
                (
                    "GEPPIO_NATIVE_TEST_PROFILE",
                    r"C:\Users\x\AppData\Roaming\geppio",
                ),
                ("GEPPIO_NATIVE_TEST_SCRIPT", "theme"),
            ]),
            temp,
            identity,
        );
        assert_eq!((rejected.profile, rejected.script), (None, None));
        let test = Options::from_env(
            env(&[
                (
                    "GEPPIO_NATIVE_TEST_PROFILE",
                    r"C:\Temp\geppio-native-test-a",
                ),
                ("GEPPIO_NATIVE_TEST_ZOOM", "1.25"),
                ("GEPPIO_NATIVE_TEST_SIZE", "1280x800"),
                ("GEPPIO_NATIVE_TEST_FREEZE", "collapse@0.5"),
                ("GEPPIO_NATIVE_TEST_SCRIPT", "peek"),
                ("GEPPIO_NATIVE_TEST_TRACE", "trace.jsonl"),
            ]),
            temp,
            identity,
        );
        assert_eq!(test.zoom, 1.25);
        assert_eq!(test.size, Some((1280.0, 800.0)));
        assert_eq!(test.freeze, Some((Freeze::Collapse, 0.5)));
        assert_eq!(test.script, Some(Script::Peek));
        assert_eq!(
            test.trace.unwrap(),
            Path::new(r"C:\Temp\geppio-native-test-a\trace.jsonl")
        );
        assert_eq!(default_profile(Some(Path::new("relative"))), None);
        // TMP/TEMP redirected into the roaming profile: the test profile is refused.
        let redirected = Options::from_env(
            env(&[
                ("APPDATA", r"C:\Users\x\AppData\Roaming"),
                (
                    "GEPPIO_NATIVE_TEST_PROFILE",
                    r"C:\Users\x\AppData\Roaming\geppio\geppio-native-test-a",
                ),
            ]),
            Path::new(r"C:\Users\x\AppData\Roaming\geppio"),
            identity,
        );
        assert_eq!(redirected.profile, None);
    }

    #[test]
    fn owner_profile_never_resolves_into_electron_data() {
        let app = Path::new(r"C:\Users\x\AppData\Roaming");
        let native = app.join("geppio-native");
        let missing = owner_profile(Some(app), |_| false, |_| None);
        assert_eq!(missing.as_deref(), Some(native.as_path()));
        let plain = owner_profile(Some(app), |_| true, identity);
        assert_eq!(plain.as_deref(), Some(native.as_path()));
        // A junction at geppio-native into Electron's folder (resolved by the canonicaliser).
        let into_electron = |p: &Path| {
            Some(if p.ends_with("geppio-native") {
                app.join("GEPPIO").join("sub")
            } else {
                p.to_path_buf()
            })
        };
        assert_eq!(owner_profile(Some(app), |_| true, into_electron), None);
        // A link the canonicaliser refuses to follow.
        assert_eq!(owner_profile(Some(app), |_| true, |_| None), None);
    }

    #[test]
    fn invalid_test_inputs_are_ignored() {
        for bad in [
            r"..\x.jsonl",
            "..",
            "preferences.json",
            "x:ads.jsonl",
            "NUL",
            "nul.jsonl",
            "COM1.jsonl",
            "a/b.jsonl",
            ".jsonl",
        ] {
            assert_eq!(trace_name(bad), None, "{bad}");
        }
        for bad in [
            "collapse@NaN",
            "collapse@2",
            "collapse@-1",
            "other@0.5",
            "collapse",
        ] {
            assert_eq!(parse_freeze(bad), None, "{bad}");
        }
        assert_eq!(Script::parse("unknown"), None);
    }
}
