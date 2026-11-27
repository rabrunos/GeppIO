//! Edit-mode chrome: the 2px window frame and the header banner with Undo, Redo, Cancelar,
//! Salvar edição and Concluir (`persistent-mode-indicator.css`, `Header.tsx` at alpha.99).
use std::rc::Rc;

use geppui::{Metrics, Shadow, Theme, ThemeName, button::hover_state, css_weight, icon};
use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, FocusHandle, Hsla, InteractiveElement,
    IntoElement, ParentElement, SharedString, StatefulInteractiveElement, Styled, Window, div,
    prelude::FluentBuilder, px, rgb, rgba,
};

type Handler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// Banner palette (`--editor-banner-*`).
struct Banner {
    background: Hsla,
    foreground: Hsla,
    control: Hsla,
    hover: Hsla,
    hint: Hsla,
    muted: Hsla,
}

fn banner(t: &Theme) -> Banner {
    match t.name {
        ThemeName::Light => Banner {
            background: rgb(0x17385d).into(),
            foreground: rgb(0xffffff).into(),
            control: rgb(0x294c73).into(),
            hover: rgb(0x385e87).into(),
            hint: rgb(0xc8d6e8).into(),
            muted: rgb(0xc8d6e8).into(),
        },
        ThemeName::Dark => Banner {
            background: rgb(0x2b3d56).into(),
            foreground: rgb(0xf8f8f2).into(),
            control: rgb(0x354d6a).into(),
            hover: rgb(0x425e7e).into(),
            hint: rgb(0xc1cede).into(),
            muted: rgb(0xc1cede).into(),
        },
    }
}

/// Edit-session controls the banner exposes.
pub struct BannerActions {
    pub can_undo: bool,
    pub can_redo: bool,
    pub saving: bool,
    pub undo: Handler,
    pub redo: Handler,
    pub cancel: Handler,
    pub save: Handler,
    pub conclude: Handler,
    /// Receives focus when Edit starts (the reference focuses Salvar edição).
    pub save_focus: FocusHandle,
    /// "Editando: {0}" while a composition is applied (`editingLabel`).
    pub label: SharedString,
    /// "Formato + widgets · Barra lateral fixada" and its variants (`editingHint`).
    pub hint: SharedString,
}

/// The 2px accent frame around the window (z 90, no hit testing).
pub fn window_frame(t: &Theme, m: Metrics) -> Div {
    div()
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .border(m.border(2.0))
        .border_color(t.accent.opacity(0.75))
}

#[allow(clippy::too_many_arguments)]
fn history_button(
    id: &'static str,
    glyph: &'static str,
    label: SharedString,
    enabled: bool,
    b: &Banner,
    m: Metrics,
    handler: Handler,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let (focus, outline): (Option<FocusHandle>, Hsla) = (None, b.hover);
    let key = SharedString::from(id);
    let (state, hovered, _) = hover_state(&key, window, cx);
    let (bg, fg) = if !enabled {
        (None, b.muted)
    } else if hovered {
        (Some(b.hover), b.foreground)
    } else {
        (Some(b.control), b.foreground)
    };
    div()
        .id(ElementId::Name(key.clone()))
        .track_focus(&geppui::button::focus_handle(
            &key,
            focus.clone(),
            window,
            cx,
        ))
        .focus_visible(move |s| {
            s.shadow(vec![
                gpui::BoxShadow::new(px(0.0), px(0.0), outline).spread_radius(m.px(2.0)),
            ])
        })
        .size(m.px(26.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(m.px(6.0))
        .when_some(bg, |el, bg| el.bg(bg))
        .when(!enabled, |el| el.opacity(0.5))
        .when(enabled, |el| {
            el.cursor_pointer()
                .on_click(move |e, w, cx| handler(e, w, cx))
        })
        .on_hover(geppui::button::hover_listener(state))
        .tooltip(move |_, cx| geppui::button::tooltip_view(label.clone(), cx))
        .child(icon(glyph, m).size(16.0).color(fg))
        .into_any_element()
}

#[allow(clippy::too_many_arguments)]
fn action(
    id: &'static str,
    label: SharedString,
    colors: (Hsla, Hsla, Hsla, Hsla),
    outline: Hsla,
    focus: Option<FocusHandle>,
    m: Metrics,
    handler: Handler,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let (fg, bg, border, hover) = colors;
    let key = SharedString::from(id);
    let (state, hovered, _) = hover_state(&key, window, cx);
    div()
        .id(ElementId::Name(key.clone()))
        .track_focus(&geppui::button::focus_handle(
            &key,
            focus.clone(),
            window,
            cx,
        ))
        .focus_visible(move |s| {
            s.shadow(vec![
                gpui::BoxShadow::new(px(0.0), px(0.0), outline).spread_radius(m.px(2.0)),
            ])
        })
        .h(m.px(26.0))
        .px(m.px(9.0))
        .flex()
        .items_center()
        .rounded(m.px(6.0))
        .border(m.border(1.0))
        .border_color(border)
        .bg(if hovered { hover } else { bg })
        .when(hovered, |el| {
            el.shadow(vec![
                gpui::BoxShadow::new(px(0.0), px(0.0), outline).spread_radius(m.px(2.0)),
            ])
        })
        .text_size(m.px(11.0))
        .line_height(m.px(15.0))
        .font_weight(css_weight(600.0))
        .text_color(fg)
        .whitespace_nowrap()
        .cursor_pointer()
        .on_hover(geppui::button::hover_listener(state))
        .on_click(move |e, w, cx| handler(e, w, cx))
        .child(label)
        .into_any_element()
}

/// The banner centred in the global header (`top: 3px`), compact at ≤1400px.
pub fn edit_banner(
    t: &Theme,
    m: Metrics,
    viewport_width: f64,
    a: BannerActions,
    window: &mut Window,
    cx: &mut App,
) -> Div {
    let b = banner(t);
    let compact = viewport_width <= 1400.0;
    let shadow = Shadow {
        x: 0.0,
        y: 4.0,
        blur: 16.0,
        spread: 0.0,
        color: rgba(0x00000038).into(),
    };
    let label_max = if compact { 110.0 } else { 220.0 };
    div()
        .flex()
        .items_center()
        .gap(m.px(if compact { 7.0 } else { 11.0 }))
        .pl(m.px(9.0))
        .pr(m.px(5.0))
        .py(m.px(4.0))
        .min_h(m.px(38.0))
        .rounded(m.px(9.0))
        .border(m.border(1.0))
        .border_l(m.border(3.0))
        .border_color(t.accent)
        .bg(b.background)
        .shadow(vec![m.shadow(shadow)])
        .text_color(b.foreground)
        .whitespace_nowrap()
        .occlude()
        .child(
            div()
                .flex()
                .items_center()
                .gap(m.px(9.0))
                .text_size(m.px(12.0))
                .line_height(m.px(18.0))
                .when(!compact, |el| {
                    el.child(
                        div()
                            .size(m.px(26.0))
                            .p(m.px(5.0))
                            .rounded(m.px(6.0))
                            .bg(t.accent)
                            .child(
                                icon("pencil-square", m)
                                    .size(16.0)
                                    .color(rgb(0x172538).into()),
                            ),
                    )
                })
                .child(
                    div()
                        .max_w(m.px(label_max))
                        .overflow_hidden()
                        .text_ellipsis()
                        .font_weight(css_weight(650.0))
                        .child(a.label.clone()),
                ),
        )
        .when(!compact, |el| {
            el.child(
                div()
                    .pl(m.px(11.0))
                    .border_l(m.border(1.0))
                    .border_color(b.control)
                    .text_size(m.px(11.0))
                    .text_color(b.hint)
                    .child(a.hint.clone()),
            )
        })
        .child(
            div()
                .flex()
                .gap(m.px(3.0))
                .child(history_button(
                    "edit-undo",
                    "undo",
                    crate::i18n::t("Desfazer (Ctrl+Z)"),
                    a.can_undo,
                    &b,
                    m,
                    a.undo.clone(),
                    window,
                    cx,
                ))
                .child(history_button(
                    "edit-redo",
                    "redo",
                    crate::i18n::t("Refazer (Ctrl+Y ou Ctrl+Shift+Z)"),
                    a.can_redo,
                    &b,
                    m,
                    a.redo.clone(),
                    window,
                    cx,
                )),
        )
        .child(action(
            "edit-cancel",
            crate::i18n::t("Cancelar"),
            (b.foreground, b.control, b.hover, b.hover),
            t.accent,
            None,
            m,
            a.cancel.clone(),
            window,
            cx,
        ))
        .child(action(
            "edit-save",
            crate::i18n::t("Salvar edição"),
            (rgb(0x172538).into(), t.accent, t.accent, t.primary_hover),
            t.accent,
            Some(a.save_focus.clone()),
            m,
            a.save.clone(),
            window,
            cx,
        ))
        .child(action(
            "edit-conclude",
            crate::i18n::t("Concluir"),
            (
                rgb(0x132b4e).into(),
                rgb(0xf8f8f2).into(),
                rgb(0xf8f8f2).into(),
                rgb(0xe5edf7).into(),
            ),
            t.accent,
            None,
            m,
            a.conclude.clone(),
            window,
            cx,
        ))
        .when(a.saving, |el| el.opacity(0.9))
}
