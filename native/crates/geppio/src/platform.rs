//! The host's only native calls, both read-only queries:
//! - the Windows "Animation effects" setting, which Chromium maps to `prefers-reduced-motion`;
//! - the user's display language (`GetUserDefaultUILanguage`), which stands in for the
//!   browser language of the reference's "Idioma do navegador".
//!
//! No handle, buffer or user input crosses the boundary; the results are plain values.
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
