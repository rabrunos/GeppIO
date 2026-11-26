//! The only native call of the host: a read-only query of the Windows "Animation effects"
//! setting, which Chromium maps to `prefers-reduced-motion`. No handle, buffer or user
//! input crosses the boundary; the result is a plain boolean.
#[cfg(windows)]
#[allow(unsafe_code)]
mod windows {
    use core::ffi::c_void;

    const SPI_GETCLIENTAREAANIMATION: u32 = 0x1042;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SystemParametersInfoW(action: u32, param: u32, value: *mut c_void, win_ini: u32) -> i32;
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
