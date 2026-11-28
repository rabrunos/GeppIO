//! Modal dialog (`.profile-dialog`): 420px, 14px radius, backdrop without animation,
//! the panel plays `profile-enter`. A press on the backdrop or the close button dismisses.
//! Like `showModal()`, focus moves inside when it opens (the first control, or the one the
//! host names) and Tab cycles through the dialog's controls only.
use std::rc::Rc;

use gpui::{
    AnyElement, App, ElementId, FocusHandle, InteractiveElement, IntoElement, KeyDownEvent,
    MouseDownEvent, ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled,
    Window, deferred, div, prelude::FluentBuilder, px,
};

use crate::{css_weight, icon_button, metrics, popover::enter_progress};

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Dialog {
    id: SharedString,
    title: SharedString,
    close_label: SharedString,
    width: f32,
    children: Vec<AnyElement>,
    on_dismiss: Option<Handler>,
    initial_focus: Option<FocusHandle>,
}

/// Focus state of one open dialog.
struct DialogFocus {
    panel: FocusHandle,
    placed: bool,
}

/// Steps focus forward (or back) through the window's tab stops until it lands inside
/// `panel` (the stops of a dialog are contiguous: it is painted last).
fn focus_inside(panel: &FocusHandle, back: bool, window: &mut Window, cx: &mut App) {
    for _ in 0..512 {
        if back {
            window.focus_prev(cx);
        } else {
            window.focus_next(cx);
        }
        if panel.contains_focused(window, cx) {
            return;
        }
    }
}

pub fn dialog(id: impl Into<SharedString>, title: impl Into<SharedString>) -> Dialog {
    Dialog {
        id: id.into(),
        title: title.into(),
        close_label: "Fechar".into(),
        width: 420.0,
        children: Vec::new(),
        on_dismiss: None,
        initial_focus: None,
    }
}

impl Dialog {
    pub fn width(mut self, width: f32) -> Self {
        self.width = width;
        self
    }
    pub fn close_label(mut self, label: impl Into<SharedString>) -> Self {
        self.close_label = label.into();
        self
    }
    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
    /// The control that takes focus when the dialog opens (`autoFocus`); by default the
    /// first one.
    pub fn initial_focus(mut self, handle: &FocusHandle) -> Self {
        self.initial_focus = Some(handle.clone());
        self
    }
}

impl ParentElement for Dialog {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements)
    }
}

impl RenderOnce for Dialog {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = crate::theme(cx);
        let m = metrics(window, cx);
        let progress = enter_progress(&self.id, window, cx);
        let viewport = window.viewport_size();
        let max_width = f32::from(viewport.width) - f32::from(m.px(22.0));
        let width = f32::from(m.px(self.width)).min(max_width);
        let lift = f32::from(m.px(-4.0)) * (1.0 - progress);
        let dismiss_outside = self.on_dismiss.clone();
        let dismiss_close = self.on_dismiss.clone();
        let state = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}::focus", self.id))),
            cx,
            |_, cx| DialogFocus {
                panel: cx.focus_handle(),
                placed: false,
            },
        );
        let panel = state.read(cx).panel.clone();
        if !state.read(cx).placed {
            state.update(cx, |s, _| s.placed = true);
            let (panel, initial) = (panel.clone(), self.initial_focus.clone());
            // After this frame is painted, its tab stops include the dialog's.
            // A host that already focused a control inside (a form's first field) keeps it.
            window.defer(cx, move |window, cx| {
                if panel.contains_focused(window, cx) {
                    return;
                }
                match &initial {
                    Some(handle) => window.focus(handle, cx),
                    None => focus_inside(&panel, false, window, cx),
                }
            });
        }
        let trap = panel.clone();
        let close = icon_button(SharedString::from(format!("{}::close", self.id)), "x-mark")
            .label(self.close_label.clone())
            .size(32.0, 18.0)
            .color(t.text_muted)
            .when_some(dismiss_close, |b, h| b.on_click(move |_, w, cx| h(w, cx)));
        deferred(
            div()
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .occlude()
                .bg(t.dialog_backdrop)
                .flex()
                .items_center()
                .justify_center()
                .font_family(crate::UI_FONT)
                .child(
                    div()
                        .id(ElementId::Name(self.id.clone()))
                        .role(gpui::Role::Dialog)
                        .aria_label(self.title.clone())
                        .track_focus(&panel)
                        .on_key_down(move |e: &KeyDownEvent, window, cx| {
                            let k = &e.keystroke;
                            if k.key == "tab" && !k.modifiers.control {
                                cx.stop_propagation();
                                focus_inside(&trap, k.modifiers.shift, window, cx);
                            }
                        })
                        .occlude()
                        .relative()
                        .top(px(lift))
                        .w(px(width))
                        .max_h(px(f32::from(viewport.height) - f32::from(m.px(18.0))))
                        .py(m.px(18.0))
                        .px(m.px(22.0))
                        .rounded(m.px(14.0))
                        .border(m.border(1.0))
                        .border_color(t.border)
                        .bg(t.elevated)
                        .shadow(vec![m.shadow(t.shadow_dialog)])
                        .text_size(m.px(13.0))
                        .line_height(m.px(17.0))
                        .text_color(t.text)
                        .opacity(progress)
                        .when_some(dismiss_outside, |el, h| {
                            el.on_mouse_down_out(move |_: &MouseDownEvent, w, cx| h(w, cx))
                        })
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(m.px(11.0))
                                .child(
                                    div()
                                        .text_size(m.px(18.0))
                                        .line_height(m.px(28.0))
                                        .font_weight(css_weight(600.0))
                                        .child(self.title.clone()),
                                )
                                .child(close),
                        )
                        .children(self.children),
                ),
        )
        .with_priority(2)
    }
}
