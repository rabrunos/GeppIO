//! The rail's user bars and their panels (`Sidebar.tsx`, `bars/BarForm.tsx`,
//! `bars/useBarReorder.ts`):
//! - rail buttons: select, or peek when the Sidebar is hidden; right-click or Shift+F10 opens
//!   "Opções da barra"; Alt+↑/↓ reorders in Edit;
//! - the "Nova barra" / "Editar barra" form;
//! - the "Barras salvas" library with its card menu and the delete confirmation;
//! - reordering by pointer in Edit (150ms FLIP of the siblings) and restore-by-drag from
//!   the library.
//!
//! Organization changes go through `EditSession::commit_organization`, the form through
//! `EditSession::save_bar`, exactly like the reference transaction.
use std::collections::HashMap;

use geppio_core::layout::Region;
use geppio_core::workbench::model::limits;
use geppio_core::workbench::{
    HOME, UserBar, WorkbenchSnapshot, delete_bar, reorder_bar, update_bar,
};
use geppui::{
    AnchorHandle, DialogButtonKind, Placement, TextField, Transition, anchor_probe, checkbox,
    css_weight, dialog, dialog_button, icon, icon_button, menu_item, popover, popover_heading,
    select, text_action,
};
use gpui::{
    AnyElement, AppContext, Context, Div, Entity, InteractiveElement, IntoElement, KeyDownEvent,
    MouseButton, MouseDownEvent, ParentElement, Pixels, Point, SharedString,
    StatefulInteractiveElement, Styled, Window, div, point, prelude::FluentBuilder, px,
};

use crate::i18n::Tr;
use crate::panels::search_box;
use crate::workbench::Workbench;

/// The 13 icons of the bar form (`PICKER_ICONS`).
pub const PICKER_ICONS: [(&str, &str); 13] = [
    ("home", "Principal"),
    ("widgets", "Widgets"),
    ("folder", "Pasta"),
    ("notes", "Anotações"),
    ("calendar", "Calendário"),
    ("chat", "Conversas"),
    ("code", "Código"),
    ("terminal", "Terminal"),
    ("queue", "Planejamento"),
    ("clock", "Tempo"),
    ("swatch", "Design"),
    ("link", "Referências"),
    ("git", "Git"),
];

/// Bar icon names to icon assets (`BarIcon.tsx`).
pub fn bar_icon(name: &str) -> &'static str {
    match name {
        "home" => "home",
        "star" => "star",
        "code" => "code-bracket",
        "notes" => "clipboard-document-list",
        "chart" => "chart-bar",
        "library" => "rectangle-stack",
        "widgets" => "squares-2x2",
        "calendar" => "calendar-days",
        "chat" => "chat-bubble-left-right",
        "terminal" => "command-line",
        "queue" => "queue-list",
        "clock" => "clock",
        "swatch" => "swatch",
        "link" => "link",
        "git" => "git",
        _ => "folder",
    }
}

/// Rail geometry (CSS px, relative to the rail panel): the tools column starts under the
/// 52px header cell with 9px padding; bar buttons are 32px with 9px gaps.
pub const TOOLS_TOP: f32 = 52.0;
pub const BAR_PITCH: f32 = 41.0;

/// An open bar form.
pub struct BarDraft {
    pub bar: UserBar,
    pub icon: String,
    pub members: Vec<String>,
    pub picker: bool,
    pub selected_only: bool,
    pub plugin: SharedString,
    pub failed: bool,
}

/// A rail reorder in progress (Edit only).
pub struct RailDrag {
    pub id: String,
    pub origin_y: f32,
    pub pointer_y: f32,
    pub started: bool,
    /// Custom bars in their provisional order.
    pub order: Vec<String>,
}

/// A restore-by-drag from the library grip (Edit only).
pub struct RestoreDrag {
    pub id: String,
    pub label: SharedString,
    pub start: (f32, f32),
    pub pos: (f32, f32),
    pub started: bool,
}

pub struct BarsUi {
    pub context: Option<(String, Point<Pixels>)>,
    pub form: Option<BarDraft>,
    pub library: bool,
    pub library_anchor: AnchorHandle,
    pub library_menu: Option<(String, Point<Pixels>)>,
    pub library_filter: &'static str,
    pub library_sort: SharedString,
    pub library_search: Entity<TextField>,
    pub card_anchors: HashMap<String, AnchorHandle>,
    pub confirm: Option<String>,
    pub name_field: Entity<TextField>,
    pub widget_search: Entity<TextField>,
    pub reorder: Option<RailDrag>,
    pub restore: Option<RestoreDrag>,
    /// FLIP offsets of rail buttons (CSS px) animating to 0.
    pub flips: HashMap<String, Transition>,
    pub form_scroll: gpui::ScrollHandle,
    pub library_scroll: gpui::ScrollHandle,
}

impl BarsUi {
    pub fn new(cx: &mut Context<Workbench>) -> Self {
        let name_field = cx.new(|cx| TextField::new(cx).max_length(40).font(13.0, 18.0));
        let widget_search = cx.new(|cx| TextField::new(cx).font(12.0, 16.0));
        let library_search = cx.new(|cx| TextField::new(cx).font(12.0, 16.0));
        cx.subscribe(&name_field, |this, _, event, cx| match event {
            geppui::TextFieldEvent::Submitted => this.submit_bar(cx),
            geppui::TextFieldEvent::Changed => cx.notify(),
        })
        .detach();
        cx.subscribe(&widget_search, |_, _, _, cx| cx.notify())
            .detach();
        cx.subscribe(&library_search, |_, _, _, cx| cx.notify())
            .detach();
        Self {
            context: None,
            form: None,
            library: false,
            library_anchor: AnchorHandle::default(),
            library_menu: None,
            library_filter: "all",
            library_sort: "original".into(),
            library_search,
            card_anchors: HashMap::new(),
            confirm: None,
            name_field,
            widget_search,
            reorder: None,
            restore: None,
            flips: HashMap::new(),
            form_scroll: gpui::ScrollHandle::new(),
            library_scroll: gpui::ScrollHandle::new(),
        }
    }
}

fn normalize(text: &str) -> String {
    crate::catalog::normalize(text)
}

impl Workbench {
    pub(crate) fn bar_label(&self, bar: &UserBar, tr: Tr) -> SharedString {
        if bar.user_named {
            bar.name.clone().into()
        } else {
            tr.t(&bar.name)
        }
    }

    fn bars_now(&self) -> &WorkbenchSnapshot {
        self.session.draft()
    }

    fn can_restore(&self) -> bool {
        self.bars_now()
            .organization
            .bars
            .iter()
            .filter(|b| !b.archived && b.id != HOME)
            .count()
            < limits::ACTIVE_BARS
    }

    /// `change`: commits an organization change, or reports the bar limit.
    fn change_bars(&mut self, next: Option<WorkbenchSnapshot>, cx: &mut Context<Self>) -> bool {
        let now = geppui::now(cx);
        let ok = match next {
            Some(next) => {
                let ok = self
                    .session
                    .commit_organization(next, &mut self.store)
                    .is_ok();
                let message = self.session.message().to_owned();
                if ok || !message.is_empty() {
                    self.edit.toast(&message, now);
                }
                ok
            }
            None => {
                self.edit.toast("Limite de barras atingido.", now);
                false
            }
        };
        cx.notify();
        ok
    }

    pub(crate) fn select_bar(&mut self, id: &str, cx: &mut Context<Self>) {
        let active = self.bars_now().organization.active_bar.clone();
        if id == active {
            if !self.editing() {
                self.toggle_sidebar(cx);
            }
            return;
        }
        let mut next = self.bars_now().clone();
        next.organization.active_bar = id.to_owned();
        self.change_bars(Some(next), cx);
        if self.regions.sidebar_collapsed {
            self.regions.open_peek();
        }
    }

    fn reveal_sidebar(&mut self) {
        if self.regions.sidebar_collapsed && !self.regions.floating {
            self.regions.toggle_sidebar();
        } else if self.regions.floating {
            self.regions.open_peek();
        }
    }

    fn archive_bar(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(bar) = self
            .bars_now()
            .organization
            .bars
            .iter()
            .find(|b| b.id == id)
            .cloned()
        else {
            return;
        };
        let next = update_bar(
            self.bars_now(),
            &UserBar {
                archived: true,
                ..bar
            },
        );
        self.change_bars(next, cx);
    }

    fn restore_bar(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(bar) = self
            .bars_now()
            .organization
            .bars
            .iter()
            .find(|b| b.id == id)
            .cloned()
        else {
            return;
        };
        if let Some(mut next) = update_bar(
            self.bars_now(),
            &UserBar {
                archived: false,
                ..bar
            },
        ) {
            next.organization.active_bar = id.to_owned();
            if self.change_bars(Some(next), cx) {
                self.reveal_sidebar();
                self.bars.library = false;
            }
        } else {
            self.change_bars(None, cx);
        }
    }

    /// `dropBar`: unarchive if needed and insert before `before` (never before Home).
    fn drop_bar(&mut self, id: &str, before: Option<&str>, cx: &mut Context<Self>) {
        if !self.editing() || id == HOME || Some(id) == before {
            return;
        }
        let Some(bar) = self
            .bars_now()
            .organization
            .bars
            .iter()
            .find(|b| b.id == id)
            .cloned()
        else {
            return;
        };
        let was_archived = bar.archived;
        let Some(mut next) = update_bar(
            self.bars_now(),
            &UserBar {
                archived: false,
                ..bar
            },
        ) else {
            self.change_bars(None, cx);
            return;
        };
        let records = &mut next.organization.bars;
        let Some(from) = records.iter().position(|b| b.id == id) else {
            return;
        };
        let entry = records.remove(from);
        let target = before
            .and_then(|b| records.iter().position(|r| r.id == b))
            .unwrap_or(records.len());
        records.insert(target.max(1), entry);
        if was_archived {
            next.organization.active_bar = id.to_owned();
        }
        if self.change_bars(Some(next), cx) && was_archived {
            self.reveal_sidebar();
            self.bars.library = false;
        }
    }

    fn open_bar_form(&mut self, bar: UserBar, cx: &mut Context<Self>) {
        let tr = crate::i18n::tr(cx);
        let name = if bar.user_named {
            bar.name.clone()
        } else {
            tr.t(&bar.name).to_string()
        };
        self.bars.name_field.update(cx, |f, cx| {
            f.set_text(&name, cx);
            f.set_placeholder(tr.t("Ex.: Meu foco"));
        });
        self.bars.widget_search.update(cx, |f, cx| {
            f.set_text("", cx);
            f.set_placeholder(tr.t("Buscar widgets..."));
        });
        self.bars.form = Some(BarDraft {
            icon: bar.icon.clone(),
            members: bar.members.clone(),
            bar,
            picker: false,
            selected_only: false,
            plugin: "all".into(),
            failed: false,
        });
        self.bars.context = None;
        self.pending_text_focus = Some(self.bars.name_field.clone());
        cx.notify();
    }

    pub(crate) fn new_bar(&mut self, cx: &mut Context<Self>) {
        let bar = UserBar {
            id: format!("bar:{}", crate::bars::uuid()),
            name: String::new(),
            user_named: true,
            icon: "widgets".into(),
            archived: false,
            members: Vec::new(),
            positions: Default::default(),
        };
        self.bars.library = false;
        self.open_bar_form(bar, cx);
    }

    fn submit_bar(&mut self, cx: &mut Context<Self>) {
        let Some(draft) = self.bars.form.as_ref() else {
            return;
        };
        // Hidden characters (controls, bidi overrides, zero-width) never reach a bar name.
        let name: String = self
            .bars
            .name_field
            .read(cx)
            .text()
            .chars()
            .filter(|c| !crate::prefs::hidden_char(*c))
            .collect();
        let name = name.trim().to_owned();
        if name.is_empty() {
            return;
        }
        let bar = UserBar {
            name,
            user_named: true,
            icon: draft.icon.clone(),
            members: draft.members.clone(),
            ..draft.bar.clone()
        };
        let surface = self.ports.surfaces.surface(Region::Sidebar);
        let ok = self
            .session
            .save_bar(&bar, &surface, &[], &mut self.store)
            .is_ok();
        let now = geppui::now(cx);
        if ok {
            self.bars.form = None;
            let message = self.session.message().to_owned();
            self.edit.toast(&message, now);
        } else if let Some(form) = self.bars.form.as_mut() {
            form.failed = true;
        }
        cx.notify();
    }

    /// `manageBar` from the form: archive an active bar, or confirm deleting an archived one.
    fn manage_bar(&mut self, cx: &mut Context<Self>) {
        let Some(draft) = self.bars.form.take() else {
            return;
        };
        if draft.bar.archived {
            self.bars.confirm = Some(draft.bar.id);
            cx.notify();
        } else {
            self.archive_bar(&draft.bar.id, cx);
        }
    }

    fn confirm_delete(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.bars.confirm.take() {
            let next = delete_bar(self.bars_now(), &id);
            self.change_bars(next, cx);
        }
        self.bars.library = true;
        cx.notify();
    }

    /// Escape inside bar panels: palette, card menu, context menu, confirm, form, library.
    pub(crate) fn bars_escape(&mut self, cx: &mut Context<Self>) -> bool {
        let bars = &mut self.bars;
        if let Some(form) = bars.form.as_mut().filter(|f| f.picker) {
            form.picker = false;
        } else if bars.confirm.take().is_some() {
            bars.library = true;
        } else {
            // Gestures first, then the innermost open panel.
            let closed = bars.restore.take().is_some()
                || bars.reorder.take().is_some()
                || bars.library_menu.take().is_some()
                || bars.context.take().is_some()
                || bars.form.take().is_some()
                || std::mem::take(&mut bars.library);
            if !closed {
                return false;
            }
        }
        cx.notify();
        true
    }

    // ---- pointer: rail reorder and library restore ----------------------------------------

    fn custom_bars(&self) -> Vec<UserBar> {
        self.bars_now()
            .organization
            .bars
            .iter()
            .filter(|b| !b.archived && b.id != HOME)
            .cloned()
            .collect()
    }

    fn rail_down(&mut self, id: &str, y: f32) {
        if !self.editing() {
            return;
        }
        let order: Vec<String> = self.custom_bars().into_iter().map(|b| b.id).collect();
        self.bars.reorder = Some(RailDrag {
            id: id.to_owned(),
            origin_y: y,
            pointer_y: y,
            started: false,
            order,
        });
    }

    /// Pointer moves for bar gestures (window CSS px). Returns whether a gesture used it.
    pub(crate) fn bars_move(&mut self, pos: (f32, f32), cx: &mut Context<Self>) -> bool {
        let rail_top = self.rail_top();
        if let Some(drag) = self.bars.reorder.as_mut() {
            drag.pointer_y = pos.1;
            if !drag.started && (pos.1 - drag.origin_y).abs() >= 4.0 {
                drag.started = true;
            }
            if drag.started {
                // Provisional order: the dragged bar goes before the first sibling whose
                // midpoint is below the pointer.
                let first = rail_top + TOOLS_TOP + 9.0;
                let index = drag.order.iter().position(|b| *b == drag.id).unwrap_or(0);
                let others: Vec<String> = drag
                    .order
                    .iter()
                    .filter(|b| **b != drag.id)
                    .cloned()
                    .collect();
                let slot = ((pos.1 - first - 16.0) / BAR_PITCH + 0.5).floor().max(0.0) as usize;
                let slot = slot.min(others.len());
                if slot != index {
                    let before: HashMap<String, usize> = drag
                        .order
                        .iter()
                        .enumerate()
                        .map(|(i, b)| (b.clone(), i))
                        .collect();
                    let mut next = others;
                    next.insert(slot, drag.id.clone());
                    let reduced = geppui::appearance(cx).reduced_motion;
                    for (i, b) in next.iter().enumerate() {
                        let old = before.get(b).copied().unwrap_or(i);
                        if old != i && *b != drag.id && !reduced {
                            let mut t =
                                Transition::new((old as f32 - i as f32) as f64 * BAR_PITCH as f64);
                            t.request(0.0, 150.0, geppui::CubicBezier::new(0.2, 0.8, 0.2, 1.0));
                            self.bars.flips.insert(b.clone(), t);
                        }
                    }
                    drag.order = next;
                }
            }
            cx.notify();
            return true;
        }
        if let Some(drag) = self.bars.restore.as_mut() {
            drag.pos = pos;
            if !drag.started {
                let (dx, dy) = (pos.0 - drag.start.0, pos.1 - drag.start.1);
                drag.started = (dx * dx + dy * dy).sqrt() >= 5.0;
            }
            cx.notify();
            return true;
        }
        false
    }

    /// Pointer release for bar gestures.
    pub(crate) fn bars_up(&mut self, cx: &mut Context<Self>) -> bool {
        let rail_top = self.rail_top();
        if let Some(drag) = self.bars.reorder.take() {
            if drag.started {
                let inside = self.rail_tools_contains(drag.pointer_y, rail_top);
                if inside {
                    let at = drag.order.iter().position(|b| *b == drag.id).unwrap_or(0);
                    let before = drag.order.get(at + 1).cloned();
                    self.drop_bar(&drag.id, before.as_deref(), cx);
                }
            } else {
                // A short press is a click: select the bar.
                self.select_bar(&drag.id, cx);
            }
            cx.notify();
            return true;
        }
        if let Some(drag) = self.bars.restore.take() {
            if drag.started && drag.pos.0 <= geppio_core::shell::RAIL as f32 {
                let customs: Vec<UserBar> = self.custom_bars();
                let first = rail_top + TOOLS_TOP + 9.0;
                let slot = ((drag.pos.1 - first) / BAR_PITCH).floor().max(0.0) as usize;
                let before = customs.get(slot).map(|b| b.id.clone());
                self.drop_bar(&drag.id, before.as_deref(), cx);
            }
            cx.notify();
            return true;
        }
        false
    }

    fn rail_top(&self) -> f32 {
        geppio_core::shell::HEADER as f32
    }

    fn rail_tools_contains(&self, y: f32, rail_top: f32) -> bool {
        let bottom = rail_top
            + (self.viewport.1 as f32 - rail_top - geppio_core::shell::STATUS as f32) * 2.0 / 3.0;
        y >= rail_top + TOOLS_TOP && y <= bottom
    }

    // ---- rendering -------------------------------------------------------------------------

    /// The rail: Home, the custom bars column, and the footer.
    pub(crate) fn rail(
        &mut self,
        m: geppui::Metrics,
        t: geppui::Theme,
        rail: geppio_core::Rect,
        cx: &mut Context<Self>,
    ) -> Div {
        let tr = crate::i18n::tr(cx);
        let now = geppui::now(cx);
        let snapshot = self.bars_now().clone();
        let active = snapshot.organization.active_bar.clone();
        let home = snapshot.organization.bars.first().cloned();
        let theme_icon = if t.name == geppui::ThemeName::Dark {
            "moon"
        } else {
            "sun"
        };
        let can_restore = self.can_restore();
        let too_many = snapshot.organization.bars.len() > limits::SAVED_BARS;
        let limit_text = tr.f(
            "Limite de {0} barras personalizadas ativas. Arquive uma para liberar espaço.",
            &[&limits::ACTIVE_BARS.to_string()],
        );
        // Provisional order while reordering.
        let mut customs = self.custom_bars();
        if let Some(drag) = self.bars.reorder.as_ref().filter(|d| d.started) {
            customs.sort_by_key(|b| {
                drag.order
                    .iter()
                    .position(|o| *o == b.id)
                    .unwrap_or(usize::MAX)
            });
        }
        self.bars.flips.retain(|_, f| f.animating(now));
        let mut flip = HashMap::new();
        for (id, f) in self.bars.flips.iter_mut() {
            flip.insert(id.clone(), f.sample(now) as f32);
        }
        let dragging = self
            .bars
            .reorder
            .as_ref()
            .filter(|d| d.started)
            .map(|d| (d.id.clone(), d.pointer_y));
        let rail_top = self.rail_top();
        let bar_button = |this: &Self, bar: &UserBar, size: f32, glyph_size: f32| {
            let id = bar.id.clone();
            let current = bar.id == active;
            let label = this.bar_label(bar, tr);
            icon_button(
                SharedString::from(format!("bar-{}", bar.id)),
                bar_icon(&bar.icon),
            )
            .label(label)
            .size(size, glyph_size)
            .color(t.text_muted)
            .selected(current)
            .on_click(cx.listener(move |this, e: &gpui::ClickEvent, _, cx| {
                // Pointer clicks select on release via the reorder gesture in Edit.
                if !(this.editing() && id != HOME && e.standard_click()) || e.is_keyboard() {
                    this.select_bar(&id, cx)
                }
            }))
        };
        let custom_buttons: Vec<AnyElement> = customs
            .iter()
            .enumerate()
            .map(|(i, bar)| {
                let id = bar.id.clone();
                let context_id = bar.id.clone();
                let key_id = bar.id.clone();
                let natural = TOOLS_TOP + 9.0 + i as f32 * BAR_PITCH;
                let (dy, dragged) = match &dragging {
                    Some((d, py)) if *d == bar.id => (*py - rail_top - natural - 16.0, true),
                    _ => (flip.get(&bar.id).copied().unwrap_or(0.0), false),
                };
                div()
                    .id(SharedString::from(format!("rail-bar-{}", bar.id)))
                    .absolute()
                    .left(m.px(8.0))
                    .top(m.px(natural + dy))
                    .rounded(m.px(8.0))
                    .when(dragged, |el| {
                        el.bg(t.accent_soft).shadow(vec![
                            gpui::BoxShadow::new(
                                m.px(0.0),
                                m.px(3.0),
                                gpui::hsla(0.0, 0.0, 0.0, 0.15),
                            )
                            .blur_radius(m.px(10.0)),
                        ])
                    })
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                            let y = this.metrics.css(e.position.y);
                            this.rail_down(&id, y);
                            cx.notify();
                        }),
                    )
                    .on_mouse_down(
                        MouseButton::Right,
                        cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                            this.bars.context = Some((context_id.clone(), e.position));
                            cx.notify();
                        }),
                    )
                    .on_key_down(cx.listener(move |this, e: &KeyDownEvent, _, cx| {
                        let k = &e.keystroke;
                        if k.key == "f10" && k.modifiers.shift {
                            let y = rail_top + natural;
                            let p = point(this.metrics.px(48.0 - 8.0), this.metrics.px(y));
                            this.bars.context = Some((key_id.clone(), p));
                            cx.stop_propagation();
                            cx.notify();
                        } else if this.editing()
                            && k.modifiers.alt
                            && (k.key == "up" || k.key == "down")
                        {
                            let next = reorder_bar(
                                this.session.draft(),
                                &key_id,
                                if k.key == "up" { -1 } else { 1 },
                            );
                            this.change_bars(next, cx);
                            cx.stop_propagation();
                        }
                    }))
                    .child(bar_button(self, bar, 32.0, 20.0))
                    .into_any_element()
            })
            .collect();
        let reorder_zone = dragging.as_ref().map(|(_, py)| {
            let over = self.rail_tools_contains(*py, rail_top);
            let h = (rail.h as f32) * 2.0 / 3.0 - TOOLS_TOP - 4.0;
            div()
                .absolute()
                .left(m.px(2.0))
                .top(m.px(TOOLS_TOP + 2.0))
                .w(m.px(geppio_core::shell::RAIL as f32 - 4.0))
                .h(m.px(h))
                .rounded(m.px(12.0))
                .bg(t.accent.opacity(if over { 0.07 } else { 0.03 }))
                .child(geppui::dashed_outline(
                    geppio_core::shell::RAIL - 4.0,
                    h as f64,
                    m,
                    t.accent.opacity(if over { 0.65 } else { 0.5 }),
                ))
        });
        let restore_zone = self.bars.restore.as_ref().filter(|d| d.started).map(|d| {
            let over = d.pos.0 <= geppio_core::shell::RAIL as f32;
            let h = (rail.h as f32) * 2.0 / 3.0 - TOOLS_TOP - 4.0;
            div()
                .absolute()
                .left(m.px(2.0))
                .top(m.px(TOOLS_TOP + 2.0))
                .w(m.px(geppio_core::shell::RAIL as f32 - 4.0))
                .h(m.px(h))
                .rounded(m.px(12.0))
                .bg(t.accent.opacity(if over { 0.07 } else { 0.03 }))
                .child(geppui::dashed_outline(
                    geppio_core::shell::RAIL - 4.0,
                    h as f64,
                    m,
                    t.accent.opacity(if over { 0.65 } else { 0.5 }),
                ))
        });
        let home_button = home.as_ref().map(|h| bar_button(self, h, 34.0, 23.0));
        crate::workbench::abs(m, rail.into())
            .bg(t.region)
            .child(
                div()
                    .id("rail-primary")
                    .absolute()
                    .left_0()
                    .top_0()
                    .w(m.px(geppio_core::shell::RAIL as f32))
                    .h(m.px((rail.h * 2.0 / 3.0) as f32))
                    .on_hover(
                        cx.listener(|this, hovered: &bool, _, cx| this.peek_hover(*hovered, cx)),
                    )
                    .when_some(home_button, |el, b| {
                        el.child(div().absolute().left(m.px(7.0)).top(m.px(13.5)).child(b))
                    })
                    .child(
                        div()
                            .id("rail-tools")
                            .absolute()
                            .left_0()
                            .top_0()
                            .size_full()
                            .overflow_hidden()
                            .children(custom_buttons),
                    )
                    .children(reorder_zone)
                    .children(restore_zone),
            )
            .child(
                div()
                    .absolute()
                    .left(m.px(8.0))
                    .bottom(m.px(9.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(9.0))
                    .child(
                        div()
                            .relative()
                            .child(anchor_probe(&self.bars.library_anchor))
                            .child(
                                icon_button("saved-bars", "folder")
                                    .label(tr.t("Barras salvas"))
                                    .color(t.text)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.bars.library = !this.bars.library;
                                        this.bars.library_menu = None;
                                        if this.bars.library {
                                            this.bars
                                                .library_search
                                                .update(cx, |f, cx| f.set_text("", cx));
                                            this.pending_text_focus =
                                                Some(this.bars.library_search.clone());
                                        }
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(
                        icon_button("new-bar", "plus")
                            .label(if can_restore {
                                tr.t("Nova barra")
                            } else {
                                limit_text.clone()
                            })
                            .color(t.text)
                            .disabled(too_many || !can_restore)
                            .on_click(cx.listener(|this, _, _, cx| this.new_bar(cx))),
                    )
                    .child(
                        icon_button("toggle-theme", theme_icon)
                            .label(tr.t("Alternar tema"))
                            .color(t.text)
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_theme(cx))),
                    ),
            )
    }

    /// Bar overlays: context menu, library (+ card menu), form, delete confirmation, ghost.
    pub(crate) fn bar_overlays(
        &mut self,
        m: geppui::Metrics,
        t: geppui::Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let tr = crate::i18n::tr(cx);
        let mut out = Vec::new();
        if let Some((id, at)) = self.bars.context.clone() {
            let bar = self
                .bars_now()
                .organization
                .bars
                .iter()
                .find(|b| b.id == id)
                .cloned();
            if let Some(bar) = bar {
                let edit_bar = bar.clone();
                let archive_id = bar.id.clone();
                let close = cx.listener(|this, _: &(), _, cx| {
                    this.bars.context = None;
                    cx.notify();
                });
                let close = std::rc::Rc::new(close);
                let (c1, c2) = (close.clone(), close.clone());
                let mut items = vec![SharedString::from("bar-context-edit")];
                if bar.id != HOME {
                    items.push("bar-context-archive".into());
                }
                out.push(
                    popover("bar-context", &AnchorHandle::default())
                        .placement(Placement::At(at))
                        .width(190.0)
                        .padding(5.0, 5.0)
                        .menu(items)
                        .on_dismiss(move |w, cx| c1(&(), w, cx))
                        .on_escape(move |w, cx| c2(&(), w, cx))
                        .child(
                            menu_item("bar-context-edit", tr.t("Editar"))
                                .icon("pencil-square")
                                .compact()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.open_bar_form(edit_bar.clone(), cx)
                                })),
                        )
                        .when(bar.id != HOME, |el| {
                            el.child(
                                menu_item("bar-context-archive", tr.t("Arquivar"))
                                    .icon("archive-box")
                                    .compact()
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.bars.context = None;
                                        this.archive_bar(&archive_id, cx)
                                    })),
                            )
                        })
                        .into_any_element(),
                );
            }
        }
        if self.bars.library {
            out.push(self.bars_library(m, t, tr, window, cx));
            if let Some(menu) = self.library_menu(tr, cx) {
                out.push(menu);
            }
        }
        if self.bars.form.is_some() {
            out.push(self.bar_form(m, t, tr, window, cx));
        }
        if let Some(id) = self.bars.confirm.clone() {
            let name = self
                .bars_now()
                .organization
                .bars
                .iter()
                .find(|b| b.id == id)
                .map(|b| b.name.clone())
                .unwrap_or_default();
            out.push(
                dialog("bar-delete", tr.f("Excluir {0}?", &[&name]))
                    .close_label(tr.t("Fechar"))
                    .on_dismiss({
                        let view = cx.entity().downgrade();
                        move |_, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.bars.confirm = None;
                                this.bars.library = true;
                                cx.notify();
                            });
                        }
                    })
                    .child(
                        div()
                            .mt(m.px(9.0))
                            .text_color(t.text_muted)
                            .line_height(m.px(13.0 * 1.6))
                            .child(tr.t("A barra arquivada será excluída. Seus widgets e plugins continuam disponíveis.")),
                    )
                    .child(
                        div()
                            .mt(m.px(22.0))
                            .flex()
                            .justify_end()
                            .gap(m.px(9.0))
                            .child(
                                dialog_button("bar-delete-cancel", tr.t("Cancelar"), DialogButtonKind::Secondary)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.bars.confirm = None;
                                        this.bars.library = true;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                dialog_button("bar-delete-confirm", tr.t("Excluir barra"), DialogButtonKind::Destructive)
                                    .on_click(cx.listener(|this, _, _, cx| this.confirm_delete(cx))),
                            ),
                    )
                    .into_any_element(),
            );
        }
        if let Some(drag) = self.bars.restore.as_ref().filter(|d| d.started) {
            out.push(
                gpui::deferred(
                    div()
                        .absolute()
                        .left(m.px(drag.pos.0 + 14.0))
                        .top(m.px(drag.pos.1 + 12.0))
                        .px(m.px(11.0))
                        .py(m.px(9.0))
                        .rounded(m.px(8.0))
                        .border(m.border(1.0))
                        .border_color(t.accent_border)
                        .bg(t.surface)
                        .text_color(t.text)
                        .text_size(m.px(12.0))
                        .shadow(vec![
                            gpui::BoxShadow::new(
                                m.px(0.0),
                                m.px(8.0),
                                gpui::hsla(0.0, 0.0, 0.0, 0.2),
                            )
                            .blur_radius(m.px(24.0)),
                        ])
                        .child(drag.label.clone()),
                )
                .with_priority(4)
                .into_any_element(),
            );
        }
        out
    }

    fn library_menu(&mut self, tr: Tr, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (id, at) = self.bars.library_menu.clone()?;
        let bar = self
            .bars_now()
            .organization
            .bars
            .iter()
            .find(|b| b.id == id)
            .cloned()?;
        let archived = bar.archived;
        let edit_bar = bar.clone();
        let act_id = bar.id.clone();
        let mut items = Vec::new();
        if archived {
            items.push(SharedString::from("bar-library-menu-edit"));
        }
        items.push("bar-library-menu-act".into());
        let close = std::rc::Rc::new(cx.listener(|this, _: &(), _, cx| {
            this.bars.library_menu = None;
            cx.notify();
        }));
        let (c1, c2) = (close.clone(), close.clone());
        let act = menu_item(
            "bar-library-menu-act",
            tr.t(if archived {
                "Excluir barra"
            } else {
                "Arquivar barra"
            }),
        )
        .compact()
        .on_click(cx.listener(move |this, _, _, cx| {
            this.bars.library_menu = None;
            if archived {
                this.bars.library = false;
                this.bars.confirm = Some(act_id.clone());
                cx.notify();
            } else {
                this.archive_bar(&act_id, cx);
            }
        }));
        let act = if archived { act.destructive() } else { act };
        Some(
            popover("bar-library-menu", &AnchorHandle::default())
                .placement(Placement::At(at))
                .width(190.0)
                .padding(5.0, 5.0)
                .menu(items)
                .on_dismiss(move |w, cx| c1(&(), w, cx))
                .on_escape(move |w, cx| c2(&(), w, cx))
                .when(archived, |el| {
                    el.child(
                        menu_item("bar-library-menu-edit", tr.t("Editar"))
                            .compact()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.bars.library = false;
                                this.bars.library_menu = None;
                                this.open_bar_form(edit_bar.clone(), cx)
                            })),
                    )
                })
                .child(act)
                .into_any_element(),
        )
    }

    fn bars_library(
        &mut self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let close = std::rc::Rc::new(cx.listener(|this, _: &(), _, cx| {
            this.bars.library = false;
            this.bars.library_menu = None;
            cx.notify();
        }));
        let (c1, c2, c3) = (close.clone(), close.clone(), close.clone());
        let heading = popover_heading(
            "bars-library-heading",
            tr.t("Barras salvas"),
            Some(tr.t("Encontre suas barras e retome seu espaço.")),
            tr.t("Fechar"),
            move |w, cx| c3(&(), w, cx),
            window,
            cx,
        )
        .into_any_element();
        let focused = self.bars.library_search.read(cx).is_focused(window);
        self.bars
            .library_search
            .update(cx, |f, _| f.set_placeholder(tr.t("Buscar barra...")));
        let search = normalize(self.bars.library_search.read(cx).text());
        let editing = self.editing();
        let can_restore = self.can_restore();
        let bars = self.bars_now().organization.bars.clone();
        let registry = self.session.registry().clone();
        let filter = self.bars.library_filter;
        let mut filtered: Vec<UserBar> = bars
            .iter()
            .filter(|b| match filter {
                "active" => !b.archived,
                "archived" => b.archived,
                _ => true,
            })
            .filter(|b| normalize(&self.bar_label(b, tr)).contains(&search))
            .cloned()
            .collect();
        if self.bars.library_sort.as_ref() == "name" {
            filtered.sort_by_key(|b| normalize(&self.bar_label(b, tr)));
        }
        let count = |id: &str| {
            bars.iter()
                .filter(|b| match id {
                    "active" => !b.archived,
                    "archived" => b.archived,
                    _ => true,
                })
                .count()
        };
        let filter_button = |id: &'static str, label: &str| {
            let pressed = filter == id;
            div()
                .id(SharedString::from(format!("bar-filter-{id}")))
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .gap(m.px(7.0))
                .min_h(m.px(32.0))
                .px(m.px(7.0))
                .py(m.px(4.0))
                .rounded(m.px(7.0))
                .text_size(m.px(11.0))
                .cursor_pointer()
                .text_color(if pressed { t.accent } else { t.text_muted })
                .when(pressed, |el| el.bg(t.accent_soft))
                .when(!pressed, |el| el.hover(move |s| s.bg(t.control_hover)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.bars.library_filter = id;
                    cx.notify();
                }))
                .child(tr.t(label))
                .child(
                    div()
                        .text_size(m.px(10.0))
                        .opacity(0.8)
                        .child(count(id).to_string()),
                )
        };
        for bar in &filtered {
            self.bars.card_anchors.entry(bar.id.clone()).or_default();
        }
        let single = filtered.len() == 1;
        let columns = if filtered.len() == 2 { 2 } else { 3 };
        let cards: Vec<AnyElement> = filtered
            .iter()
            .map(|bar| {
                let label = self.bar_label(bar, tr);
                let status = tr.t(if bar.id == HOME {
                    "Principal"
                } else if bar.archived {
                    "Arquivada"
                } else {
                    "Na barrinha"
                });
                let anchor = self
                    .bars
                    .card_anchors
                    .get(&bar.id)
                    .cloned()
                    .unwrap_or_default();
                let more_anchor = anchor.clone();
                let action_id = bar.id.clone();
                let action_bar = bar.clone();
                let more_id = bar.id.clone();
                let grip_id = bar.id.clone();
                let grip_label = label.clone();
                let archived = bar.archived;
                let preview = bar.members.iter().take(3).map(|member| {
                    let _ = registry.get(member);
                    icon(crate::catalog::glyph(member), m)
                        .size(13.0)
                        .color(t.text_muted)
                });
                let action = div()
                    .id(SharedString::from(format!("bar-card-action-{}", bar.id)))
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .min_h(m.px(28.0))
                    .px(m.px(7.0))
                    .py(m.px(4.0))
                    .rounded(m.px(6.0))
                    .border(m.border(1.0))
                    .text_size(m.px(11.0))
                    .line_height(m.px(18.0))
                    .when(archived, |el| {
                        el.border_color(t.accent_border)
                            .bg(t.accent_soft)
                            .text_color(t.accent)
                    })
                    .when(!archived, |el| {
                        el.border_color(t.border)
                            .text_color(t.text_muted)
                            .hover(move |s| s.bg(t.control_hover).text_color(t.text))
                    })
                    .when(archived && !can_restore, |el| el.opacity(0.5))
                    .when(!archived || can_restore, |el| {
                        el.cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if archived {
                                    this.restore_bar(&action_id, cx)
                                } else {
                                    this.bars.library = false;
                                    this.open_bar_form(action_bar.clone(), cx)
                                }
                            }))
                    })
                    .child(tr.t(if archived { "Restaurar" } else { "Editar" }));
                let small_button = |id: String| {
                    div()
                        .id(SharedString::from(id))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(m.px(28.0))
                        .rounded(m.px(6.0))
                        .text_color(t.text_muted)
                        .hover(move |s| s.bg(t.control_hover))
                };
                let top_icon = div()
                    .size(m.px(24.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon(bar_icon(&bar.icon), m).size(21.0).color(t.accent));
                let status_el = div()
                    .text_size(m.px(9.0))
                    .line_height(m.px(15.0))
                    .text_color(t.text_muted)
                    .whitespace_nowrap()
                    .child(status);
                let name_el = div()
                    .min_h(m.px(16.0))
                    .text_size(m.px(12.0))
                    .line_height(m.px(16.0))
                    .font_weight(css_weight(600.0))
                    .line_clamp(2)
                    .child(label);
                let preview_el = div()
                    .flex()
                    .items_center()
                    .gap(m.px(4.0))
                    .h(m.px(16.0))
                    .children(preview)
                    .child(div().flex_1())
                    .child(
                        div()
                            .text_size(m.px(10.0))
                            .text_color(t.text_muted)
                            .child(tr.f("{0} widgets", &[&bar.members.len().to_string()])),
                    );
                let actions_el = div()
                    .flex()
                    .gap(m.px(5.0))
                    .child(action)
                    .when(archived && editing, |el| {
                        el.child(
                            small_button(format!("bar-card-grip-{grip_id}"))
                                .cursor_grab()
                                .on_mouse_down(
                                    MouseButton::Left,
                                    cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                                        let pos = (
                                            this.metrics.css(e.position.x),
                                            this.metrics.css(e.position.y),
                                        );
                                        this.bars.restore = Some(RestoreDrag {
                                            id: grip_id.clone(),
                                            label: grip_label.clone(),
                                            start: pos,
                                            pos,
                                            started: false,
                                        });
                                        cx.stop_propagation();
                                    }),
                                )
                                .child(div().text_size(m.px(18.0)).child("⠿")),
                        )
                    })
                    .when(bar.id != HOME, |el| {
                        el.child(
                            small_button(format!("bar-card-more-{more_id}"))
                                .relative()
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let at = more_anchor.bounds().map(|b| {
                                        point(
                                            b.origin.x + b.size.width,
                                            b.origin.y + b.size.height + this.metrics.px(4.0),
                                        )
                                    });
                                    let same = this
                                        .bars
                                        .library_menu
                                        .as_ref()
                                        .is_some_and(|(id, _)| *id == more_id);
                                    this.bars.library_menu = if same {
                                        None
                                    } else {
                                        at.map(|p| (more_id.clone(), p))
                                    };
                                    cx.notify();
                                }))
                                .child(anchor_probe(&anchor))
                                .child(
                                    icon("ellipsis-horizontal", m)
                                        .size(16.0)
                                        .color(t.text_muted),
                                ),
                        )
                    });
                let card = div()
                    .p(m.px(9.0))
                    .rounded(m.px(10.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.input);
                if single {
                    // A lone card spans the row: icon and status, name and preview, actions.
                    card.flex()
                        .items_center()
                        .gap(m.px(11.0))
                        .child(
                            div()
                                .w(m.px(70.0))
                                .flex_none()
                                .flex()
                                .flex_col()
                                .items_center()
                                .gap(m.px(5.0))
                                .child(top_icon)
                                .child(status_el),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(m.px(5.0))
                                .child(name_el)
                                .child(preview_el),
                        )
                        .child(actions_el.min_w(m.px(110.0)))
                        .into_any_element()
                } else {
                    card.flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(m.px(6.0))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(top_icon)
                                .child(status_el),
                        )
                        .child(name_el)
                        .child(preview_el)
                        .child(actions_el.mt_auto())
                        .into_any_element()
                }
            })
            .collect();
        let rows: Vec<AnyElement> = if single {
            cards
        } else {
            let mut rows = Vec::new();
            let mut cards = cards.into_iter().peekable();
            while cards.peek().is_some() {
                let row: Vec<AnyElement> = cards.by_ref().take(columns).collect();
                let pad = columns - row.len();
                rows.push(
                    div()
                        .flex()
                        .gap(m.px(11.0))
                        .children(row)
                        .children((0..pad).map(|_| div().flex_1()))
                        .into_any_element(),
                );
            }
            rows
        };
        let hint = if !can_restore {
            tr.f(
                "Limite de {0} barras personalizadas ativas. Arquive uma para liberar espaço.",
                &[&limits::ACTIVE_BARS.to_string()],
            )
        } else {
            tr.t(if editing {
                "Restaure ou arraste uma barra arquivada para a barrinha."
            } else {
                "Arquive para guardar. Restaure quando precisar."
            })
        };
        let dragging = self.bars.restore.as_ref().is_some_and(|d| d.started);
        let too_many = bars.len() > limits::SAVED_BARS;
        // The viewport is as tall as its rows (cards about 112px, 9px gaps), up to 380px.
        let row_count = if filtered.is_empty() {
            0
        } else if single {
            1
        } else {
            filtered.len().div_ceil(columns)
        };
        let library_height = if filtered.is_empty() {
            170.0
        } else {
            // Card: 2 border + 18 padding + 24 icon row + 16 name + 16 preview + 28 actions +
            // 3 × 6 gaps = 122; a lone card is one 64px row. Rows have 9px gaps, 3px padding.
            let card = if single { 64.0 } else { 122.0 };
            (row_count as f32 * card + (row_count as f32 - 1.0) * 9.0 + 6.0).min(380.0)
        };
        popover("bars-library", &self.bars.library_anchor)
            .placement(Placement::Rail)
            .width(600.0)
            .padding(18.0, 18.0)
            .max_height(620.0)
            .contained()
            .on_dismiss(move |w, cx| c1(&(), w, cx))
            .on_escape(move |w, cx| c2(&(), w, cx))
            .child(
                div()
                    .mb(m.px(2.0))
                    .when(dragging, |el| el.opacity(0.35))
                    .child(heading),
            )
            .child(
                div()
                    .when(dragging, |el| el.opacity(0.35))
                    .flex()
                    .gap(m.px(11.0))
                    .child(div().flex_1().child(search_box(
                        &self.bars.library_search,
                        focused,
                        m,
                        t,
                    )))
                    .child(
                        div().w(m.px(137.0)).child(
                            select(
                                "bars-sort",
                                vec![
                                    ("original".into(), tr.t("Ordem original")),
                                    ("name".into(), tr.t("Nome (A–Z)")),
                                ],
                                self.bars.library_sort.clone(),
                            )
                            .label(tr.t("Ordenar barras"))
                            .metrics(36.0, 11.0, 15.0)
                            .on_change(cx.listener(
                                |this, v: &SharedString, _, cx| {
                                    this.bars.library_sort = v.clone();
                                    cx.notify();
                                },
                            )),
                        ),
                    ),
            )
            .child(
                div()
                    .when(dragging, |el| el.opacity(0.35))
                    .flex()
                    .gap(m.px(7.0))
                    .py(m.px(9.0))
                    .child(filter_button("all", "Todas"))
                    .child(filter_button("active", "Na barrinha"))
                    .child(filter_button("archived", "Arquivadas")),
            )
            .child(
                div()
                    .when(dragging, |el| el.opacity(0.35))
                    .flex_1()
                    .min_h_0()
                    .max_h(m.px(380.0))
                    .h(m.px(library_height))
                    .child(
                        geppui::scroll_area("bars-library-viewport", &self.bars.library_scroll)
                            .gutter(11.0, 5.0)
                            .arrows(true)
                            .child(
                                div()
                                    .px(m.px(8.0))
                                    .py(m.px(3.0))
                                    .flex()
                                    .flex_col()
                                    .gap(m.px(9.0))
                                    .children(rows),
                            ),
                    )
                    .when(filtered.is_empty(), |el| {
                        el.child(
                            div()
                                .absolute()
                                .top_0()
                                .left_0()
                                .w_full()
                                .flex()
                                .flex_col()
                                .items_center()
                                .gap(m.px(9.0))
                                .px(m.px(11.0))
                                .py(m.px(30.0))
                                .text_size(m.px(12.0))
                                .text_color(t.text_muted)
                                .child(
                                    div().opacity(0.6).child(
                                        icon("squares-2x2", m).size(30.0).color(t.text_muted),
                                    ),
                                )
                                .child(
                                    div()
                                        .text_color(t.text)
                                        .child(tr.t("Nenhuma barra encontrada")),
                                )
                                .child(
                                    div()
                                        .text_size(m.px(11.0))
                                        .child(tr.t("Tente outro nome ou limpe os filtros.")),
                                )
                                .child(text_action("bars-clear", tr.t("Limpar filtros")).on_click(
                                    cx.listener(|this, _, _, cx| {
                                        this.bars.library_filter = "all";
                                        this.bars.library_sort = "original".into();
                                        this.bars
                                            .library_search
                                            .update(cx, |f, cx| f.set_text("", cx));
                                        cx.notify();
                                    }),
                                )),
                        )
                    }),
            )
            .child(
                div()
                    .when(dragging, |el| el.opacity(0.35))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(m.px(18.0))
                    .mt(m.px(13.0))
                    .pt(m.px(13.0))
                    .border_t(m.border(1.0))
                    .border_color(t.border)
                    .child(
                        div()
                            .max_w(m.px(340.0))
                            .text_size(m.px(11.0))
                            .line_height(m.px(16.0))
                            .text_color(t.text_muted)
                            .child(hint),
                    )
                    .child(
                        primary_button(
                            "bars-new",
                            Some("plus"),
                            tr.t("Nova barra"),
                            !can_restore || too_many,
                            m,
                            t,
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.new_bar(cx))),
                    ),
            )
            .into_any_element()
    }

    fn bar_form(
        &mut self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let name_focused = self.bars.name_field.read(cx).is_focused(window);
        let search_focused = self.bars.widget_search.read(cx).is_focused(window);
        let name_empty = self.bars.name_field.read(cx).text().trim().is_empty();
        let search = normalize(self.bars.widget_search.read(cx).text());
        let sidebar_width = self.ports.surfaces.sizes.sidebar.width;
        let registry = self.session.registry().clone();
        let draft = self.bars.form.as_ref().expect("form open");
        let original = draft.bar.clone();
        let title = if original.id == HOME {
            "Editar barra principal"
        } else if !original.name.is_empty() {
            "Editar barra"
        } else {
            "Nova barra"
        };
        let types: Vec<_> = registry
            .types()
            .iter()
            .filter(|ty| {
                !ty.retired && !ty.missing && ty.constraint.regions.contains(&Region::Sidebar)
            })
            .cloned()
            .collect();
        let shown: Vec<_> = types
            .iter()
            .filter(|ty| draft.plugin.as_ref() == "all" || ty.owner == draft.plugin.as_ref())
            .filter(|ty| !draft.selected_only || draft.members.contains(&ty.id))
            .filter(|ty| {
                let title = if ty.owner == "host" {
                    tr.t(&ty.title).to_string()
                } else {
                    ty.title.clone()
                };
                normalize(&format!("{title} {}", ty.description)).contains(&search)
            })
            .cloned()
            .collect();
        let members = draft.members.clone();
        let selected_only = draft.selected_only;
        let picker = draft.picker;
        let icon_name = draft.icon.clone();
        let failed = draft.failed;
        let owners: Vec<(SharedString, SharedString)> =
            std::iter::once(("all".into(), tr.t("Todos os plugins")))
                .chain(
                    types
                        .iter()
                        .map(|ty| ty.owner.clone())
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .map(|o| {
                            let label: SharedString = if o == "host" {
                                "GeppIO".into()
                            } else {
                                o.clone().into()
                            };
                            (o.into(), label)
                        }),
                )
                .collect();
        let plugin = draft.plugin.clone();
        let cards: Vec<AnyElement> = shown
            .iter()
            .map(|ty| {
                let checked = members.contains(&ty.id);
                let too_wide = !checked
                    && sidebar_width > 0.0
                    && geppio_core::freeform::constraint_in_region(&ty.constraint, Region::Sidebar)
                        .min
                        .width
                        > sidebar_width;
                let toggle_id = ty.id.clone();
                let toggle_id2 = ty.id.clone();
                let toggle = move |this: &mut Self, on: bool, cx: &mut Context<Self>| {
                    if let Some(form) = this.bars.form.as_mut() {
                        if on {
                            if !form.members.contains(&toggle_id) {
                                form.members.push(toggle_id.clone());
                            }
                        } else {
                            form.members.retain(|m| *m != toggle_id);
                        }
                    }
                    cx.notify();
                };
                let toggle2 = toggle.clone();
                let title = if ty.owner == "host" {
                    tr.t(&ty.title)
                } else {
                    ty.title.clone().into()
                };
                let owner: SharedString = if ty.owner == "host" {
                    "GeppIO".into()
                } else {
                    ty.description.clone().into()
                };
                div()
                    .id(SharedString::from(format!("bar-widget-{toggle_id2}")))
                    .flex_1()
                    .flex()
                    .items_center()
                    .gap(m.px(8.0))
                    .min_h(m.px(54.0))
                    .px(m.px(9.0))
                    .py(m.px(7.0))
                    .rounded(m.px(8.0))
                    .border(m.border(1.0))
                    .border_color(if checked { t.accent_border } else { t.border })
                    .when(checked, |el| el.bg(t.accent_soft))
                    .when(too_wide, |el| el.opacity(0.45))
                    .when(!too_wide && !checked, |el| {
                        el.hover(move |s| s.bg(t.control_hover))
                    })
                    .when(!too_wide, |el| {
                        el.cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| toggle(this, !checked, cx)))
                    })
                    .child(
                        checkbox(
                            SharedString::from(format!("bar-widget-check-{toggle_id2}")),
                            checked,
                        )
                        .disabled(too_wide)
                        .on_toggle(
                            cx.listener(move |this, on: &bool, _, cx| toggle2(this, *on, cx)),
                        ),
                    )
                    .child(
                        icon(crate::catalog::glyph(&ty.id), m)
                            .size(19.0)
                            .color(t.text_muted),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(m.px(11.0))
                                    .line_height(m.px(15.0))
                                    .font_weight(css_weight(550.0))
                                    .child(title),
                            )
                            .child(
                                div()
                                    .text_size(m.px(10.0))
                                    .line_height(m.px(14.0))
                                    .text_color(t.text_muted)
                                    .child(owner),
                            ),
                    )
                    .into_any_element()
            })
            .collect();
        let mut rows = Vec::new();
        let mut cards = cards.into_iter().peekable();
        while cards.peek().is_some() {
            let row: Vec<AnyElement> = cards.by_ref().take(2).collect();
            let pad = 2 - row.len();
            rows.push(
                div()
                    .flex()
                    .gap(m.px(11.0))
                    .children(row)
                    .children((0..pad).map(|_| div().flex_1()))
                    .into_any_element(),
            );
        }
        let palette = picker.then(|| {
            div()
                .absolute()
                .right_0()
                // Under the 20px label, 9px gap and 36px summary, plus the 9px offset.
                .top(m.px(20.0 + 9.0 + 36.0 + 9.0))
                .w(m.px(302.0))
                .p(m.px(11.0))
                .rounded(m.px(10.0))
                .border(m.border(1.0))
                .border_color(t.border)
                .bg(t.surface)
                .shadow(vec![
                    gpui::BoxShadow::new(m.px(0.0), m.px(8.0), gpui::hsla(0.0, 0.0, 0.0, 0.16))
                        .blur_radius(m.px(24.0)),
                ])
                .flex()
                .flex_col()
                .gap(m.px(7.0))
                .children(PICKER_ICONS.chunks(7).map(|row| {
                    div()
                        .flex()
                        .gap(m.px(7.0))
                        .children(row.iter().map(|(name, label)| {
                            let chosen = icon_name == *name;
                            let pick = (*name).to_owned();
                            div()
                                .id(SharedString::from(format!("bar-icon-{name}")))
                                .flex_1()
                                .min_w_0()
                                .h(m.px(32.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(m.px(7.0))
                                .border(m.border(1.0))
                                .border_color(if chosen { t.accent_border } else { t.border })
                                .when(chosen, |el| el.bg(t.accent_soft))
                                .cursor_pointer()
                                .tooltip({
                                    let label = tr.t(label);
                                    move |_, cx| geppui::button::tooltip_view(label.clone(), cx)
                                })
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    if let Some(form) = this.bars.form.as_mut() {
                                        form.icon = pick.clone();
                                        form.picker = false;
                                    }
                                    let summary = geppui::button::focus_handle(
                                        &"bar-icon-picker".into(),
                                        None,
                                        window,
                                        cx,
                                    );
                                    window.focus(&summary, cx);
                                    cx.notify();
                                }))
                                .child(icon(bar_icon(name), m).size(17.0).color(if chosen {
                                    t.accent
                                } else {
                                    t.text_muted
                                }))
                        }))
                        .children((row.len()..7).map(|_| div().flex_1()))
                }))
        });
        let field_box = |focused: bool| {
            div()
                .flex()
                .items_center()
                .h(m.px(36.0))
                .px(m.px(11.0))
                .rounded(m.px(7.0))
                .border(m.border(1.0))
                .border_color(t.input_border)
                .bg(t.input)
                .font_weight(css_weight(400.0))
                .when(focused, |el| {
                    el.shadow(vec![
                        gpui::BoxShadow::new(px(0.0), px(0.0), t.ring).spread_radius(m.px(2.0)),
                    ])
                })
        };
        let editing_existing = original.id != HOME && !original.name.is_empty();
        let archived = original.archived;
        let close = std::rc::Rc::new(cx.listener(|this, _: &(), _, cx| {
            this.bars.form = None;
            cx.notify();
        }));
        let c1 = close.clone();
        let height =
            (f32::from(window.viewport_size().height) / f32::from(m.px(1.0)) - 18.0).min(570.0);
        let summary_focus =
            geppui::button::focus_handle(&"bar-icon-picker".into(), None, window, cx);
        dialog("bar-form", tr.t(title))
            .width(580.0)
            .close_label(tr.t("Fechar"))
            .on_dismiss(move |w, cx| c1(&(), w, cx))
            .child(
                div()
                    .h(m.px(height - 36.0 - 2.0 - 32.0))
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .mt(m.px(9.0))
                            .text_color(t.text_muted)
                            .line_height(m.px(13.0 * 1.6))
                            .child(tr.t("Dê um nome, escolha um ícone e combine seus widgets.")),
                    )
                    .child(
                        div()
                            .mt(m.px(18.0))
                            .relative()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .flex_col()
                            .gap(m.px(9.0))
                            .child(
                                div()
                                    .relative()
                                    .flex()
                                    .gap(m.px(11.0))
                                    .child(
                                        div()
                                            .flex_1()
                                            .flex()
                                            .flex_col()
                                            .gap(m.px(9.0))
                                            .font_weight(css_weight(500.0))
                                            .child(div().line_height(m.px(20.0)).child(tr.t("Nome")))
                                            .child(field_box(name_focused).child(self.bars.name_field.clone())),
                                    )
                                    .child(
                                        div()
                                            .w(m.px(72.0))
                                            .flex()
                                            .flex_col()
                                            .gap(m.px(9.0))
                                            .child(
                                                div()
                                                    .line_height(m.px(20.0))
                                                    .font_weight(css_weight(500.0))
                                                    .child(tr.t("Ícone")),
                                            )
                                            .child(
                                                div()
                                                    .id("bar-icon-picker")
                                                    .track_focus(&summary_focus)
                                                    .hover(move |s| s.bg(t.control_hover))
                                                    .h(m.px(36.0))
                                                    .flex()
                                                    .items_center()
                                                    .justify_between()
                                                    .px(m.px(11.0))
                                                    .rounded(m.px(7.0))
                                                    .border(m.border(1.0))
                                                    .border_color(t.input_border)
                                                    .bg(t.input)
                                                    .cursor_pointer()
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        if let Some(form) = this.bars.form.as_mut() {
                                                            form.picker = !form.picker;
                                                        }
                                                        cx.notify();
                                                    }))
                                                    .child(icon(bar_icon(&icon_name), m).size(20.0).color(t.accent))
                                                    .child(icon("chevron-down", m).size(13.0).color(t.text_muted)),
                                            ),
                                    )

                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_h_0()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .flex()
                                            .justify_between()
                                            .line_height(m.px(20.0))
                                            .font_weight(css_weight(500.0))
                                            .child(tr.t("Widgets desta barra"))
                                            .child(
                                                div()
                                                    .text_size(m.px(12.0))
                                                    .text_color(t.text_muted)
                                                    .font_weight(css_weight(400.0))
                                                    .child(tr.f("{0} selecionados", &[&members.len().to_string()])),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .mt(m.px(9.0))
                                            .flex()
                                            .gap(m.px(11.0))
                                            .child(div().flex_1().child(search_box(&self.bars.widget_search, search_focused, m, t)))
                                            .child(
                                                div().w(m.px(165.0)).child(
                                                    select("bar-plugin-filter", owners, plugin)
                                                        .label(tr.t("Filtrar widgets por plugin"))
                                                        .metrics(36.0, 11.0, 15.0)
                                                        .on_change(cx.listener(|this, v: &SharedString, _, cx| {
                                                            if let Some(form) = this.bars.form.as_mut() {
                                                                form.plugin = v.clone();
                                                            }
                                                            cx.notify();
                                                        })),
                                                ),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .justify_between()
                                            .gap(m.px(11.0))
                                            .py(m.px(5.0))
                                            .child(
                                                text_action("bar-selected-only", tr.t("Selecionados"))
                                                    .pressed(selected_only)
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        if let Some(form) = this.bars.form.as_mut() {
                                                            form.selected_only = !form.selected_only;
                                                        }
                                                        cx.notify();
                                                    })),
                                            )
                                            .child(
                                                div()
                                                    .text_size(m.px(12.0))
                                                    .line_height(m.px(18.0))
                                                    .text_color(t.text_muted)
                                                    .child(tr.f("{0} widgets", &[&shown.len().to_string()])),
                                            ),
                                    )
                                    .child(
                                        div().flex_1().min_h_0().relative().child(
                                            geppui::scroll_area("bar-widget-viewport", &self.bars.form_scroll)
                                                .gutter(11.0, 5.0)
                                                .arrows(true)
                                                .child(
                                                    div()
                                                        .pl(m.px(3.0))
                                                        .pr(m.px(8.0))
                                                        .py(m.px(3.0))
                                                        .flex()
                                                        .flex_col()
                                                        .gap(m.px(9.0))
                                                        .children(rows),
                                                ),
                                        )
                                            .when(shown.is_empty(), |el| {
                                                el.child(
                                                    div()
                                                        .absolute()
                                                        .top_0()
                                                        .left_0()
                                                        .w_full()
                                                        .flex()
                                                        .flex_col()
                                                        .items_center()
                                                        .px(m.px(9.0))
                                                        .py(m.px(24.0))
                                                        .text_size(m.px(12.0))
                                                        .text_color(t.text_muted)
                                                        .child(tr.t("Nenhum widget com esses filtros."))
                                                        .child(text_action("bar-clear-filters", tr.t("Limpar filtros")).on_click(
                                                            cx.listener(|this, _, _, cx| {
                                                                if let Some(form) = this.bars.form.as_mut() {
                                                                    form.plugin = "all".into();
                                                                    form.selected_only = false;
                                                                }
                                                                this.bars.widget_search.update(cx, |f, cx| f.set_text("", cx));
                                                                cx.notify();
                                                            }),
                                                        )),
                                                )
                                            }),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(m.px(12.0))
                                    .line_height(m.px(18.0))
                                    .text_color(t.text_muted)
                                    .child(tr.t("A seleção vale só para esta barra. As outras barras são preservadas.")),
                            )
                            .when(failed, |el| {
                                let message = tr.t(self.session.message());
                                el.child(div().text_size(m.px(12.0)).text_color(t.accent).child(message))
                            })
                            .child(
                                div()
                                    .flex()
                                    .justify_end()
                                    .items_center()
                                    .gap(m.px(11.0))
                                    .pt(m.px(9.0))
                                    .border_t(m.border(1.0))
                                    .border_color(t.border)
                                    .when(editing_existing, |el| {
                                        el.child(
                                            text_action(
                                                "bar-form-manage",
                                                tr.t(if archived { "Excluir barra" } else { "Arquivar barra" }),
                                            )
                                            .destructive()
                                            .on_click(cx.listener(|this, _, _, cx| this.manage_bar(cx))),
                                        )
                                    })
                                    .child(
                                        geppui::button("bar-form-cancel")
                                            .label(tr.t("Cancelar"))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.bars.form = None;
                                                cx.notify();
                                            })),
                                    )
                                    .child(
                                        primary_button(
                                            "bar-form-save",
                                            None,
                                            tr.t(if original.name.is_empty() { "Criar barra" } else { "Salvar alterações" }),
                                            name_empty,
                                            m,
                                            t,
                                        )
                                        .on_click(cx.listener(|this, _, _, cx| this.submit_bar(cx))),
                                    ),
                            )
                            .children(palette),
                    ),
            )
            .into_any_element()
    }
}

/// `.ui-button-primary` at 32px (bar form submit, library "Nova barra").
fn primary_button(
    id: &str,
    glyph: Option<&'static str>,
    label: SharedString,
    disabled: bool,
    m: geppui::Metrics,
    t: geppui::Theme,
) -> gpui::Stateful<Div> {
    div()
        .id(SharedString::from(id.to_owned()))
        .flex()
        .items_center()
        .gap(m.px(7.0))
        .min_h(m.px(32.0))
        .px(m.px(11.0))
        .rounded(m.px(7.0))
        .bg(t.accent)
        .border(m.border(1.0))
        .border_color(t.primary_border)
        .text_color(t.primary_foreground)
        .text_size(m.px(11.0))
        .when(disabled, |el| el.opacity(0.5))
        .when(!disabled, |el| {
            el.cursor_pointer().hover(move |s| s.bg(t.primary_hover))
        })
        .when_some(glyph, |el, g| {
            el.child(icon(g, m).size(15.0).color(t.primary_foreground))
        })
        .child(label)
}

/// A random-enough identity for new bars (`bar:<uuid>` in the reference).
pub fn uuid() -> String {
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(nanos);
    let a = h.finish();
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(a ^ 0x9e37_79b9_7f4a_7c15);
    let b = h.finish();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (a >> 32) as u32,
        (a >> 16) as u16,
        a as u16 & 0x0fff,
        ((b >> 48) as u16 & 0x3fff) | 0x8000,
        b & 0xffff_ffff_ffff
    )
}
