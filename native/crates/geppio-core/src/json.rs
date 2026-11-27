//! JSON values with the ECMAScript `JSON.parse` and `JSON.stringify` semantics the
//! TypeScript reference relies on: property order (array-index keys first, then insertion
//! order), duplicate keys (last value, first position), correctly rounded numbers and the
//! exact `Number.prototype.toString` output. No external crate offers all of these without
//! the unapproved `preserve_order` feature, so the reader and writer are project-owned.
#![warn(missing_docs)]
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;

/// One parsed JSON value.
#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    /// `null`.
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// Any number, as an IEEE-754 double (JSON numbers can overflow to infinity).
    Number(f64),
    /// A string without unpaired surrogates.
    String(String),
    /// An array.
    Array(Vec<Json>),
    /// An object with ECMAScript property order.
    Object(JsonObject),
}

/// An ordered JSON object. Iteration follows ECMAScript `OrdinaryOwnPropertyKeys`:
/// canonical array-index keys in ascending numeric order, then other keys in insertion order.
///
/// Insertion and lookup avoid whole-object scans, so a hostile document with thousands of
/// keys parses in near-linear time. The fields are boxed so every [`Json`] value stays as
/// small as a string or an array.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct JsonObject {
    inner: Box<Fields>,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Fields {
    /// Canonical array-index keys, in ascending numeric order.
    indexed: BTreeMap<u64, (String, Json)>,
    /// Other keys, in insertion order.
    named: Vec<(String, Json)>,
    /// Position of each `named` key.
    lookup: HashMap<String, usize>,
}

/// Parses a canonical array index (`"0"`, `"17"`, at most 2³² − 2).
fn array_index(key: &str) -> Option<u64> {
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if key.len() > 1 && key.starts_with('0') {
        return None;
    }
    let value: u64 = key.parse().ok()?;
    (value < u64::from(u32::MAX)).then_some(value)
}

impl JsonObject {
    /// An empty object.
    pub fn new() -> Self {
        Self::default()
    }
    /// Sets a property like an ECMAScript assignment: an existing key keeps its position.
    pub fn insert(&mut self, key: impl Into<String>, value: Json) {
        let key = key.into();
        match array_index(&key) {
            Some(index) => match self.inner.indexed.get_mut(&index) {
                Some(slot) => slot.1 = value,
                None => {
                    self.inner.indexed.insert(index, (key, value));
                }
            },
            None => match self.inner.lookup.get(&key) {
                Some(&at) => self.inner.named[at].1 = value,
                None => {
                    self.inner
                        .lookup
                        .insert(key.clone(), self.inner.named.len());
                    self.inner.named.push((key, value));
                }
            },
        }
    }
    /// Builder form of [`JsonObject::insert`].
    pub fn with(mut self, key: impl Into<String>, value: Json) -> Self {
        self.insert(key, value);
        self
    }
    /// The value of an own property.
    pub fn get(&self, key: &str) -> Option<&Json> {
        match array_index(key) {
            Some(index) => self.inner.indexed.get(&index).map(|(_, v)| v),
            None => self
                .inner
                .lookup
                .get(key)
                .map(|&at| &self.inner.named[at].1),
        }
    }
    /// `Object.hasOwn`.
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }
    /// Removes a property (`delete`).
    pub fn remove(&mut self, key: &str) -> Option<Json> {
        if let Some(index) = array_index(key) {
            return self.inner.indexed.remove(&index).map(|(_, v)| v);
        }
        let at = self.inner.lookup.remove(key)?;
        let (_, value) = self.inner.named.remove(at);
        for (k, _) in &self.inner.named[at..] {
            if let Some(position) = self.inner.lookup.get_mut(k) {
                *position -= 1;
            }
        }
        Some(value)
    }
    /// Own properties in ECMAScript order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Json)> {
        self.inner
            .indexed
            .values()
            .chain(&self.inner.named)
            .map(|(k, v)| (k.as_str(), v))
    }
    /// `Object.keys`.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.iter().map(|(k, _)| k)
    }
    /// Number of own properties.
    pub fn len(&self) -> usize {
        self.inner.indexed.len() + self.inner.named.len()
    }
    /// Whether there are no own properties.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Json {
    /// The object, if this value is a non-array object.
    pub fn as_object(&self) -> Option<&JsonObject> {
        match self {
            Json::Object(o) => Some(o),
            _ => None,
        }
    }
    /// The array, if this value is an array.
    pub fn as_array(&self) -> Option<&Vec<Json>> {
        match self {
            Json::Array(a) => Some(a),
            _ => None,
        }
    }
    /// The string, if this value is a string.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }
    /// The number, if this value is a number (possibly non-finite).
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Number(n) => Some(*n),
            _ => None,
        }
    }
    /// The number when it is finite (`typeof v === 'number' && Number.isFinite(v)`).
    pub fn finite(&self) -> Option<f64> {
        self.as_f64().filter(|n| n.is_finite())
    }
    /// The boolean, if this value is a boolean.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }
    /// Property access on an object (`value[key]`); `None` stands for `undefined`.
    pub fn get(&self, key: &str) -> Option<&Json> {
        self.as_object().and_then(|o| o.get(key))
    }
    /// ECMAScript truthiness of a JSON value.
    pub fn truthy(&self) -> bool {
        match self {
            Json::Null => false,
            Json::Bool(b) => *b,
            Json::Number(n) => *n != 0.0 && !n.is_nan(),
            Json::String(s) => !s.is_empty(),
            Json::Array(_) | Json::Object(_) => true,
        }
    }
    /// `JSON.stringify(value)`.
    pub fn stringify(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }
    /// Appends `JSON.stringify(value)` to `out`.
    pub fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(true) => out.push_str("true"),
            Json::Bool(false) => out.push_str("false"),
            Json::Number(n) => write_number(out, *n),
            Json::String(s) => write_string(out, s),
            Json::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Json::Object(object) => {
                out.push('{');
                for (i, (key, value)) in object.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_string(out, key);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

impl From<f64> for Json {
    fn from(n: f64) -> Self {
        Json::Number(n)
    }
}
impl From<bool> for Json {
    fn from(b: bool) -> Self {
        Json::Bool(b)
    }
}
impl From<&str> for Json {
    fn from(s: &str) -> Self {
        Json::String(s.to_owned())
    }
}
impl From<String> for Json {
    fn from(s: String) -> Self {
        Json::String(s)
    }
}
impl From<JsonObject> for Json {
    fn from(o: JsonObject) -> Self {
        Json::Object(o)
    }
}
impl From<Vec<Json>> for Json {
    fn from(a: Vec<Json>) -> Self {
        Json::Array(a)
    }
}

/// `Number.prototype.toString()` (radix 10) for any double.
pub fn js_number(value: f64) -> String {
    let mut out = String::new();
    write_js_number(&mut out, value);
    out
}

/// Appends `Number.prototype.toString()` of `value`.
pub fn write_js_number(out: &mut String, value: f64) {
    if value.is_nan() {
        out.push_str("NaN");
        return;
    }
    if value == 0.0 {
        out.push('0');
        return;
    }
    if value.is_infinite() {
        out.push_str(if value > 0.0 { "Infinity" } else { "-Infinity" });
        return;
    }
    let mut x = value;
    if x < 0.0 {
        out.push('-');
        x = -x;
    }
    // Rust's `{:e}` prints the shortest digits that round-trip, as ECMAScript requires.
    let scientific = format!("{x:e}");
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("scientific notation has an exponent");
    let exponent: i32 = exponent.parse().expect("valid exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let e = n - 1;
        let _ = write!(out, "e{}{}", if e >= 0 { '+' } else { '-' }, e.abs());
    }
}

/// Appends a JSON number (`null` when not finite).
pub fn write_number(out: &mut String, value: f64) {
    if value.is_finite() {
        write_js_number(out, value);
    } else {
        out.push_str("null");
    }
}

/// Appends a quoted JSON string with `JSON.stringify` escaping.
pub fn write_string(out: &mut String, value: &str) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `JSON.stringify(string)`.
pub fn quote(value: &str) -> String {
    let mut out = String::new();
    write_string(&mut out, value);
    out
}

/// Why a text is not JSON. The TypeScript reference throws a `SyntaxError`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JsonSyntaxError {
    /// Byte offset of the failure.
    pub offset: usize,
}

impl std::fmt::Display for JsonSyntaxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Invalid JSON at byte {}", self.offset)
    }
}
impl std::error::Error for JsonSyntaxError {}

/// `JSON.parse(text)`. Strings containing escaped unpaired surrogates are rejected because
/// Rust strings cannot represent them (the only accepted-input difference from ECMAScript).
pub fn parse(text: &str) -> Result<Json, JsonSyntaxError> {
    let mut reader = Reader {
        bytes: text.as_bytes(),
        at: 0,
        text,
    };
    reader.space();
    let value = reader.value(0)?;
    reader.space();
    if reader.at != reader.bytes.len() {
        return Err(reader.error());
    }
    Ok(value)
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    text: &'a str,
}

/// Nesting bound: far above any valid GeppIO document (about ten levels) and, with parse,
/// print, clone and drop all recursive, well inside the 1 MiB Windows UI-thread stack even in
/// debug builds (512 overflowed it). `JSON.parse` accepts deeper input; this is a native limit.
const MAX_DEPTH: usize = 128;

impl Reader<'_> {
    fn error(&self) -> JsonSyntaxError {
        JsonSyntaxError { offset: self.at }
    }
    fn space(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.bytes.get(self.at) {
            self.at += 1;
        }
    }
    fn literal(&mut self, word: &str, value: Json) -> Result<Json, JsonSyntaxError> {
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            Ok(value)
        } else {
            Err(self.error())
        }
    }
    fn value(&mut self, depth: usize) -> Result<Json, JsonSyntaxError> {
        if depth > MAX_DEPTH {
            return Err(self.error());
        }
        match self.bytes.get(self.at) {
            Some(b'{') => {
                self.at += 1;
                let mut object = JsonObject::new();
                self.space();
                if self.bytes.get(self.at) == Some(&b'}') {
                    self.at += 1;
                    return Ok(Json::Object(object));
                }
                loop {
                    self.space();
                    if self.bytes.get(self.at) != Some(&b'"') {
                        return Err(self.error());
                    }
                    let key = self.string()?;
                    self.space();
                    if self.bytes.get(self.at) != Some(&b':') {
                        return Err(self.error());
                    }
                    self.at += 1;
                    self.space();
                    let value = self.value(depth + 1)?;
                    object.insert(key, value);
                    self.space();
                    match self.bytes.get(self.at) {
                        Some(b',') => self.at += 1,
                        Some(b'}') => {
                            self.at += 1;
                            return Ok(Json::Object(object));
                        }
                        _ => return Err(self.error()),
                    }
                }
            }
            Some(b'[') => {
                self.at += 1;
                let mut items = Vec::new();
                self.space();
                if self.bytes.get(self.at) == Some(&b']') {
                    self.at += 1;
                    return Ok(Json::Array(items));
                }
                loop {
                    self.space();
                    items.push(self.value(depth + 1)?);
                    self.space();
                    match self.bytes.get(self.at) {
                        Some(b',') => self.at += 1,
                        Some(b']') => {
                            self.at += 1;
                            return Ok(Json::Array(items));
                        }
                        _ => return Err(self.error()),
                    }
                }
            }
            Some(b'"') => Ok(Json::String(self.string()?)),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'n') => self.literal("null", Json::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(self.error()),
        }
    }
    fn digits(&mut self) -> usize {
        let start = self.at;
        while self.bytes.get(self.at).is_some_and(u8::is_ascii_digit) {
            self.at += 1;
        }
        self.at - start
    }
    fn number(&mut self) -> Result<Json, JsonSyntaxError> {
        let start = self.at;
        if self.bytes[self.at] == b'-' {
            self.at += 1;
        }
        match self.bytes.get(self.at) {
            Some(b'0') => self.at += 1,
            Some(b'1'..=b'9') => {
                self.digits();
            }
            _ => return Err(self.error()),
        }
        if self.bytes.get(self.at) == Some(&b'.') {
            self.at += 1;
            if self.digits() == 0 {
                return Err(self.error());
            }
        }
        if let Some(b'e' | b'E') = self.bytes.get(self.at) {
            self.at += 1;
            if let Some(b'+' | b'-') = self.bytes.get(self.at) {
                self.at += 1;
            }
            if self.digits() == 0 {
                return Err(self.error());
            }
        }
        // Rust's float parser is correctly rounded and overflows to infinity, like ECMAScript.
        let value: f64 = self.text[start..self.at]
            .parse()
            .map_err(|_| JsonSyntaxError { offset: start })?;
        Ok(Json::Number(value))
    }
    fn hex4(&mut self) -> Result<u32, JsonSyntaxError> {
        let slice = self.bytes.get(self.at..self.at + 4).ok_or(self.error())?;
        let text = std::str::from_utf8(slice).map_err(|_| self.error())?;
        if !text.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(self.error());
        }
        self.at += 4;
        u32::from_str_radix(text, 16).map_err(|_| self.error())
    }
    fn string(&mut self) -> Result<String, JsonSyntaxError> {
        self.at += 1; // opening quote
        let mut out = String::new();
        loop {
            let start = self.at;
            while let Some(&b) = self.bytes.get(self.at) {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.at += 1;
            }
            out.push_str(&self.text[start..self.at]);
            match self.bytes.get(self.at) {
                Some(b'"') => {
                    self.at += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.at += 1;
                    let escape = *self.bytes.get(self.at).ok_or(self.error())?;
                    self.at += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let unit = self.hex4()?;
                            let code = if (0xD800..0xDC00).contains(&unit) {
                                if self.bytes.get(self.at..self.at + 2) != Some(b"\\u") {
                                    return Err(self.error());
                                }
                                self.at += 2;
                                let low = self.hex4()?;
                                if !(0xDC00..0xE000).contains(&low) {
                                    return Err(self.error());
                                }
                                0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                            } else {
                                unit
                            };
                            out.push(char::from_u32(code).ok_or(self.error())?);
                        }
                        _ => return Err(self.error()),
                    }
                }
                _ => return Err(self.error()),
            }
        }
    }
}

/// Builds the `JSON.stringify` text of a record whose fields are written in a fixed order.
/// Fields whose value is `None` are omitted, like `undefined` properties.
pub struct ObjectWriter<'a> {
    out: &'a mut String,
    first: bool,
}

impl<'a> ObjectWriter<'a> {
    /// Starts an object.
    pub fn new(out: &'a mut String) -> Self {
        out.push('{');
        Self { out, first: true }
    }
    /// Writes the key and returns the buffer for the value.
    pub fn key(&mut self, key: &str) -> &mut String {
        if !self.first {
            self.out.push(',');
        }
        self.first = false;
        write_string(self.out, key);
        self.out.push(':');
        self.out
    }
    /// A string field.
    pub fn string(&mut self, key: &str, value: &str) -> &mut Self {
        write_string(self.key(key), value);
        self
    }
    /// A number field.
    pub fn number(&mut self, key: &str, value: f64) -> &mut Self {
        write_number(self.key(key), value);
        self
    }
    /// A boolean field.
    pub fn bool(&mut self, key: &str, value: bool) -> &mut Self {
        self.key(key).push_str(if value { "true" } else { "false" });
        self
    }
    /// A `null` field.
    pub fn null(&mut self, key: &str) -> &mut Self {
        self.key(key).push_str("null");
        self
    }
    /// A string-or-null field.
    pub fn nullable_string(&mut self, key: &str, value: Option<&str>) -> &mut Self {
        match value {
            Some(v) => self.string(key, v),
            None => self.null(key),
        }
    }
    /// A field written by a callback.
    pub fn raw(&mut self, key: &str, write: impl FnOnce(&mut String)) -> &mut Self {
        write(self.key(key));
        self
    }
    /// An array of strings.
    pub fn strings<S: AsRef<str>>(&mut self, key: &str, values: &[S]) -> &mut Self {
        let out = self.key(key);
        write_string_array(out, values);
        self
    }
    /// Closes the object.
    pub fn end(&mut self) {
        self.out.push('}');
    }
}

/// Appends a JSON array of strings.
pub fn write_string_array<S: AsRef<str>>(out: &mut String, values: &[S]) {
    out.push('[');
    for (i, v) in values.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write_string(out, v.as_ref());
    }
    out.push(']');
}

/// Appends a JSON array whose items are written by a callback.
pub fn write_array<T>(out: &mut String, items: &[T], mut write: impl FnMut(&mut String, &T)) {
    out.push('[');
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write(out, item);
    }
    out.push(']');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_like_ecmascript() {
        for (value, text) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (778.5, "778.5"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (0.000001, "0.000001"),
            (-123.456, "-123.456"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
            (123456789012345680000.0, "123456789012345680000"),
        ] {
            assert_eq!(js_number(value), text);
        }
    }

    #[test]
    fn objects_keep_ecmascript_order_and_duplicates() {
        let value = parse(r#"{"b":1,"a":2,"1":3,"0":4,"b":5}"#).unwrap();
        assert_eq!(value.stringify(), r#"{"0":4,"1":3,"b":5,"a":2}"#);
        assert_eq!(parse(r#""é\n😀""#).unwrap().stringify(), "\"é\\n😀\"");
        assert!(parse(r#""\ud800""#).is_err());
        assert!(parse("[1,]").is_err() && parse("01").is_err() && parse("1 2").is_err());
        assert_eq!(parse("-0").unwrap(), Json::Number(-0.0));
        assert_eq!(parse("1e400").unwrap(), Json::Number(f64::INFINITY));
    }

    #[test]
    fn object_order_survives_removal_and_large_hostile_key_sets() {
        // `delete` then re-add moves a named key to the end; index keys stay numeric.
        let mut o = JsonObject::new()
            .with("a", Json::Null)
            .with("b", Json::Null)
            .with("c", Json::Null)
            .with("4294967295", Json::Null)
            .with("10", Json::Null)
            .with("2", Json::Null);
        assert_eq!(o.remove("a"), Some(Json::Null));
        o.insert("a", Json::Bool(true));
        assert!(o.has("c") && o.has("10") && !o.has("010"));
        assert_eq!(
            o.keys().collect::<Vec<_>>(),
            ["2", "10", "b", "c", "4294967295", "a"]
        );
        // Thousands of descending index keys and named keys: near-linear, ECMAScript order.
        let n = 20_000;
        let mut text = String::from("{");
        for i in (0..n).rev() {
            let _ = write!(text, "\"{i}\":0,\"k{i}\":0,");
        }
        text.push_str("\"end\":0}");
        let parsed = parse(&text).unwrap();
        let object = parsed.as_object().unwrap();
        assert_eq!(object.len(), 2 * n + 1);
        let keys: Vec<&str> = object.keys().take(2).collect();
        assert_eq!(keys, ["0", "1"]);
        assert_eq!(object.keys().nth(n), Some(format!("k{}", n - 1).as_str()));
    }

    #[test]
    fn values_stay_small() {
        // A boxed object keeps every value (and array element) at string/array size.
        assert!(std::mem::size_of::<Json>() <= 32);
    }

    #[test]
    fn maximum_depth_fits_half_the_ui_thread_stack() {
        // The UI thread stack on Windows is 1 MiB; parse, print, clone and drop recurse. Half of
        // it is left to the host frames below the parse.
        std::thread::Builder::new()
            .stack_size(1 << 19)
            .spawn(|| {
                // Arrays, named-key objects and index-key objects take different paths;
                // equality recurses too (snapshot comparisons reach pass-through data).
                for (open, close) in [("[", "]"), (r#"{"a":"#, "}"), (r#"{"0":"#, "}")] {
                    // `n` nested containers, the innermost one empty (depth n − 1).
                    let deep = |n: usize| {
                        let empty = if open == "[" { "[]" } else { "{}" };
                        format!("{}{empty}{}", open.repeat(n - 1), close.repeat(n - 1))
                    };
                    let text = deep(MAX_DEPTH + 1);
                    let value = parse(&text).unwrap();
                    let copy = value.clone();
                    assert!(copy == value);
                    assert_eq!(copy.stringify(), text);
                    drop((value, copy));
                    assert!(parse(&deep(MAX_DEPTH + 2)).is_err());
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
