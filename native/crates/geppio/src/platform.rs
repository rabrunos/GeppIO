//! The host's only native calls, all read-only queries:
//! - the Windows "Animation effects" setting, which Chromium maps to `prefers-reduced-motion`;
//! - the user's display language (`GetUserDefaultUILanguage`), which stands in for the
//!   browser language of the reference's "Idioma do navegador";
//! - the local wall-clock hour and minute of an instant (`SystemTimeToTzSpecificLocalTime`
//!   with the current time-zone rules), for the notification times that `Intl` formats in the
//!   reference.
//!
//! No handle or user input crosses the boundary; the only buffers are fixed-size structs on
//! the caller's stack, and the results are plain values.
#[cfg(windows)]
#[allow(unsafe_code)]
mod windows {
    use core::ffi::c_void;

    const SPI_GETCLIENTAREAANIMATION: u32 = 0x1042;
    const LANG_PORTUGUESE: u16 = 0x16;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SystemParametersInfoW(action: u32, param: u32, value: *mut c_void, win_ini: u32) -> i32;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
        fn FileTimeToSystemTime(file_time: *const FileTime, system_time: *mut SystemTime) -> i32;
        fn SystemTimeToTzSpecificLocalTime(
            time_zone: *const c_void,
            universal: *const SystemTime,
            local: *mut SystemTime,
        ) -> i32;
    }

    /// `FILETIME`: 100 ns intervals since 1601-01-01 UTC.
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    /// `SYSTEMTIME`.
    #[repr(C)]
    #[derive(Default)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }

    /// Milliseconds between 1601-01-01 and 1970-01-01.
    const EPOCH_1601_MS: i64 = 11_644_473_600_000;

    pub fn local_hour_minute(epoch_ms: f64) -> Option<(u16, u16)> {
        if !epoch_ms.is_finite() {
            return None;
        }
        let ticks = (epoch_ms as i64)
            .checked_add(EPOCH_1601_MS)?
            .checked_mul(10_000)?;
        let ticks = u64::try_from(ticks).ok()?;
        let file_time = FileTime {
            low: ticks as u32,
            high: (ticks >> 32) as u32,
        };
        let (mut utc, mut local) = (SystemTime::default(), SystemTime::default());
        // SAFETY: both pointers are live, aligned locals of the documented `#[repr(C)]`
        // layouts; the call reads the first and writes the second.
        if unsafe { FileTimeToSystemTime(&file_time, &mut utc) } == 0 {
            return None;
        }
        // SAFETY: a null time zone selects the current one; `utc` is read and `local` is
        // written, both live, aligned locals of the `SYSTEMTIME` layout.
        if unsafe { SystemTimeToTzSpecificLocalTime(core::ptr::null(), &utc, &mut local) } == 0 {
            return None;
        }
        Some((local.hour, local.minute))
    }

    pub fn portuguese_ui() -> bool {
        // SAFETY: takes no arguments and returns a LANGID by value.
        let lang = unsafe { GetUserDefaultUILanguage() };
        lang & 0x3ff == LANG_PORTUGUESE
    }

    pub fn reduced_motion() -> bool {
        let mut enabled: i32 = 1;
        // SAFETY: SPI_GETCLIENTAREAANIMATION writes one BOOL (i32) to the pointer, which is a
        // live, aligned local; no other argument is a pointer.
        let ok = unsafe {
            SystemParametersInfoW(
                SPI_GETCLIENTAREAANIMATION,
                0,
                (&mut enabled as *mut i32).cast(),
                0,
            )
        };
        ok != 0 && enabled == 0
    }
}

/// True when the Windows display language is Portuguese.
pub fn portuguese_ui() -> bool {
    #[cfg(windows)]
    {
        windows::portuguese_ui()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// The local wall-clock hour and minute of an instant (milliseconds since 1970 UTC), under
/// the current time-zone rules; `None` off Windows or when the instant cannot be converted.
pub fn local_hour_minute(epoch_ms: f64) -> Option<(u16, u16)> {
    #[cfg(windows)]
    {
        windows::local_hour_minute(epoch_ms)
    }
    #[cfg(not(windows))]
    {
        let _ = epoch_ms;
        None
    }
}

/// True when the OS asks applications to reduce motion.
pub fn reduced_motion() -> bool {
    #[cfg(windows)]
    {
        windows::reduced_motion()
    }
    #[cfg(not(windows))]
    {
        false
    }
}
