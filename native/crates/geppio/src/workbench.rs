//! The main screen: global header, context row, concave workspace corner, rail, Sidebar
//! (docked, collapse, floating peek), Bottom, splitters, status bar and the Main area.
//! Geometry comes from `geppio_core::shell`; the animated tracks from [`Regions`].
use std::{path::PathBuf, time::Duration};

use geppio_core::shell::{self, Responsive, ShellLayout, Tracks};
use geppui::{
    AnchorHandle, Appearance, Metrics, Rect, ThemeName, Transition, anchor_probe, button,
    css_weight, dialog, icon, icon_button, menu_item,
    motion::{self, duration},
    popover, spaced_text,
};
use gpui::{
    AnyElement, App, Context, Div, FocusHandle, Hsla, InteractiveElement, IntoElement,
    KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Render,
    SharedString, StatefulInteractiveElement, Styled, Task, Window, WindowControlArea, div, img,
    prelude::FluentBuilder,
};

use crate::{
    automation::Automation,
    options::{Options, Start},
    prefs::Prefs,
    regions::{Axis, Regions, SidebarMode},
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Menu {
    Profile,
    About,
}

#[derive(Clone, Copy, Debug)]
struct SplitterDrag {
    axis: Axis,
    start: f32,
    origin: f64,
    moved: bool,
}

pub struct Workbench {
    focus: FocusHandle,
    profile: Option<PathBuf>,
    prefs: Prefs,
    pub(crate) regions: Regions,
    menu: Option<Menu>,
    profile_anchor: AnchorHandle,
    chevron: Transition,
    peek_timer: Option<Task<()>>,
    splitter: Option<SplitterDrag>,
    splitter_hover: [Transition; 2],
    splitter_hovered: [bool; 2],
    viewport: (f64, f64),
    pub(crate) automation: Automation,
}

/// Chromium `line-height: normal` for Segoe UI.
fn normal_line(size: f32) -> f32 {
    (size * 1.33).round()
}

fn abs(m: Metrics, r: shell_rect::R) -> Div {
    let p = m.place(r.into());
    div()
        .absolute()
        .left(p.left)
        .top(p.top)
        .w(p.width)
        .h(p.height)
}

/// `geppio_core` rectangles (f64) as GeppUI rectangles (f32).
mod shell_rect {
    #[derive(Clone, Copy)]
    pub struct R(pub geppui::Rect);
    impl From<geppio_core::Rect> for R {
        fn from(r: geppio_core::Rect) -> Self {
            R(geppui::Rect::new(
                r.x as f32, r.y as f32, r.w as f32, r.h as f32,
            ))
        }
    }
    impl From<geppui::Rect> for R {
        fn from(r: geppui::Rect) -> Self {
            R(r)
        }
    }
    impl From<R> for geppui::Rect {
        fn from(r: R) -> Self {
            r.0
        }
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> shell_rect::R {
    shell_rect::R(Rect::new(x as f32, y as f32, w as f32, h as f32))
}

impl Workbench {
    pub fn new(options: &Options, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let prefs = Prefs::load(options.profile.as_deref());
        let mut regions = Regions::new(
            prefs.sidebar_width,
            prefs.bottom_height,
            prefs.sidebar_collapsed,
            prefs.bottom_collapsed,
        );
        match options.start {
            Start::Docked => {}
            Start::Collapsed => {
                regions = Regions::new(prefs.sidebar_width, prefs.bottom_height, true, false)
            }
            Start::Peek => {
                regions = Regions::new(prefs.sidebar_width, prefs.bottom_height, true, false);
                regions.reduced = true;
                regions.open_peek();
                regions.sample(0.0);
                regions.sample(1.0);
            }
        }
        regions.reduced = geppui::appearance(cx).reduced_motion;
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        cx.observe_window_activation(window, |this, window, cx| {
            if window.is_window_active() && this.automation.reduced_override.is_none() {
                let reduced = crate::platform::reduced_motion();
                cx.global_mut::<Appearance>().reduced_motion = reduced;
                this.regions.reduced = reduced;
                cx.notify();
            }
        })
        .detach();
        let mut this = Self {
            focus,
            profile: options.profile.clone(),
            prefs,
            regions,
            menu: None,
            profile_anchor: AnchorHandle::default(),
            chevron: Transition::new(0.0),
            peek_timer: None,
            splitter: None,
            splitter_hover: [Transition::new(0.0), Transition::new(0.0)],
            splitter_hovered: [false, false],
            viewport: (1280.0, 800.0),
            automation: Automation::new(options),
        };
        this.automation.start(&mut this.regions, cx);
        this
    }

    fn save_prefs(&mut self, cx: &App) {
        self.prefs.theme = geppui::theme(cx).name.as_str().into();
        self.prefs.sidebar_collapsed = self.regions.sidebar_collapsed;
        self.prefs.bottom_collapsed = self.regions.bottom_collapsed;
        self.prefs.sidebar_width = self.regions.sidebar_width;
        self.prefs.bottom_height = self.regions.bottom_height;
        // A failed write keeps the session usable; the next change retries.
        let _ = self.prefs.save(self.profile.as_ref());
    }

    pub(crate) fn toggle_theme(&mut self, cx: &mut Context<Self>) {
        let next = geppui::theme(cx).name.toggled();
        cx.global_mut::<Appearance>().set_theme(next);
        self.save_prefs(cx);
        cx.notify();
    }

    pub(crate) fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.peek_timer = None;
        self.regions.toggle_sidebar();
        self.save_prefs(cx);
        cx.notify();
    }

    fn schedule_peek(&mut self, open: bool, cx: &mut Context<Self>) {
        let delay = if open { 100 } else { 280 };
        self.peek_timer = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(delay))
                .await;
            let _ = this.update(cx, |this, cx| {
                if open {
                    this.regions.open_peek();
                } else {
                    this.regions.close_peek();
                }
                cx.notify();
            });
        }));
    }

    fn peek_hover(&mut self, hovered: bool, cx: &mut Context<Self>) {
        if hovered {
            self.peek_timer = None;
            if self.regions.can_peek() {
                self.schedule_peek(true, cx);
            }
        } else {
            self.regions.block_peek = false;
            if self.regions.peek {
                self.schedule_peek(false, cx);
            } else {
                self.peek_timer = None;
            }
        }
    }

    fn set_menu(&mut self, menu: Option<Menu>, cx: &mut Context<Self>) {
        self.menu = menu;
        let d = geppui::appearance(cx).duration(duration::ICON_HOVER);
        self.chevron.request(
            if menu == Some(Menu::Profile) {
                1.0
            } else {
                0.0
            },
            d,
            motion::EASE,
        );
        cx.notify();
    }

    fn splitter_hover(&mut self, index: usize, hovered: bool, cx: &mut Context<Self>) {
        self.splitter_hovered[index] = hovered;
        let active = hovered
            || self
                .splitter
                .is_some_and(|s| (s.axis == Axis::X) == (index == 0));
        let d = geppui::appearance(cx).duration(duration::SPLITTER);
        self.splitter_hover[index].request(if active { 0.75 } else { 0.0 }, d, motion::EASE);
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, m: Metrics, cx: &mut Context<Self>) {
        let Some(mut drag) = self.splitter else {
            return;
        };
        let pos = if drag.axis == Axis::X {
            m.css(event.position.x)
        } else {
            m.css(event.position.y)
        };
        let delta = (pos - drag.start) as f64;
        if !drag.moved && delta.abs() < 4.0 {
            return;
        }
        drag.moved = true;
        self.splitter = Some(drag);
        match drag.axis {
            Axis::X => self
                .regions
                .resize_sidebar(drag.origin + delta, shell::sidebar_max(self.viewport.0)),
            Axis::Y => self.regions.resize_bottom(drag.origin - delta),
        }
        cx.notify();
    }

    fn on_mouse_up(&mut self, cx: &mut Context<Self>) {
        let Some(drag) = self.splitter.take() else {
            return;
        };
        self.regions.end_resize();
        if !drag.moved {
            // A release under 4px of travel is a click: toggle the region.
            match drag.axis {
                Axis::X => self.regions.toggle_sidebar(),
                Axis::Y => self.regions.toggle_bottom(),
            }
        }
        let index = if drag.axis == Axis::X { 0 } else { 1 };
        let hovered = self.splitter_hovered[index];
        self.splitter_hover(index, hovered, cx);
        self.save_prefs(cx);
        cx.notify();
    }

    fn on_key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) {
        if event.keystroke.key == "escape" {
            if self.menu.is_some() {
                self.set_menu(None, cx);
            } else if self.regions.peek {
                self.regions.close_peek();
                cx.notify();
            }
        }
    }
}

// ---- rendering --------------------------------------------------------------------------

struct Ctx {
    m: Metrics,
    t: geppui::Theme,
    r: Responsive,
}

impl Workbench {
    fn header(&self, c: &Ctx, cx: &mut Context<Self>) -> Div {
        let (m, t) = (c.m, c.t);
        let crumb_size = if c.r.narrow { 12.0 } else { 13.0 };
        let separator = || {
            div()
                .w(m.border(1.0))
                .h(m.px(18.0))
                .bg(t.border)
                .flex_none()
        };
        let window_button = |id: &'static str,
                             glyph: &'static str,
                             label: &'static str,
                             area: WindowControlArea| {
            let b = icon_button(id, glyph)
                .label(label)
                .size(32.0, 16.0)
                .color(t.text)
                .hover_bg(t.chrome_hover);
            let b = if area == WindowControlArea::Close {
                b.destructive()
            } else {
                b
            };
            div().occlude().window_control_area(area).child(b)
        };
        let chevron_turn = self.chevron.value(geppui::now(cx)) as f32;
        let profile_open = self.menu == Some(Menu::Profile);
        div()
            .absolute()
            .left_0()
            .top_0()
            .w_full()
            .h(m.px(shell::HEADER as f32))
            .bg(t.region)
            .window_control_area(WindowControlArea::Drag)
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(m.px(11.0))
                    .pl(m.px(11.0))
                    .text_size(m.px(crumb_size))
                    .line_height(m.px(normal_line(crumb_size)))
                    .text_color(t.text)
                    .whitespace_nowrap()
                    .child(
                        div()
                            .size(m.px(23.0))
                            .flex_none()
                            .child(icon("workspace", m).size(20.0).color(t.text)),
                    )
                    .child(
                        icon("chevron-right", m)
                            .size(14.0)
                            .color(t.breadcrumb_muted),
                    )
                    .child(div().mt(m.half_pixel_nudge(14.5)).child("Projetos"))
                    .child(
                        icon("chevron-right", m)
                            .size(14.0)
                            .color(t.breadcrumb_muted),
                    )
                    .child(
                        div()
                            .id("project-current")
                            .occlude()
                            .flex()
                            .items_center()
                            .gap(m.px(11.0))
                            .font_weight(css_weight(700.0))
                            .child(div().mt(m.half_pixel_nudge(14.5)).child("Laboratório"))
                            .child(icon("chevron-down", m).size(18.0).color(t.text)),
                    )
                    .child(
                        div().occlude().ml(m.px(11.0)).child(
                            button("plugins")
                                .label("Plugins")
                                .icon("squares-2x2", 16.0)
                                .height(30.0, 8.0)
                                .accent()
                                .padding_x(8.0)
                                .text(13.0, 650.0)
                                .tooltip("Plugins (fora do escopo desta etapa)"),
                        ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .h_full()
                    .gap(m.px(11.0))
                    .pr(m.px(11.0))
                    .child(
                        div().occlude().child(
                            icon_button("bell", "bell")
                                .label("Notificações")
                                .size(32.0, 24.0)
                                .color(t.text)
                                .hover_bg(t.chrome_hover),
                        ),
                    )
                    .child(separator())
                    .child(
                        div()
                            .id("profile")
                            .occlude()
                            .relative()
                            .mt(m.half_pixel_nudge(3.5))
                            .flex()
                            .items_center()
                            .gap(m.px(11.0))
                            .px(m.px(8.0))
                            .py(m.px(4.0))
                            .rounded(m.px(10.0))
                            .text_size(m.px(12.0))
                            .text_color(t.text)
                            .cursor_pointer()
                            .when(profile_open, |el| el.bg(t.chrome_hover))
                            .hover(move |s| s.bg(t.chrome_hover))
                            .on_click(cx.listener(|this, _, _, cx| {
                                let next = if this.menu == Some(Menu::Profile) {
                                    None
                                } else {
                                    Some(Menu::Profile)
                                };
                                this.set_menu(next, cx);
                            }))
                            .child(anchor_probe(&self.profile_anchor))
                            .child(
                                img("avatar.png")
                                    .w(m.px(30.0))
                                    .h(m.px(31.0))
                                    .rounded_full()
                                    .flex_none(),
                            )
                            .when(!c.r.compact_header, |el| el.child("Olá, Dev!"))
                            .child(
                                icon("chevron-down", m)
                                    .size(15.0)
                                    .color(t.text)
                                    .rotate_half_turns(chevron_turn),
                            ),
                    )
                    .child(separator())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .h_full()
                            .gap(m.px(1.0))
                            .ml(m.px(-9.0))
                            .child(window_button(
                                "window-min",
                                "minus",
                                "Minimizar",
                                WindowControlArea::Min,
                            ))
                            .child(window_button(
                                "window-max",
                                "stop",
                                "Maximizar",
                                WindowControlArea::Max,
                            ))
                            .child(window_button(
                                "window-close",
                                "x-mark",
                                "Fechar",
                                WindowControlArea::Close,
                            )),
                    ),
            )
    }

    fn context(&self, c: &Ctx, s: &ShellLayout) -> Div {
        let (m, t) = (c.m, c.t);
        let explorer = if c.r.compact_header {
            button("explorer")
                .icon("folder-open", 24.0)
                .width(36.0)
                .tooltip("Ver arquivos")
        } else {
            button("explorer")
                .icon("folder-open", 24.0)
                .label("Ver arquivos")
                .width(152.0)
        };
        abs(m, s.project.into())
            .flex()
            .items_center()
            .justify_between()
            .gap(m.px(11.0))
            .pt(m.px(9.0) + m.half_pixel_nudge(57.5))
            .pr(m.px(11.0))
            .pl(m.px(25.0))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .mt(m.half_pixel_nudge(56.5))
                    .child(
                        spaced_text("Laboratório", m)
                            .size(18.0, 22.0)
                            .weight(css_weight(700.0))
                            .color(t.text)
                            .letter_spacing_em(-0.25 / 18.0),
                    )
                    .child(
                        div()
                            .text_size(m.px(12.0))
                            .line_height(m.px(16.0))
                            .text_color(t.text_muted)
                            .whitespace_nowrap()
                            .child("Nenhuma pasta de projeto aberta"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap(m.px(4.0))
                    .mx(m.px(14.0))
                    .child(
                        button("experience-workbench")
                            .label("Bancada de Trabalho")
                            .pressed(true),
                    )
                    .child(
                        button("experience-code")
                            .label("GeppIO Code")
                            .tooltip("GeppIO Code (fora do escopo desta etapa)"),
                    ),
            )
            .child(
                button("project-local")
                    .label("Projeto / arquivo avulso")
                    .text(12.0, 400.0)
                    .tooltip("Projeto local"),
            )
            .child(button("terminal").label("Mostrar Terminal"))
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(explorer)
                    .child(
                        div().ml(m.px(11.0)).child(
                            button("edit-layout")
                                .icon("pencil-square", 24.0)
                                .width(36.0)
                                .tooltip("Editar layout"),
                        ),
                    )
                    .child(
                        div().ml(m.px(6.0)).child(
                            button("project-more")
                                .icon("ellipsis-horizontal", 24.0)
                                .width(36.0)
                                .tooltip("Mais opções do projeto"),
                        ),
                    ),
            )
    }

    fn empty_region(&self, c: &Ctx, id: &'static str) -> Div {
        let (m, t) = (c.m, c.t);
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(m.px(9.0))
            .text_size(m.px(12.0))
            .line_height(m.px(normal_line(12.0)))
            .text_color(t.text_muted)
            .child(
                div()
                    .opacity(0.55)
                    .child(icon("empty-region", m).size(28.0).color(t.text_muted)),
            )
            .child(
                div()
                    .line_height(m.px(16.0))
                    .font_weight(css_weight(500.0))
                    .child("Nenhum widget nesta área"),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}-choose")))
                    .flex()
                    .items_start()
                    .min_h(m.px(28.0))
                    .px(m.px(6.0))
                    .py(m.px(4.0))
                    .rounded(m.px(6.0))
                    .text_size(m.px(11.0))
                    .line_height(m.px(18.0))
                    .cursor_pointer()
                    .hover(move |s| s.bg(t.control_hover).text_color(t.text))
                    .child("Escolher widgets"),
            )
    }

    fn sidebar_contents(
        &self,
        c: &Ctx,
        width: f32,
        floating: bool,
        height: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let (m, t) = (c.m, c.t);
        // Docked header: 50px with 9px top padding. Floating: 40px with 4.5px.
        let header_h = if floating { 40.0 } else { 50.0 };
        let (pin_top, heading_top) = if floating { (3.5, 4.5) } else { (13.5, 9.0) };
        let label = if floating {
            "Fixar barra lateral"
        } else {
            "Recolher barra lateral"
        };
        div()
            .relative()
            .w(m.px(width))
            .h(m.px(height))
            .child(
                div()
                    .absolute()
                    .left(m.px(11.0 + 4.0))
                    .top(m.px(heading_top))
                    .h(m.px(header_h - heading_top - if floating { 5.5 } else { 0.0 }))
                    .flex()
                    .items_center()
                    .child(
                        spaced_text("FERRAMENTAS", m)
                            .size(14.0, 22.0)
                            .weight(css_weight(500.0))
                            .color(t.text_muted)
                            .letter_spacing_em(0.08),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .left(m.px(width - 40.0))
                    .top(m.px(pin_top))
                    .child(
                        icon_button(
                            if floating {
                                "pin-floating"
                            } else {
                                "pin-docked"
                            },
                            "sidebar",
                        )
                        .label(label)
                        .size(32.0, 18.0)
                        .color(t.text_muted)
                        .hover_bg(t.chrome_hover)
                        .on_click(cx.listener(|this, _, _, cx| this.toggle_sidebar(cx))),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .left(m.px(15.0))
                    .top(m.px(header_h + 9.0))
                    .w(m.px(width - 30.0))
                    .h(m.px((height - header_h - 18.0).max(0.0)))
                    .child(self.empty_region(
                        c,
                        if floating {
                            "sidebar-floating"
                        } else {
                            "sidebar"
                        },
                    )),
            )
    }

    fn rail(&self, c: &Ctx, s: &ShellLayout, cx: &mut Context<Self>) -> Div {
        let (m, t) = (c.m, c.t);
        let theme_icon = if t.name == ThemeName::Dark {
            "moon"
        } else {
            "sun"
        };
        let footer_button = |id: &'static str, glyph: &'static str, label: &'static str| {
            icon_button(id, glyph).label(label).color(t.text)
        };
        abs(m, s.rail.into())
            .bg(t.region)
            .child(
                div()
                    .id("rail-primary")
                    .absolute()
                    .left_0()
                    .top_0()
                    .w(m.px(shell::RAIL as f32))
                    .h(m.px((s.rail.h * 2.0 / 3.0) as f32))
                    .on_hover(
                        cx.listener(|this, hovered: &bool, _, cx| this.peek_hover(*hovered, cx)),
                    )
                    .child(
                        div().absolute().left(m.px(7.0)).top(m.px(13.5)).child(
                            icon_button("bar-home", "home")
                                .label("Ferramentas")
                                .size(34.0, 23.0)
                                .color(t.text_muted)
                                .selected(true)
                                .on_click(cx.listener(|this, _, _, cx| this.toggle_sidebar(cx))),
                        ),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .left(m.px(8.0))
                    .bottom(m.px(9.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(9.0))
                    .child(footer_button("saved-bars", "folder", "Barras salvas"))
                    .child(footer_button("new-bar", "plus", "Nova barra"))
                    .child(
                        footer_button("toggle-theme", theme_icon, "Alternar tema")
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_theme(cx))),
                    ),
            )
    }

    fn rail_separator(&self, c: &Ctx, s: &ShellLayout, track: f64) -> Option<AnyElement> {
        if track < shell::RAIL + 1.0 || (self.regions.floating && self.regions.sidebar_collapsed) {
            return None;
        }
        let (m, t) = (c.m, c.t);
        let line = t.border.opacity(0.5);
        let top = s.rail.y + 12.0;
        let height = (s.rail.h - 24.0).max(12.0);
        let fade = 6.0;
        let gradient = |down: bool| {
            gpui::linear_gradient(
                if down { 180.0 } else { 0.0 },
                gpui::linear_color_stop(Hsla::transparent_black(), 0.0),
                gpui::linear_color_stop(line, 1.0),
            )
        };
        Some(
            abs(m, rect(shell::RAIL, top, 1.0, height))
                .flex()
                .flex_col()
                .child(div().h(m.px(fade)).w_full().bg(gradient(true)))
                .child(div().flex_1().w_full().bg(line))
                .child(div().h(m.px(fade)).w_full().bg(gradient(false)))
                .into_any_element(),
        )
    }

    fn splitters(
        &self,
        c: &Ctx,
        s: &ShellLayout,
        now: f64,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let (m, t) = (c.m, c.t);
        let mut out = Vec::new();
        let opacity = |i: usize| self.splitter_hover[i].value(now) as f32;
        if self.regions.mode() == SidebarMode::Docked
            || self.splitter.is_some_and(|d| d.axis == Axis::X)
        {
            out.push(
                abs(
                    m,
                    rect(
                        s.sidebar_clip.right(),
                        s.context.y,
                        10.0,
                        s.status.y - s.context.y,
                    ),
                )
                .id("sidebar-splitter")
                .cursor_col_resize()
                .on_hover(cx.listener(|this, h: &bool, _, cx| this.splitter_hover(0, *h, cx)))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                        this.splitter = Some(SplitterDrag {
                            axis: Axis::X,
                            start: m.css(e.position.x),
                            origin: this.regions.sidebar_width,
                            moved: false,
                        });
                        this.splitter_hover(0, true, cx);
                        cx.stop_propagation();
                    }),
                )
                .child(
                    div()
                        .absolute()
                        .left(m.px(2.0))
                        .top(m.px(14.0))
                        .bottom(m.px(14.0))
                        .w(m.px(2.0))
                        .rounded(m.px(3.0))
                        .bg(t.accent)
                        .opacity(opacity(0)),
                )
                .into_any_element(),
            );
        }
        let y = s.bottom_clip.y - 9.0;
        out.push(
            abs(m, rect(s.bottom_clip.x, y, s.bottom_clip.w, 9.0))
                .id("bottom-splitter")
                .cursor_row_resize()
                .on_hover(cx.listener(|this, h: &bool, _, cx| this.splitter_hover(1, *h, cx)))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                        let origin = if this.regions.bottom_collapsed {
                            0.0
                        } else {
                            this.regions.bottom_height
                        };
                        this.splitter = Some(SplitterDrag {
                            axis: Axis::Y,
                            start: m.css(e.position.y),
                            origin,
                            moved: false,
                        });
                        this.splitter_hover(1, true, cx);
                        cx.stop_propagation();
                    }),
                )
                .child(
                    div()
                        .absolute()
                        .left(m.px(11.0))
                        .right(m.px(11.0))
                        .top(m.px(3.5))
                        .h(m.px(2.0))
                        .rounded(m.px(3.0))
                        .bg(t.accent)
                        .opacity(opacity(1)),
                )
                .into_any_element(),
        );
        out
    }

    fn status_bar(&self, c: &Ctx, s: &ShellLayout) -> Div {
        let (m, t) = (c.m, c.t);
        let gap = if c.r.narrow { 5.0 } else { 10.0 };
        abs(m, s.status.into())
            .bg(t.status_surface)
            .border_t(m.border(1.0))
            .border_color(t.border)
            .flex()
            .justify_between()
            .px(m.px(11.0))
            .text_size(m.px(11.0))
            .line_height(m.px(normal_line(11.0)))
            .text_color(t.status_foreground)
            .whitespace_nowrap()
            // The reference centres the 15px line at a fractional offset and rounds up.
            .items_start()
            .pt(m.ceil(4.5))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(m.px(gap))
                    .child("Nenhum documento")
                    .child(div().px(m.px(3.0)).child("Terminal: sem sessão")),
            )
            .when(!c.r.narrow, |el| el.child(div().child(VERSION)))
    }

    fn overlays(&self, c: &Ctx, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let (m, t) = (c.m, c.t);
        let mut out = Vec::new();
        match self.menu {
            Some(Menu::Profile) => {
                let dark = t.name == ThemeName::Dark;
                out.push(
                    popover("profile-menu", &self.profile_anchor)
                        .width(248.0)
                        .padding(9.0, 11.0)
                        .on_dismiss({
                            let view = cx.entity().downgrade();
                            move |_, cx| {
                                let _ = view.update(cx, |this, cx| this.set_menu(None, cx));
                            }
                        })
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(m.px(3.0))
                                .px(m.px(11.0))
                                .py(m.px(9.0))
                                .mb(m.px(9.0))
                                .border_b(m.border(1.0))
                                .border_color(t.border)
                                .child(
                                    div()
                                        .text_size(m.px(14.0))
                                        .line_height(m.px(normal_line(14.0)))
                                        .font_weight(css_weight(600.0))
                                        .child("Dev"),
                                )
                                .child(
                                    div()
                                        .text_size(m.px(12.0))
                                        .line_height(m.px(normal_line(12.0)))
                                        .text_color(t.text_muted)
                                        .child("Seu espaço no GeppIO"),
                                ),
                        )
                        .child(
                            menu_item(
                                "menu-theme",
                                if dark { "Tema claro" } else { "Tema escuro" },
                            )
                            .icon(if dark { "sun" } else { "moon" })
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_theme(cx))),
                        )
                        .child(
                            div()
                                .h(m.border(1.0))
                                .mx(m.px(11.0))
                                .my(m.px(9.0))
                                .bg(t.border),
                        )
                        .child(
                            menu_item("menu-about", "Sobre o GeppIO")
                                .icon("information-circle")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.set_menu(Some(Menu::About), cx)
                                })),
                        )
                        .into_any_element(),
                );
            }
            Some(Menu::About) => {
                let done = div()
                    .id("about-done")
                    .mt(m.px(27.0))
                    .w_full()
                    .min_h(m.px(36.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .px(m.px(11.0))
                    .py(m.px(9.0))
                    .rounded(m.px(8.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.control_hover)
                    .hover(move |s| s.bg(t.chrome_hover))
                    .font_weight(css_weight(500.0))
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| this.set_menu(None, cx)))
                    .child("Voltar ao trabalho");
                out.push(
                    dialog("about", "Sobre o GeppIO")
                        .on_dismiss({
                            let view = cx.entity().downgrade();
                            move |_, cx| {
                                let _ = view.update(cx, |this, cx| this.set_menu(None, cx));
                            }
                        })
                        .child(
                            div()
                                .mt(m.px(9.0))
                                .text_color(t.text_muted)
                                .line_height(m.px(13.0 * 1.6))
                                .child("Seu espaço para criar, organizar e desenvolver."),
                        )
                        .child(
                            div()
                                .mt(m.px(27.0))
                                .pt(m.px(18.0))
                                .border_t(m.border(1.0))
                                .border_color(t.border)
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(m.px(11.0))
                                .child(
                                    div()
                                        .text_size(m.px(18.0))
                                        .line_height(m.px(normal_line(18.0)))
                                        .font_weight(css_weight(600.0))
                                        .child("GeppIO"),
                                )
                                .child(
                                    div()
                                        .px(m.px(8.0))
                                        .py(m.px(4.0))
                                        .rounded(m.px(6.0))
                                        .bg(t.accent_soft)
                                        .text_size(m.px(12.0))
                                        .line_height(m.px(normal_line(12.0)))
                                        .child(VERSION),
                                ),
                        )
                        .child(
                            div()
                                .mt(m.px(9.0))
                                .text_color(t.text_muted)
                                .line_height(m.px(13.0 * 1.6))
                                .child("Projetos, ferramentas e widgets em um só lugar."),
                        )
                        .child(done)
                        .into_any_element(),
                );
            }
            None => {}
        }
        out
    }
}

impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let m = geppui::metrics(window, cx);
        let t = geppui::theme(cx);
        let now = geppui::now(cx);
        let vp = window.viewport_size();
        self.viewport = (m.css(vp.width) as f64, m.css(vp.height) as f64);
        self.regions.reduced = geppui::appearance(cx).reduced_motion;
        let frame = self.regions.sample(now);
        self.chevron.sample(now);
        for i in 0..2 {
            self.splitter_hover[i].sample(now);
        }
        let animating = self.regions.animating(now)
            || self.chevron.animating(now)
            || self.splitter_hover.iter().any(|h| h.animating(now));
        if animating && !geppui::appearance(cx).clock.frozen() {
            window.request_animation_frame();
        }
        if let Some(trace) = self.automation.trace.as_mut() {
            trace.frame(now, &frame, animating);
        }
        let (w, h) = self.viewport;
        let tracks = Tracks {
            sidebar: frame.track,
            bottom: frame.bottom,
            sidebar_width: self.regions.sidebar_width,
            bottom_height: self.regions.bottom_height,
        };
        let s = ShellLayout::compute(w, h, tracks);
        let c = Ctx {
            m,
            t,
            r: Responsive::at(w),
        };
        let mut layers: Vec<AnyElement> = Vec::new();

        // Workspace surface: its 22px top-left corner on the region colour is the concave join.
        layers.push(
            abs(m, s.workspace.into())
                .bg(t.workspace)
                .rounded_tl(m.px(shell::WORKSPACE_RADIUS as f32))
                .into_any_element(),
        );
        layers.push(self.context(&c, &s).into_any_element());
        // Main region.
        layers.push(
            abs(m, s.main_port.into())
                .child(self.empty_region(&c, "main"))
                .into_any_element(),
        );
        // Bottom: fixed-height tray anchored to the top of a shrinking clip (it slides down).
        if s.bottom_clip.h > 0.0 {
            let tray = s.bottom_surface;
            layers.push(
                abs(m, s.bottom_clip.into())
                    .overflow_hidden()
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .w_full()
                            .h(m.px(tray.h as f32))
                            .bg(t.region)
                            .border_t(m.border(1.0))
                            .border_l(m.border(1.0))
                            .border_r(m.border(1.0))
                            .border_color(t.border)
                            .rounded_t(m.px(shell::BOTTOM_RADIUS as f32))
                            .pt(m.px(9.0))
                            .px(m.px(11.0))
                            .pb(m.px(10.0))
                            .child(self.empty_region(&c, "bottom")),
                    )
                    .into_any_element(),
            );
        }
        let splitters = self.splitters(&c, &s, now, cx);
        // Peek backdrop: tint only (owner decision in #73; GPUI has no backdrop blur).
        if frame.backdrop > 0.0 {
            layers.push(
                abs(m, s.backdrop.into())
                    .rounded_tl(m.px((shell::WORKSPACE_RADIUS - 1.0) as f32))
                    .bg(t.peek_backdrop.opacity(frame.backdrop as f32))
                    .into_any_element(),
            );
        }
        // Workspace outline: 1px on top and left following the same arc, 70% opacity.
        layers.push(
            abs(m, s.workspace.into())
                .rounded_tl(m.px(shell::WORKSPACE_RADIUS as f32))
                .border_t(m.border(1.0))
                .border_l(m.border(1.0))
                .border_color(t.border.opacity(0.7))
                .into_any_element(),
        );
        // Docked Sidebar: a fixed-width viewport clipped by the animated track (wipe).
        if s.sidebar_clip.w > 0.0 {
            let height = s.sidebar_clip.h as f32;
            layers.push(
                abs(m, s.sidebar_clip.into())
                    .overflow_hidden()
                    .child(self.sidebar_contents(
                        &c,
                        self.regions.sidebar_width as f32,
                        false,
                        height,
                        cx,
                    ))
                    .into_any_element(),
            );
        }
        // Floating Sidebar.
        if self.regions.floating && (self.regions.peek || frame.peek_opacity > 0.0) {
            let f = s.floating;
            let inner_h = (f.h - 2.0) as f32;
            layers.push(
                abs(m, rect(f.x + frame.peek_x, f.y, f.w, f.h))
                    .id("sidebar-floating")
                    .occlude()
                    .opacity(frame.peek_opacity as f32)
                    .rounded(m.px(14.0))
                    .border(m.border(1.0))
                    .border_color(t.floating_border)
                    .bg(t.region)
                    .shadow(vec![m.shadow(t.shadow_side)])
                    .overflow_hidden()
                    .on_hover(
                        cx.listener(|this, hovered: &bool, _, cx| this.peek_hover(*hovered, cx)),
                    )
                    .child(self.sidebar_contents(&c, (f.w - 2.0) as f32, true, inner_h, cx))
                    .into_any_element(),
            );
        }
        layers.push(self.rail(&c, &s, cx).into_any_element());
        if let Some(separator) = self.rail_separator(&c, &s, frame.track) {
            layers.push(separator);
        }
        layers.extend(splitters);
        layers.push(self.status_bar(&c, &s).into_any_element());
        layers.push(self.header(&c, cx).into_any_element());
        layers.extend(self.overlays(&c, cx));

        let floating = s.floating;
        let peek_open = self.regions.peek;
        div()
            .id("workbench")
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(t.region)
            .font_family(geppui::UI_FONT)
            .text_size(m.px(13.0))
            .line_height(m.px(normal_line(13.0)))
            .text_color(t.text)
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| this.on_key(e, cx)))
            .on_mouse_move(cx.listener(move |this, e: &MouseMoveEvent, _, cx| {
                if !geppui::appearance(cx).clock.frozen() {
                    this.on_mouse_move(e, m, cx)
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _: &MouseUpEvent, _, cx| this.on_mouse_up(cx)),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                    // Pointer-down in the work area outside the panel, rail and the 11px safe gap
                    // closes the peek without swallowing the click.
                    let (x, y) = (m.css(e.position.x) as f64, m.css(e.position.y) as f64);
                    if peek_open
                        && y >= shell::HEADER
                        && x > shell::RAIL + shell::FLOATING_GAP
                        && !floating.contains(x, y)
                    {
                        this.regions.close_peek();
                        cx.notify();
                    }
                }),
            )
            .children(layers)
    }
}
