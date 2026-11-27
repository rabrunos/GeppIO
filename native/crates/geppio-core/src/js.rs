//! ECMAScript numeric and string semantics used by the ported algorithms. `f64::max` and
//! `f64::min` ignore NaN and do not order signed zeros, so `Math.max`/`Math.min` are
//! replicated exactly; string comparisons follow UTF-16 code units or ICU root collation.
#![warn(missing_docs)]
use std::cmp::Ordering;

/// `Math.max(a, b)`.
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else if b > a {
        b
    } else if a == 0.0 && (a.is_sign_positive() || b.is_sign_positive()) {
        0.0
    } else {
        a
    }
}

/// `Math.min(a, b)`.
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else if b < a {
        b
    } else if a == 0.0 && (a.is_sign_negative() || b.is_sign_negative()) {
        -0.0
    } else {
        a
    }
}

/// `Math.max(...values)` (`-Infinity` when empty).
pub fn max_of(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(f64::NEG_INFINITY, max)
}

/// `Math.min(...values)` (`Infinity` when empty).
pub fn min_of(values: impl IntoIterator<Item = f64>) -> f64 {
    values.into_iter().fold(f64::INFINITY, min)
}

/// `Math.sign(x)`.
pub fn sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 {
        x
    } else if x > 0.0 {
        1.0
    } else {
        -1.0
    }
}

/// ECMAScript truthiness of a number (`x || fallback` takes the fallback for 0, -0, NaN).
pub fn or(x: f64, fallback: f64) -> f64 {
    if x == 0.0 || x.is_nan() { fallback } else { x }
}

/// Converts a numeric comparator result to an ordering, treating 0 and NaN as equal
/// (the `Array.prototype.sort` contract).
pub fn order(diff: f64) -> Ordering {
    if diff < 0.0 {
        Ordering::Less
    } else if diff > 0.0 {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

/// `a < b` / `a > b` on strings: UTF-16 code unit order (also the default `sort()`).
pub fn cmp_utf16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Primary and tertiary ICU root-collation weights of a character.
fn weights(c: char) -> (u32, u32) {
    match c {
        '_' => (1, 0),
        '-' => (2, 0),
        ':' => (3, 0),
        '.' => (4, 0),
        '0'..='9' => (10 + (c as u32 - '0' as u32), 0),
        'a'..='z' => (20 + (c as u32 - 'a' as u32), 0),
        'A'..='Z' => (20 + (c as u32 - 'A' as u32), 1),
        // Outside the identifier alphabet: code point order after every known character.
        _ => (0x100 + c as u32, 0),
    }
}

/// `a.localeCompare(b)` for GeppIO identifiers (`[A-Za-z0-9:._-]`): ICU root collation,
/// where punctuation precedes digits and letters, letters compare case-insensitively first
/// and lowercase precedes uppercase as a tertiary difference. Characters outside that
/// alphabet fall back to code point order (documented divergence; identifiers never use them).
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let primary = a
        .chars()
        .map(|c| weights(c).0)
        .cmp(b.chars().map(|c| weights(c).0));
    primary.then_with(|| {
        a.chars()
            .map(|c| weights(c).1)
            .cmp(b.chars().map(|c| weights(c).1))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn math_and_collation() {
        assert!(max(1.0, f64::NAN).is_nan() && min(f64::NAN, 1.0).is_nan());
        assert!(max(-0.0, 0.0).is_sign_positive() && min(0.0, -0.0).is_sign_negative());
        assert_eq!(max_of([]), f64::NEG_INFINITY);
        assert_eq!(or(-0.0, 1.0), 1.0);
        assert_eq!(locale_compare("a-b", "a_b"), Ordering::Greater);
        assert_eq!(locale_compare("aB", "Ab"), Ordering::Less);
        assert_eq!(locale_compare("ab", "A"), Ordering::Greater);
        assert_eq!(locale_compare("a", "a-"), Ordering::Less);
    }
}
