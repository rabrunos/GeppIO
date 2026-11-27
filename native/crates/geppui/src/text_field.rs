//! Single-line text field (`input[type=text|search]`). It covers:
//! - a blinking caret (500ms phases, reset by every edit or caret move);
//! - selection by pointer (drag, shift-click, double-click word) and by keyboard (arrows,
//!   Ctrl for words, Home/End, Ctrl+A);
//! - clipboard (Ctrl+C/X/V) and IME composition through GPUI's platform input handler;
//! - a UTF-16 length cap like the HTML `maxlength` attribute.
//!
//! The host draws the box (border, radius, icon, focus ring) around [`TextField`]'s line and
//! subscribes to [`TextFieldEvent`]. Text never leaves the process except through the
//! clipboard on an explicit copy or cut.
use std::{ops::Range, time::Duration};

use gpui::{
    App, Bounds, ClipboardItem, Context, Element, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, EventEmitter, FocusHandle, Focusable, Font, FontFeatures, FontStyle,
    FontWeight, GlobalElementId, InspectorElementId, InteractiveElement, IntoElement, KeyDownEvent,
    LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Pixels,
    Point, Render, ShapedLine, SharedString, Style, Styled, TextAlign, TextRun, UTF16Selection,
    Window, div, fill, point, px, relative, size,
};

use crate::{appearance, metrics, metrics::UI_FONT};

/// Caret blink phase (Chromium on Windows uses the system caret blink time, 530ms by
/// default; the reference was measured at about 500ms).
const BLINK_MS: f64 = 500.0;

/// What a field reports to its owner.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextFieldEvent {
    /// The text changed through user input.
    Changed,
    /// Enter was pressed.
    Submitted,
}

/// The field state. Create it with `cx.new(|cx| TextField::new(cx))`.
pub struct TextField {
    focus: FocusHandle,
    text: String,
    /// Byte range; `reversed` puts the head at `start`.
    selection: Range<usize>,
    reversed: bool,
    marked: Option<Range<usize>>,
    placeholder: SharedString,
    max_utf16: Option<usize>,
    size: f32,
    line_height: f32,
    weight: FontWeight,
    line: Option<ShapedLine>,
    bounds: Option<Bounds<Pixels>>,
    scroll: Pixels,
    selecting: bool,
    blink_from: f64,
    focused: bool,
    /// The field's own undo and redo (`<input>` history): Ctrl+Z inside a field never
    /// reaches the host's shortcuts.
    undo: Vec<(String, Range<usize>)>,
    redo: Vec<(String, Range<usize>)>,
    /// The last edit typed at the caret: the next one joins its undo step.
    typing: bool,
}

/// Undo steps a field keeps (each typing run at the caret is one step).
const UNDO_LIMIT: usize = 100;

impl EventEmitter<TextFieldEvent> for TextField {}

impl Focusable for TextField {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

fn prev_boundary(text: &str, at: usize) -> usize {
    text[..at].char_indices().next_back().map_or(0, |(i, _)| i)
}

fn next_boundary(text: &str, at: usize) -> usize {
    text[at..]
        .chars()
        .next()
        .map_or(text.len(), |c| at + c.len_utf8())
}

/// Start of the word before `at` (whitespace, then a run of non-whitespace).
pub fn word_start(text: &str, at: usize) -> usize {
    let mut i = at;
    while i > 0
        && text[prev_boundary(text, i)..i]
            .chars()
            .all(char::is_whitespace)
    {
        i = prev_boundary(text, i);
    }
    while i > 0
        && !text[prev_boundary(text, i)..i]
            .chars()
            .all(char::is_whitespace)
    {
        i = prev_boundary(text, i);
    }
    i
}

/// End of the word after `at`.
pub fn word_end(text: &str, at: usize) -> usize {
    let mut i = at;
    while i < text.len()
        && text[i..next_boundary(text, i)]
            .chars()
            .all(char::is_whitespace)
    {
        i = next_boundary(text, i);
    }
    while i < text.len()
        && !text[i..next_boundary(text, i)]
            .chars()
            .all(char::is_whitespace)
    {
        i = next_boundary(text, i);
    }
    i
}

/// `i` clamped to the text and rounded down to a character boundary. Indexes can come from
/// the previous frame's layout or from the platform IME, so every stored offset passes here.
pub fn boundary(text: &str, i: usize) -> usize {
    let mut i = i.min(text.len());
    while i > 0 && !text.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// A forward, in-bounds, boundary-aligned range from two offsets in any order.
pub fn span(text: &str, a: usize, b: usize) -> Range<usize> {
    let (a, b) = (boundary(text, a), boundary(text, b));
    a.min(b)..a.max(b)
}

/// A single line: line breaks become spaces, as in an HTML text input.
fn one_line(text: &str) -> String {
    text.replace(['\r', '\n', '\u{2028}', '\u{2029}'], " ")
}

/// Uncapped fields still stop at this many UTF-16 units (a pasted megabyte would be
/// reshaped on every caret blink).
const DEFAULT_MAX: usize = 1024;

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn offset_to_utf16(text: &str, offset: usize) -> usize {
    utf16_len(&text[..offset.min(text.len())])
}

fn offset_from_utf16(text: &str, utf16: usize) -> usize {
    let mut count = 0;
    for (i, c) in text.char_indices() {
        if count >= utf16 {
            return i;
        }
        count += c.len_utf16();
    }
    text.len()
}

/// Keeps as much of `insert` as fits in `max` UTF-16 units next to `rest` (like `maxlength`).
pub fn clamp_insert(rest: &str, insert: &str, max: Option<usize>) -> String {
    let Some(max) = max else {
        return insert.to_owned();
    };
    let mut room = max.saturating_sub(utf16_len(rest));
    let mut out = String::new();
    for c in insert.chars() {
        if c.len_utf16() > room {
            break;
        }
        room -= c.len_utf16();
        out.push(c);
    }
    out
}

impl TextField {
    pub fn new(cx: &mut Context<Self>) -> Self {
        // A cheap 2Hz repaint while focused keeps the caret blinking.
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(BLINK_MS as u64))
                    .await;
                let alive = this.update(cx, |field, cx| {
                    if field.focused {
                        cx.notify();
                    }
                });
                if alive.is_err() {
                    break;
                }
            }
        })
        .detach();
        Self {
            focus: cx.focus_handle(),
            text: String::new(),
            selection: 0..0,
            reversed: false,
            marked: None,
            placeholder: SharedString::default(),
            max_utf16: Some(DEFAULT_MAX),
            size: 13.0,
            line_height: 20.0,
            weight: FontWeight::NORMAL,
            line: None,
            bounds: None,
            scroll: px(0.0),
            selecting: false,
            blink_from: 0.0,
            focused: false,
            undo: Vec::new(),
            redo: Vec::new(),
            typing: false,
        }
    }
    pub fn placeholder(mut self, text: impl Into<SharedString>) -> Self {
        self.placeholder = text.into();
        self
    }
    /// The HTML `maxlength` (UTF-16 units).
    pub fn max_length(mut self, max: usize) -> Self {
        self.max_utf16 = Some(max);
        self
    }
    /// Font size and line height in CSS pixels.
    pub fn font(mut self, size: f32, line_height: f32) -> Self {
        self.size = size;
        self.line_height = line_height;
        self
    }
    pub fn text(&self) -> &str {
        &self.text
    }
    pub fn set_placeholder(&mut self, text: impl Into<SharedString>) {
        self.placeholder = text.into();
    }
    /// Replaces the text programmatically (no [`TextFieldEvent::Changed`]); caret at the end.
    pub fn set_text(&mut self, text: &str, cx: &mut Context<Self>) {
        self.text = clamp_insert("", &one_line(text), self.max_utf16);
        self.selection = self.text.len()..self.text.len();
        self.reversed = false;
        self.marked = None;
        self.line = None;
        self.undo.clear();
        self.redo.clear();
        self.typing = false;
        cx.notify();
    }
    pub fn select_all(&mut self, cx: &mut Context<Self>) {
        self.selection = 0..self.text.len();
        self.reversed = false;
        cx.notify();
    }
    pub fn is_focused(&self, window: &Window) -> bool {
        self.focus.is_focused(window)
    }

    fn head(&self) -> usize {
        if self.reversed {
            self.selection.start
        } else {
            self.selection.end
        }
    }

    fn touch(&mut self, cx: &mut Context<Self>) {
        self.blink_from = appearance(cx).clock.now();
        cx.notify();
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.typing = false;
        let offset = boundary(&self.text, offset);
        self.selection = offset..offset;
        self.reversed = false;
        self.touch(cx);
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.typing = false;
        let offset = boundary(&self.text, offset);
        let anchor = boundary(
            &self.text,
            if self.reversed {
                self.selection.end
            } else {
                self.selection.start
            },
        );
        if offset < anchor {
            self.selection = offset..anchor;
            self.reversed = true;
        } else {
            self.selection = anchor..offset;
            self.reversed = false;
        }
        self.touch(cx);
    }

    fn replace(&mut self, range: Range<usize>, insert: &str, cx: &mut Context<Self>) {
        let range = span(&self.text, range.start, range.end);
        let insert = one_line(insert);
        let rest = format!("{}{}", &self.text[..range.start], &self.text[range.end..]);
        let insert = clamp_insert(&rest, &insert, self.max_utf16);
        let typed = range.is_empty() && !insert.is_empty();
        if (!insert.is_empty() || !range.is_empty())
            && !(typed && self.typing && range.start == self.head())
        {
            self.undo.push((self.text.clone(), self.selection.clone()));
            if self.undo.len() > UNDO_LIMIT {
                self.undo.remove(0);
            }
        }
        self.redo.clear();
        self.typing = typed;
        self.text = format!(
            "{}{insert}{}",
            &self.text[..range.start],
            &self.text[range.end..]
        );
        let caret = range.start + insert.len();
        self.selection = caret..caret;
        self.reversed = false;
        self.marked = None;
        // The last layout no longer matches the text.
        self.line = None;
        self.touch(cx);
        cx.emit(TextFieldEvent::Changed);
    }

    fn on_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let k = &event.keystroke;
        let ctrl = (k.modifiers.control || k.modifiers.platform) && !k.modifiers.alt;
        let shift = k.modifiers.shift;
        let head = self.head();
        let collapsed = self.selection.is_empty();
        let handled = match k.key.as_str() {
            "left" => {
                let to = if ctrl {
                    word_start(&self.text, head)
                } else if !shift && !collapsed {
                    self.selection.start
                } else {
                    prev_boundary(&self.text, head)
                };
                if shift {
                    self.select_to(to, cx)
                } else {
                    self.move_to(to, cx)
                }
                true
            }
            "right" => {
                let to = if ctrl {
                    word_end(&self.text, head)
                } else if !shift && !collapsed {
                    self.selection.end
                } else {
                    next_boundary(&self.text, head)
                };
                if shift {
                    self.select_to(to, cx)
                } else {
                    self.move_to(to, cx)
                }
                true
            }
            "home" => {
                if shift {
                    self.select_to(0, cx)
                } else {
                    self.move_to(0, cx)
                }
                true
            }
            "end" => {
                let end = self.text.len();
                if shift {
                    self.select_to(end, cx)
                } else {
                    self.move_to(end, cx)
                }
                true
            }
            "backspace" => {
                if collapsed {
                    let from = if ctrl {
                        word_start(&self.text, head)
                    } else {
                        prev_boundary(&self.text, head)
                    };
                    if from < head {
                        self.replace(from..head, "", cx);
                    }
                } else {
                    self.replace(self.selection.clone(), "", cx);
                }
                true
            }
            "delete" => {
                if collapsed {
                    let to = if ctrl {
                        word_end(&self.text, head)
                    } else {
                        next_boundary(&self.text, head)
                    };
                    if to > head {
                        self.replace(head..to, "", cx);
                    }
                } else {
                    self.replace(self.selection.clone(), "", cx);
                }
                true
            }
            "a" if ctrl => {
                self.select_all(cx);
                true
            }
            "c" | "x" if ctrl => {
                if !collapsed {
                    let text = self.text[self.selection.clone()].to_owned();
                    cx.write_to_clipboard(ClipboardItem::new_string(text));
                    if k.key == "x" {
                        self.replace(self.selection.clone(), "", cx);
                    }
                }
                true
            }
            "v" if ctrl => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    self.replace(self.selection.clone(), &text, cx);
                }
                true
            }
            "z" if ctrl && !shift => {
                self.step(true, cx);
                true
            }
            "y" if ctrl => {
                self.step(false, cx);
                true
            }
            "z" if ctrl => {
                self.step(false, cx);
                true
            }
            "enter" => {
                cx.emit(TextFieldEvent::Submitted);
                true
            }
            _ => false,
        };
        if handled {
            cx.stop_propagation();
        }
        let _ = window;
    }

    /// Undo (`back`) or redo one step of the field's own history.
    fn step(&mut self, back: bool, cx: &mut Context<Self>) {
        let (from, to) = if back {
            (&mut self.undo, &mut self.redo)
        } else {
            (&mut self.redo, &mut self.undo)
        };
        let Some((text, selection)) = from.pop() else {
            return;
        };
        to.push((
            std::mem::replace(&mut self.text, text),
            self.selection.clone(),
        ));
        self.selection = span(&self.text, selection.start, selection.end);
        self.reversed = false;
        self.marked = None;
        self.line = None;
        self.typing = false;
        self.touch(cx);
        cx.emit(TextFieldEvent::Changed);
    }

    fn index_at(&self, position: Point<Pixels>) -> usize {
        let (Some(bounds), Some(line)) = (self.bounds, self.line.as_ref()) else {
            return self.text.len();
        };
        if self.text.is_empty() {
            return 0;
        }
        let x = position.x - bounds.origin.x + self.scroll;
        boundary(&self.text, line.closest_index_for_x(x))
    }

    fn on_mouse_down(&mut self, e: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
        let at = self.index_at(e.position);
        if e.click_count >= 3 {
            self.select_all(cx);
        } else if e.click_count == 2 {
            let start = word_start(
                &self.text,
                next_boundary(&self.text, at).min(self.text.len()),
            );
            let end = word_end(&self.text, at);
            self.selection = start.min(end)..end.max(start);
            self.reversed = false;
            self.touch(cx);
        } else if e.modifiers.shift {
            self.select_to(at, cx);
        } else {
            self.selecting = true;
            self.move_to(at, cx);
        }
    }

    fn on_mouse_move(&mut self, e: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.selecting {
            let at = self.index_at(e.position);
            self.select_to(at, cx);
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.selecting = false;
    }
}

impl EntityInputHandler for TextField {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let r = span(
            &self.text,
            offset_from_utf16(&self.text, range.start),
            offset_from_utf16(&self.text, range.end),
        );
        adjusted.replace(offset_to_utf16(&self.text, r.start)..offset_to_utf16(&self.text, r.end));
        Some(self.text[r].to_owned())
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: offset_to_utf16(&self.text, self.selection.start)
                ..offset_to_utf16(&self.text, self.selection.end),
            reversed: self.reversed,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked
            .as_ref()
            .map(|r| offset_to_utf16(&self.text, r.start)..offset_to_utf16(&self.text, r.end))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.marked = None;
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .map(|r| offset_from_utf16(&self.text, r.start)..offset_from_utf16(&self.text, r.end))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        self.replace(range, text, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        new_text: &str,
        new_selected: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .map(|r| offset_from_utf16(&self.text, r.start)..offset_from_utf16(&self.text, r.end))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        let range = span(&self.text, range.start, range.end);
        let new_text = &one_line(new_text);
        // Composition text is not clamped until it is committed.
        self.text = format!(
            "{}{new_text}{}",
            &self.text[..range.start],
            &self.text[range.end..]
        );
        self.marked = (!new_text.is_empty()).then(|| range.start..range.start + new_text.len());
        self.line = None;
        self.selection = match new_selected {
            Some(r) => span(
                &self.text,
                range.start + offset_from_utf16(new_text, r.start),
                range.start + offset_from_utf16(new_text, r.end),
            ),
            None => {
                let caret = range.start + new_text.len();
                caret..caret
            }
        };
        self.reversed = false;
        self.touch(cx);
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let line = self.line.as_ref()?;
        let start = line.x_for_index(offset_from_utf16(&self.text, range.start));
        let end = line.x_for_index(offset_from_utf16(&self.text, range.end));
        Some(Bounds::from_corners(
            point(bounds.left() + start - self.scroll, bounds.top()),
            point(bounds.left() + end - self.scroll, bounds.bottom()),
        ))
    }

    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let at = self.index_at(position);
        Some(offset_to_utf16(&self.text, at))
    }
}

impl Render for TextField {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let focused = self.focus.is_focused(window);
        if focused && !self.focused {
            // Gaining focus restarts the blink with a visible caret.
            self.blink_from = appearance(cx).clock.now();
        }
        self.focused = focused;
        div()
            .id(ElementId::Name("geppui-text-field".into()))
            .track_focus(&self.focus)
            .key_context("TextField")
            .w_full()
            .cursor_text()
            .on_key_down(cx.listener(Self::on_key))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .child(TextLine { field: cx.entity() })
    }
}

struct TextLine {
    field: Entity<TextField>,
}

struct Prepared {
    line: ShapedLine,
    origin: Point<Pixels>,
    selection: Option<Bounds<Pixels>>,
    caret: Option<Bounds<Pixels>>,
}

impl Element for TextLine {
    type RequestLayoutState = ();
    type PrepaintState = Prepared;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let m = metrics(window, cx);
        let field = self.field.read(cx);
        let mut style = Style::default();
        style.size.width = relative(1.0).into();
        style.size.height = m.px(field.line_height).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Prepared {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let now = appearance(cx).clock.now();
        let field = self.field.read(cx);
        let font = Font {
            family: UI_FONT.into(),
            features: FontFeatures::default(),
            fallbacks: None,
            weight: field.weight,
            style: FontStyle::Normal,
        };
        let empty = field.text.is_empty();
        let (shown, color): (SharedString, _) = if empty {
            (field.placeholder.clone(), t.text_muted)
        } else {
            (field.text.clone().into(), t.text)
        };
        // Runs split at the selection (Chromium's Windows highlight: white on the system
        // blue, only while focused) and at the IME composition (underlined).
        let selected = (field.focused && !empty).then(|| field.selection.clone());
        let marked = field.marked.clone().filter(|_| !empty);
        let mut cuts = vec![0, shown.len()];
        for r in selected.iter().chain(marked.iter()) {
            cuts.extend([r.start, r.end]);
        }
        cuts.sort_unstable();
        cuts.dedup();
        let runs: Vec<TextRun> = cuts
            .windows(2)
            .filter(|w| w[1] > w[0])
            .map(|w| {
                let inside = |r: &Option<Range<usize>>| {
                    r.as_ref().is_some_and(|r| r.start <= w[0] && w[1] <= r.end)
                };
                TextRun {
                    len: w[1] - w[0],
                    font: font.clone(),
                    color: if inside(&selected) {
                        gpui::white()
                    } else {
                        color
                    },
                    background_color: None,
                    underline: inside(&marked).then_some(gpui::UnderlineStyle {
                        thickness: px(1.0),
                        color: Some(t.text),
                        wavy: false,
                    }),
                    strikethrough: None,
                }
            })
            .collect();
        let line = window
            .text_system()
            .shape_line(shown, m.px(field.size), &runs, None);
        let caret_x = if empty {
            px(0.0)
        } else {
            line.x_for_index(field.head())
        };
        // Keep the caret inside the visible width.
        let width = bounds.size.width;
        let mut scroll = field.scroll;
        if caret_x - scroll > width - px(1.0) {
            scroll = caret_x - width + px(1.0);
        } else if caret_x < scroll {
            scroll = caret_x;
        }
        if empty || line.width <= width {
            scroll = px(0.0);
        }
        let origin = point(bounds.left() - scroll, bounds.top());
        let selection = (field.focused && !field.selection.is_empty() && !empty).then(|| {
            let start = line.x_for_index(field.selection.start);
            let end = line.x_for_index(field.selection.end);
            Bounds::from_corners(
                point(origin.x + start, bounds.top()),
                point(origin.x + end, bounds.bottom()),
            )
        });
        let visible = field.focused
            && field.selection.is_empty()
            && (((now - field.blink_from).max(0.0) / BLINK_MS) as u64).is_multiple_of(2);
        let caret = visible.then(|| Bounds {
            origin: point(origin.x + caret_x, bounds.top()),
            size: size(m.px(1.0).max(px(1.0)), bounds.size.height),
        });
        self.field.update(cx, |f, _| f.scroll = scroll);
        Prepared {
            line,
            origin,
            selection,
            caret,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        prepared: &mut Prepared,
        window: &mut Window,
        cx: &mut App,
    ) {
        let t = crate::theme(cx);
        let focus = self.field.read(cx).focus.clone();
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.field.clone()),
            cx,
        );
        let line_height = bounds.size.height;
        window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
            if let Some(selection) = prepared.selection {
                window.paint_quad(fill(selection, gpui::rgb(0x0078d7)));
            }
            let _ = prepared.line.paint(
                prepared.origin,
                line_height,
                TextAlign::Left,
                None,
                window,
                cx,
            );
            if let Some(caret) = prepared.caret {
                window.paint_quad(fill(caret, t.text));
            }
        });
        let line = prepared.line.clone();
        self.field.update(cx, |f, _| {
            f.line = Some(line);
            f.bounds = Some(bounds);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_motion_and_length_cap() {
        let text = "Meu  espaço de trabalho";
        assert_eq!(word_end(text, 0), 3);
        assert_eq!(word_end(text, 3), 12);
        assert_eq!(word_start(text, text.len()), 16);
        assert_eq!(word_start(text, 5), 0);
        assert_eq!(clamp_insert("abc", "defg", Some(5)), "de");
        assert_eq!(clamp_insert("", "😀😀", Some(3)), "😀");
        assert_eq!(clamp_insert("x", "yz", None), "yz");
        assert_eq!(offset_from_utf16("a😀b", 3), 5);
        assert_eq!(offset_to_utf16("a😀b", 5), 3);
        // Offsets from a stale layout or the IME never split a character.
        assert_eq!(boundary("aé", 2), 1);
        assert_eq!(boundary("aé", 9), 3);
        assert_eq!(span("abcé", 4, 1), 1..3);
        assert_eq!(one_line("a\r\nb"), "a  b");
    }
}
