//! Whole-intention edit history (`shared/workbench/history.ts`). A gesture owns one
//! before/after pair; intermediate solver frames never enter history.
use super::chrome::write_chrome;
use super::codec::{write_bars, write_placements, write_reference, write_snapshot, write_views};
use super::model::{SessionDraft, SessionSlot, WorkbenchSnapshot, limits};
use super::presentations::write_presentations;
use crate::js;
use crate::json::{ObjectWriter, write_array};

fn write_slots(out: &mut String, slots: &[SessionSlot]) {
    write_array(out, slots, |o, s| {
        let mut w = ObjectWriter::new(o);
        w.string("id", &s.id)
            .string("region", s.region.as_str())
            .number("x", s.x)
            .number("y", s.y)
            .number("width", s.width)
            .number("height", s.height);
        if let Some(bar) = &s.sidebar_bar {
            w.string("sidebarBar", bar);
        }
        w.raw("reference", |o| super::codec::write_size(o, s.reference));
        w.end();
    });
}

/// The canonical edit signature of a format (`formatSignature`): bar navigation and library
/// metadata do not edit a format; persistent widget presentations do.
pub fn format_signature(snapshot: &WorkbenchSnapshot, slots: &[SessionSlot]) -> String {
    let org = &snapshot.organization;
    let mut groups: Vec<_> = org
        .groups
        .as_ref()
        .map(|g| g.entries.clone())
        .unwrap_or_default();
    groups.sort_by(|a, b| js::locale_compare(&a.id, &b.id));
    let mut out = String::new();
    let mut w = ObjectWriter::new(&mut out);
    w.raw("reference", |o| write_reference(o, &snapshot.reference))
        .raw("placements", |o| write_placements(o, &snapshot.placements))
        .raw("views", |o| write_views(o, &org.views))
        .raw("bars", |o| write_bars(o, &org.bars))
        .raw("chrome", |o| write_chrome(o, &org.chrome))
        .raw("presentations", |o| {
            write_presentations(o, &org.presentations)
        })
        .raw("groups", |o| {
            write_array(o, &groups, |o, g| {
                let mut w = ObjectWriter::new(o);
                w.string("id", &g.id)
                    .string("frameId", &g.frame_id)
                    .strings("members", &g.members);
                w.end();
            })
        })
        .raw("slots", |o| write_slots(o, slots));
    w.end();
    out
}

/// `JSON.stringify(draft)`: the equality the history uses to skip no-op intentions.
pub fn draft_json(draft: &SessionDraft) -> String {
    let mut out = String::new();
    let mut w = ObjectWriter::new(&mut out);
    w.raw("snapshot", |o| write_snapshot(o, &draft.snapshot))
        .raw("slots", |o| write_slots(o, &draft.slots))
        .nullable_string("formatId", draft.format_id.as_deref())
        .nullable_string("formatMode", draft.format_mode.map(|m| m.as_str()));
    match &draft.format_source {
        Some(source) => {
            w.raw("formatSource", |o| {
                let mut w = ObjectWriter::new(o);
                w.raw("placements", |o| write_placements(o, &source.placements))
                    .raw("reference", |o| write_reference(o, &source.reference));
                w.end();
            });
        }
        None => {
            w.null("formatSource");
        }
    }
    w.end();
    out
}

/// Undo/redo of whole intentions, capped at [`limits::HISTORY`] (`EditHistory`).
#[derive(Clone, Debug, Default)]
pub struct EditHistory {
    undo_stack: Vec<SessionDraft>,
    redo_stack: Vec<SessionDraft>,
    gesture: Option<SessionDraft>,
}

impl EditHistory {
    /// An empty history.
    pub fn new() -> Self {
        Self::default()
    }
    /// Whether undo is available (never during a gesture).
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty() && self.gesture.is_none()
    }
    /// Whether redo is available (never during a gesture).
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty() && self.gesture.is_none()
    }
    /// Whether a gesture is open.
    pub fn active(&self) -> bool {
        self.gesture.is_some()
    }
    /// Recorded undo entries.
    pub fn undo_len(&self) -> usize {
        self.undo_stack.len()
    }
    /// Recorded redo entries.
    pub fn redo_len(&self) -> usize {
        self.redo_stack.len()
    }
    /// Opens a gesture with its before state (ignored while one is open).
    pub fn begin(&mut self, before: &SessionDraft) {
        if self.gesture.is_none() {
            self.gesture = Some(before.clone());
        }
    }
    /// Closes the gesture and records it as one intention.
    pub fn finish(&mut self, after: &SessionDraft) {
        if let Some(before) = self.gesture.take() {
            self.record(&before, after);
        }
    }
    /// Closes the gesture without recording; returns its before state.
    pub fn abort(&mut self) -> Option<SessionDraft> {
        self.gesture.take()
    }
    /// Records one intention unless it changed nothing; clears redo; keeps the newest 256.
    pub fn record(&mut self, before: &SessionDraft, after: &SessionDraft) {
        if draft_json(before) == draft_json(after) {
            return;
        }
        self.undo_stack.push(before.clone());
        self.redo_stack.clear();
        if self.undo_stack.len() > limits::HISTORY {
            self.undo_stack.remove(0);
        }
    }
    /// Steps back from `current`; returns the state to apply.
    pub fn undo(&mut self, current: &SessionDraft) -> Option<SessionDraft> {
        if !self.can_undo() {
            return None;
        }
        self.redo_stack.push(current.clone());
        self.undo_stack.pop()
    }
    /// Steps forward from `current`; returns the state to apply.
    pub fn redo(&mut self, current: &SessionDraft) -> Option<SessionDraft> {
        if !self.can_redo() {
            return None;
        }
        self.undo_stack.push(current.clone());
        self.redo_stack.pop()
    }
    /// Forgets everything.
    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.gesture = None;
    }
}
