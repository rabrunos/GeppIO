//! Records where a trigger was laid out so overlays can anchor to it.
use std::{cell::Cell, rc::Rc};

use gpui::{Bounds, IntoElement, Pixels, Styled, canvas};

/// Shared, last-prepainted bounds of an element.
#[derive(Clone, Default, Debug)]
pub struct AnchorHandle(Rc<Cell<Option<Bounds<Pixels>>>>);

impl AnchorHandle {
    pub fn bounds(&self) -> Option<Bounds<Pixels>> {
        self.0.get()
    }
}

/// An invisible child that fills its parent and records the parent's bounds.
/// The parent must be `relative()`.
pub fn anchor_probe(handle: &AnchorHandle) -> impl IntoElement {
    let cell = handle.0.clone();
    canvas(move |bounds, _, _| cell.set(Some(bounds)), |_, _, _, _| {})
        .absolute()
        .top_0()
        .left_0()
        .size_full()
}
