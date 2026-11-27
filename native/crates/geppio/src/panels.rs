//! Header panels of the reference (`Header.tsx`, `Settings.tsx`, `Notifications.tsx`,
//! `ProjectMenu.tsx`, `PluginManager.tsx`):
//! - the profile menu with Settings, theme and language;
//! - the Settings dialog and its "Desenvolvimento e recuperação" page;
//! - the notification center;
//! - the project menu with its rename and information dialogs;
//! - the plugins popover (the inventory is empty until the plugin runtime exists);
//! - the About dialog.
//!
//! Only one of them is open at a time, like the reference's `headerMenu`.
use geppio_core::workbench::active_placements;
use geppio_core::workbench::notifications::{
    Notification, NotificationAction, reduce_notifications, unread,
};
use geppui::{
    AnchorHandle, DialogButtonKind, Placement, TextField, ThemeName, checkbox, css_weight, dialog,
    dialog_button, icon, menu_item, popover, popover_heading, select, switch, text_action,
};
use gpui::{
    AnyElement, App, AppContext, Context, Div, Entity, FocusHandle, InteractiveElement,
    IntoElement, ParentElement, SharedString, StatefulInteractiveElement, Styled, Window, div,
    prelude::FluentBuilder,
};

use crate::i18n::{I18n, Preference, Tr};
use crate::workbench::{VERSION, Workbench};

/// The open header panel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Menu {
    Profile,
    About,
    Settings,
    Notifications,
    Project,
    Rename,
    Info,
    Plugins,
}

/// Header panel state that is not the open panel itself.
pub struct Panels {
    pub settings_advanced: bool,
    pub notifications: Vec<Notification>,
    pub unread_only: bool,
    pub bell_anchor: AnchorHandle,
    pub plugins_anchor: AnchorHandle,
    pub project_anchor: AnchorHandle,
    pub rename_field: Entity<TextField>,
    pub rename_error: bool,
    pub plugin_search: Entity<TextField>,
    pub plugin_sort: SharedString,
    pub plugin_filter: &'static str,
    pub developer_mode: bool,
    /// Focus to return to when the panel closes (its trigger).
    pub trigger: Option<FocusHandle>,
}

impl Panels {
    pub fn new(cx: &mut Context<Workbench>) -> Self {
        let rename_field = cx.new(|cx| TextField::new(cx).max_length(60).font(13.0, 18.0));
        let plugin_search = cx.new(|cx| TextField::new(cx).font(12.0, 16.0));
        cx.subscribe(&rename_field, |this, _, event, cx| {
            if *event == geppui::TextFieldEvent::Submitted {
                this.submit_rename(cx);
            }
        })
        .detach();
        cx.subscribe(&plugin_search, |_, _, _, cx| cx.notify())
            .detach();
        Self {
            settings_advanced: false,
            notifications: Vec::new(),
            unread_only: false,
            bell_anchor: AnchorHandle::default(),
            plugins_anchor: AnchorHandle::default(),
            project_anchor: AnchorHandle::default(),
            rename_field,
            rename_error: false,
            plugin_search,
            plugin_sort: "original".into(),
            plugin_filter: "all",
            developer_mode: false,
            trigger: None,
        }
    }
}

/// The reference `.workspace-section-label`: 10/16, 650, uppercase, letter-spaced, muted.
fn section_label(text: SharedString, m: geppui::Metrics, t: geppui::Theme) -> impl IntoElement {
    geppui::spaced_text(text.to_uppercase(), m)
        .size(10.0, 16.0)
        .weight(css_weight(650.0))
        .color(t.text_muted)
        .letter_spacing_em(0.09)
}

fn divider(m: geppui::Metrics, t: geppui::Theme) -> Div {
    div()
        .h(m.border(1.0))
        .mx(m.px(11.0))
        .my(m.px(9.0))
        .bg(t.border)
}

/// A filter chip (`[data-notification-filter]`, `.plugin-filters .ui-button`).
#[allow(clippy::too_many_arguments)]
fn chip(
    id: impl Into<SharedString>,
    label: SharedString,
    count: Option<(usize, bool)>,
    pressed: bool,
    plugin_style: bool,
    m: geppui::Metrics,
    t: geppui::Theme,
) -> gpui::Stateful<Div> {
    let (size, py, px, radius, min_h) = if plugin_style {
        (12.0, 5.0, 9.0, 8.0, 32.0)
    } else {
        (11.0, 5.0, 7.0, 6.0, 0.0)
    };
    div()
        .id(id.into())
        .flex()
        .items_center()
        .gap(m.px(if plugin_style { 7.0 } else { 3.0 }))
        .min_h(m.px(min_h))
        .px(m.px(px))
        .py(m.px(py))
        .rounded(m.px(radius))
        .text_size(m.px(size))
        .line_height(m.px(16.0))
        .cursor_pointer()
        .text_color(t.text_muted)
        .when(pressed && !plugin_style, |el| {
            el.text_color(t.text).bg(t.input)
        })
        .when(pressed && plugin_style, |el| {
            el.text_color(t.text).bg(t.accent_soft)
        })
        .when(plugin_style && !pressed, |el| {
            el.hover(move |s| s.bg(t.control_hover))
        })
        .child(label)
        .when_some(count, |el, (n, accent)| {
            el.child(
                div()
                    .when(accent, |d| d.text_color(t.accent))
                    .when(!accent, |d| d.text_size(m.px(10.0)).opacity(0.75))
                    .child(n.to_string()),
            )
        })
}

/// `.workspace-search`: 36px input box with a 16px magnifier and the field.
pub fn search_box(
    field: &Entity<TextField>,
    focused: bool,
    m: geppui::Metrics,
    t: geppui::Theme,
) -> Div {
    div()
        .flex()
        .items_center()
        .gap(m.px(9.0))
        .h(m.px(36.0))
        .px(m.px(11.0))
        .rounded(m.px(8.0))
        .border(m.border(1.0))
        .border_color(t.input_border)
        .bg(t.input)
        .when(focused, |el| {
            el.shadow(vec![
                gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), t.ring).spread_radius(m.px(2.0)),
            ])
        })
        .child(icon("magnifying-glass", m).size(16.0).color(t.text_muted))
        .child(div().flex_1().min_w_0().child(field.clone()))
}

impl Workbench {
    pub(crate) fn project_name(&self) -> SharedString {
        if self.prefs.project_name.is_empty() {
            "Laboratório".into()
        } else {
            self.prefs.project_name.clone().into()
        }
    }

    /// Opens or closes a header panel; `trigger` regains focus when it closes.
    pub(crate) fn set_menu(
        &mut self,
        menu: Option<Menu>,
        trigger: Option<FocusHandle>,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let closing = menu.is_none();
        if closing && let (Some(window), Some(trigger)) = (window, self.panels.trigger.take()) {
            window.focus(&trigger, cx);
        }
        if trigger.is_some() {
            self.panels.trigger = trigger;
        }
        if menu == Some(Menu::Settings) {
            self.panels.settings_advanced = false;
        }
        if menu == Some(Menu::Rename) {
            let name = self.project_name();
            self.panels.rename_error = false;
            self.panels.rename_field.update(cx, |f, cx| {
                f.set_text(&name, cx);
                f.select_all(cx);
            });
            self.pending_text_focus = Some(self.panels.rename_field.clone());
        }
        if menu == Some(Menu::Plugins) {
            self.panels
                .plugin_search
                .update(cx, |f, cx| f.set_text("", cx));
            self.panels.plugin_filter = "all";
        }
        self.menu = menu;
        let d = geppui::appearance(cx).duration(geppui::motion::duration::ICON_HOVER);
        self.chevron.request(
            if menu == Some(Menu::Profile) {
                1.0
            } else {
                0.0
            },
            d,
            geppui::motion::EASE,
        );
        cx.notify();
    }

    fn close_handler(&self, cx: &Context<Self>) -> impl Fn(&mut Window, &mut App) + 'static {
        let view = cx.entity().downgrade();
        move |window, cx| {
            let _ = view.update(cx, |this, cx| this.set_menu(None, None, Some(window), cx));
        }
    }

    pub(crate) fn set_language(&mut self, preference: Preference, cx: &mut Context<Self>) {
        self.prefs.locale = preference.as_str().into();
        let system = cx
            .try_global::<I18n>()
            .map(|i| i.system)
            .unwrap_or_default();
        crate::i18n::install(cx, I18n { preference, system });
        let _ = self.prefs.save(self.profile.as_ref());
        cx.notify();
    }

    fn submit_rename(&mut self, cx: &mut Context<Self>) {
        let text = self.panels.rename_field.read(cx).text().to_owned();
        match crate::prefs::valid_name(&text) {
            Some(name) => {
                self.prefs.project_name = name;
                if self.prefs.save(self.profile.as_ref()).is_ok() {
                    // Inside Edit the name is part of the draft (`changeLocal`).
                    self.record_local(cx);
                    self.menu = None;
                } else {
                    self.panels.rename_error = true;
                }
            }
            None => self.panels.rename_error = true,
        }
        cx.notify();
    }

    /// Adds a notification (plugin events from stage E use this).
    #[allow(dead_code)]
    pub(crate) fn notify_event(&mut self, item: Notification, cx: &mut Context<Self>) {
        self.notification_action(NotificationAction::Add(item), cx);
    }

    fn notification_action(&mut self, action: NotificationAction, cx: &mut Context<Self>) {
        self.panels.notifications = reduce_notifications(&self.panels.notifications, &action);
        cx.notify();
    }

    pub(crate) fn unread_notifications(&self) -> usize {
        unread(&self.panels.notifications)
    }

    pub(crate) fn overlays(
        &mut self,
        m: geppui::Metrics,
        t: geppui::Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let tr = crate::i18n::tr(cx);
        let Some(menu) = self.menu else {
            return Vec::new();
        };
        vec![match menu {
            Menu::Profile => self.profile_menu(m, t, tr, cx),
            Menu::About => self.about_dialog(m, t, tr, cx),
            Menu::Settings => self.settings_dialog(m, t, tr, window, cx),
            Menu::Notifications => self.notification_center(m, t, tr, window, cx),
            Menu::Project => self.project_menu(m, t, tr, cx),
            Menu::Rename => self.rename_dialog(m, t, tr, window, cx),
            Menu::Info => self.info_dialog(m, t, tr, cx),
            Menu::Plugins => self.plugins_popover(m, t, tr, window, cx),
        }]
    }

    fn profile_menu(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let dark = t.name == ThemeName::Dark;
        let preference = self.prefs.locale();
        let language = |id: &'static str, label: SharedString, value: Preference| {
            menu_item(id, label)
                .checked(preference == value)
                .on_click(cx.listener(move |this, _, _, cx| this.set_language(value, cx)))
        };
        popover("profile-menu", &self.profile_anchor)
            .width(248.0)
            .padding(9.0, 11.0)
            .menu(
                [
                    "menu-settings",
                    "menu-theme",
                    "menu-locale-auto",
                    "menu-locale-pt",
                    "menu-locale-en",
                    "menu-about",
                ]
                .map(SharedString::from)
                .to_vec(),
            )
            .on_dismiss(self.close_handler(cx))
            .on_escape(self.close_handler(cx))
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
                            .line_height(m.px(19.0))
                            .font_weight(css_weight(600.0))
                            .child("Dev"),
                    )
                    .child(
                        div()
                            .text_size(m.px(12.0))
                            .line_height(m.px(16.0))
                            .text_color(t.text_muted)
                            .child(tr.t("Seu espaço no GeppIO")),
                    ),
            )
            .child(
                menu_item("menu-settings", tr.t("Configurações"))
                    .icon("cog-6-tooth")
                    .trailing("chevron-right")
                    .on_click(cx.listener(|this, _, window, cx| {
                        let trigger = this.panels.trigger.clone();
                        this.set_menu(Some(Menu::Settings), trigger, Some(window), cx)
                    })),
            )
            .child(
                menu_item(
                    "menu-theme",
                    tr.t(if dark { "Tema claro" } else { "Tema escuro" }),
                )
                .icon(if dark { "sun" } else { "moon" })
                .on_click(cx.listener(|this, _, _, cx| this.toggle_theme(cx))),
            )
            .child(divider(m, t))
            .child(
                div()
                    .px(m.px(11.0))
                    .py(m.px(5.0))
                    .child(section_label(tr.t("Idioma"), m, t)),
            )
            .child(language(
                "menu-locale-auto",
                tr.t("Idioma do navegador"),
                Preference::Auto,
            ))
            .child(language(
                "menu-locale-pt",
                "Português (Brasil)".into(),
                Preference::PtBr,
            ))
            .child(language("menu-locale-en", "English".into(), Preference::En))
            .child(divider(m, t))
            .child(
                menu_item("menu-about", tr.t("Sobre o GeppIO"))
                    .icon("information-circle")
                    .on_click(cx.listener(|this, _, _, cx| {
                        let trigger = this.panels.trigger.clone();
                        this.set_menu(Some(Menu::About), trigger, None, cx)
                    })),
            )
            .into_any_element()
    }

    fn about_dialog(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        cx: &mut Context<Self>,
    ) -> AnyElement {
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
            .on_click(
                cx.listener(|this, _, window, cx| this.set_menu(None, None, Some(window), cx)),
            )
            .child(tr.t("Voltar ao trabalho"));
        dialog("about", tr.t("Sobre o GeppIO"))
            .close_label(tr.t("Fechar"))
            .on_dismiss(self.close_handler(cx))
            .child(
                div()
                    .mt(m.px(9.0))
                    .text_color(t.text_muted)
                    .line_height(m.px(13.0 * 1.6))
                    .child(tr.t("Seu espaço para criar, organizar e desenvolver.")),
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
                            .line_height(m.px(24.0))
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
                            .line_height(m.px(16.0))
                            .child(VERSION),
                    ),
            )
            .child(
                div()
                    .mt(m.px(9.0))
                    .text_color(t.text_muted)
                    .line_height(m.px(13.0 * 1.6))
                    .child(tr.t("Projetos, ferramentas e widgets em um só lugar.")),
            )
            .child(done)
            .into_any_element()
    }

    fn settings_dialog(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let dark = t.name == ThemeName::Dark;
        let legend = |text: &str| {
            div()
                .text_size(m.px(14.0))
                .line_height(m.px(19.0))
                .font_weight(css_weight(600.0))
                .child(tr.t(text))
        };
        let helper = |text: &str| {
            div()
                .mt(m.px(4.0))
                .text_size(m.px(12.0))
                .line_height(m.px(12.0 * 1.6))
                .text_color(t.text_muted)
                .child(tr.t(text))
        };
        let description = |text: SharedString| {
            div()
                .mt(m.px(9.0))
                .text_color(t.text_muted)
                .line_height(m.px(13.0 * 1.6))
                .child(text)
        };
        let body = if !self.panels.settings_advanced {
            let theme_option = |light: bool| {
                let pressed = light != dark;
                div()
                    .id(if light {
                        "settings-theme-light"
                    } else {
                        "settings-theme-dark"
                    })
                    .flex()
                    .items_center()
                    .gap(m.px(11.0))
                    .min_h(m.px(48.0))
                    .px(m.px(11.0))
                    .py(m.px(9.0))
                    .rounded(m.px(9.0))
                    .border(m.border(1.0))
                    .border_color(if pressed { t.accent_border } else { t.border })
                    .when(pressed, |el| el.bg(t.accent_soft))
                    .when(!pressed, |el| el.hover(move |s| s.bg(t.control_hover)))
                    .font_weight(css_weight(500.0))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !pressed {
                            this.toggle_theme(cx)
                        }
                    }))
                    .child(
                        icon(if light { "sun" } else { "moon" }, m)
                            .size(20.0)
                            .color(t.text),
                    )
                    .child(
                        div()
                            .flex_1()
                            .child(tr.t(if light { "Claro" } else { "Escuro" })),
                    )
                    .when(pressed, |el| {
                        el.child(icon("check", m).size(16.0).color(t.accent))
                    })
            };
            let snap = self.prefs.snap_center;
            div()
                .child(description(tr.t("Deixe o GeppIO com a sua cara.")))
                .child(
                    div()
                        .mt(m.px(27.0))
                        .child(legend("Aparência"))
                        .child(helper("Escolha o tema do seu espaço de trabalho."))
                        .child(
                            div()
                                .mt(m.px(18.0))
                                .flex()
                                .gap(m.px(11.0))
                                .child(theme_option(true).flex_1())
                                .child(theme_option(false).flex_1()),
                        ),
                )
                .child(
                    div()
                        .mt(m.px(22.0))
                        .child(legend("Redimensionamento"))
                        .child(
                            div()
                                .id("settings-snap-row")
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(m.px(11.0))
                                .min_h(m.px(41.0))
                                .text_size(m.px(12.0))
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.set_snap(!snap, cx)
                                }))
                                .child(tr.t("Guia e encaixe no centro"))
                                .child(
                                    switch("settings-snap", snap)
                                        .label(tr.t("Guia e encaixe no centro"))
                                        .on_toggle(cx.listener(|this, on: &bool, _, cx| {
                                            this.set_snap(*on, cx)
                                        })),
                                ),
                        )
                        .child(helper(
                            "Mostra a guia e encaixa suavemente as colunas da área principal e da barra inferior em 50%.",
                        )),
                )
                .child(
                    div()
                        .mt(m.px(27.0))
                        .child(legend("Idioma"))
                        .child(helper("O idioma do navegador é usado por padrão."))
                        .child(
                            div().mt(m.px(9.0)).child(
                                select(
                                    "settings-language",
                                    vec![
                                        ("auto".into(), tr.t("Idioma do navegador")),
                                        ("pt-BR".into(), "Português (Brasil)".into()),
                                        ("en".into(), "English".into()),
                                    ],
                                    self.prefs.locale().as_str(),
                                )
                                .label(tr.t("Idioma da interface"))
                                .plain()
                                .metrics(22.0, 13.0, 17.0)
                                .on_change(cx.listener(|this, value: &SharedString, _, cx| {
                                    if let Some(p) = Preference::parse(value) {
                                        this.set_language(p, cx)
                                    }
                                })),
                            ),
                        ),
                )
                .child(
                    div().mt(m.px(22.0)).flex().justify_end().child(
                        text_action("settings-advanced", tr.t("Desenvolvimento e recuperação"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.panels.settings_advanced = true;
                                cx.notify();
                            })),
                    ),
                )
                .into_any_element()
        } else {
            let expanded = self.prefs.horizontal_expansion;
            let tool = |id: &'static str, label: SharedString| {
                geppui::button(id).label(label).text(13.0, 400.0)
            };
            let message = tr.t(self.session.message());
            div()
                .mt(m.px(9.0))
                .child(
                    text_action("settings-back", tr.t("Voltar às configurações")).on_click(
                        cx.listener(|this, _, _, cx| {
                            this.panels.settings_advanced = false;
                            cx.notify();
                        }),
                    ),
                )
                .child(
                    div()
                        .mt(m.px(9.0))
                        .pb(m.px(16.0))
                        .border_b(m.border(1.0))
                        .border_color(t.border)
                        .flex()
                        .flex_col()
                        .gap(m.px(9.0))
                        .child(div().child(tr.t("Desenvolvimento")))
                        .child(
                            div()
                                .id("settings-expansion-row")
                                .flex()
                                .items_center()
                                .gap(m.px(6.0))
                                .cursor_pointer()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.set_expansion(!expanded, cx)
                                }))
                                .child(checkbox("settings-expansion", expanded).on_toggle(
                                    cx.listener(|this, on: &bool, _, cx| this.set_expansion(*on, cx)),
                                ))
                                .child(tr.t("Ativar expansão horizontal")),
                        )
                        .child(
                            div().text_color(t.text_muted).child(SharedString::from(format!(
                                "{} {}",
                                tr.t("A preferência é independente das posições. Sidebar mantém a organização vertical."),
                                message
                            ))),
                        )
                        .child(
                            div().flex().flex_wrap().gap(m.px(9.0)).child(
                                tool("settings-reset-preview", tr.t("Prévia da composição inicial"))
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.session.reset_preview(true);
                                        this.set_menu(None, None, Some(window), cx);
                                        this.after_preview(cx);
                                    })),
                            ),
                        )
                        .child(
                            div()
                                .id("settings-import-layout")
                                .m(m.px(12.0))
                                .text_size(m.px(10.0))
                                .text_color(t.text_muted)
                                .when(!self.editing(), |el| {
                                    el.cursor_pointer()
                                        .hover(move |s| s.text_color(t.text))
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.set_menu(None, None, Some(window), cx);
                                            this.import_layout(cx);
                                        }))
                                })
                                .child(tr.t("Importar layout")),
                        ),
                )
                .child(
                    div()
                        .mt(m.px(16.0))
                        .text_color(t.text_muted)
                        .text_size(m.px(12.0))
                        .child(tr.t("Plugins")),
                )
                .into_any_element()
        };
        let _ = window;
        dialog("settings", tr.t("Configurações"))
            .close_label(tr.t("Fechar configurações"))
            .on_dismiss(self.close_handler(cx))
            .child(body)
            .into_any_element()
    }

    fn notification_center(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let heading = popover_heading(
            "notifications-heading",
            tr.t("Notificações"),
            Some(tr.t("Acompanhe as novidades do seu espaço.")),
            tr.t("Fechar"),
            self.close_handler(cx),
            window,
            cx,
        )
        .into_any_element();
        let items = &self.panels.notifications;
        let unread_count = unread(items);
        let unread_only = self.panels.unread_only;
        let visible: Vec<&Notification> =
            items.iter().filter(|i| !unread_only || !i.read).collect();
        let entries = visible.iter().enumerate().map(|(i, item)| {
            let id = item.id.clone();
            let dismiss = item.id.clone();
            let title = tr.t(&item.title);
            let params: Vec<&str> = item.params.iter().map(String::as_str).collect();
            let time = format_time(item.at);
            div()
                .flex()
                .gap(m.px(4.0))
                .py(m.px(13.0))
                .when(i + 1 < visible.len(), |el| {
                    el.border_b(m.border(1.0)).border_color(t.border)
                })
                .child(
                    div()
                        .id(SharedString::from(format!("notification-{id}")))
                        .relative()
                        .flex_1()
                        .min_w_0()
                        .pl(m.px(14.0))
                        .rounded(m.px(5.0))
                        .cursor_pointer()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.notification_action(NotificationAction::Read(Some(id.clone())), cx)
                        }))
                        .when(!item.read, |el| {
                            el.child(
                                div()
                                    .absolute()
                                    .left_0()
                                    .top(m.px(19.0 - 13.0))
                                    .size(m.px(5.0))
                                    .rounded_full()
                                    .bg(t.accent),
                            )
                        })
                        .child(
                            div()
                                .text_size(m.px(12.0))
                                .line_height(m.px(18.0))
                                .font_weight(css_weight(600.0))
                                .child(title),
                        )
                        .child(
                            div()
                                .mt(m.px(4.0))
                                .mb(m.px(5.0))
                                .text_size(m.px(12.0))
                                .line_height(m.px(18.0))
                                .text_color(t.text_muted)
                                .child(tr.f(&item.message, &params)),
                        )
                        .when_some(item.detail.clone(), |el, d| {
                            el.child(
                                div()
                                    .text_size(m.px(12.0))
                                    .text_color(t.text_muted)
                                    .child(d),
                            )
                        })
                        .child(
                            div()
                                .text_size(m.px(10.0))
                                .text_color(t.text_muted)
                                .child(time),
                        ),
                )
                .child(
                    div().mt(m.px(-7.0)).child(
                        geppui::icon_button(
                            SharedString::from(format!("notification-dismiss-{dismiss}")),
                            "x-mark",
                        )
                        .label(tr.f("Dispensar: {0}", &[&tr.t(&item.title)]))
                        .color(t.text_muted)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.notification_action(
                                NotificationAction::Dismiss(dismiss.clone()),
                                cx,
                            )
                        })),
                    ),
                )
        });
        let entries: Vec<_> = entries.collect();
        popover("notifications", &self.panels.bell_anchor)
            .width(378.0)
            .on_dismiss(self.close_handler(cx))
            .on_escape(self.close_handler(cx))
            .child(heading)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(m.px(8.0))
                    .pb(m.px(11.0))
                    .border_b(m.border(1.0))
                    .border_color(t.border)
                    .child(
                        div()
                            .flex()
                            .gap(m.px(4.0))
                            .child(
                                chip(
                                    "notification-filter-all",
                                    tr.t("Todas"),
                                    None,
                                    !unread_only,
                                    false,
                                    m,
                                    t,
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.panels.unread_only = false;
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                chip(
                                    "notification-filter-unread",
                                    tr.t("Não lidas"),
                                    Some((unread_count, true)),
                                    unread_only,
                                    false,
                                    m,
                                    t,
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.panels.unread_only = true;
                                        cx.notify();
                                    },
                                )),
                            ),
                    )
                    .child(
                        text_action("notifications-read-all", tr.t("Ler todas"))
                            .icon("check")
                            .disabled(unread_count == 0)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.notification_action(NotificationAction::Read(None), cx)
                            })),
                    ),
            )
            .children(entries)
            .when(visible.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .py(m.px(29.0))
                        .text_size(m.px(12.0))
                        .text_color(t.text_muted)
                        .child(
                            div()
                                .mb(m.px(12.0))
                                .child(icon("bell", m).size(28.0).color(t.accent)),
                        )
                        .child(
                            div()
                                .text_size(m.px(13.0))
                                .text_color(t.text)
                                .child(tr.t("Você está em dia")),
                        )
                        .child(
                            div()
                                .mt(m.px(6.0))
                                .child(tr.t("As novidades aparecem por aqui.")),
                        ),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(m.px(11.0))
                    .mt(m.px(13.0))
                    .pt(m.px(13.0))
                    .border_t(m.border(1.0))
                    .border_color(t.border)
                    .text_size(m.px(11.0))
                    .text_color(t.text_muted)
                    .child(tr.t("Atividade deste espaço"))
                    .child(
                        text_action("notifications-clear", tr.t("Limpar"))
                            .disabled(items.is_empty())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.notification_action(NotificationAction::Clear, cx)
                            })),
                    ),
            )
            .into_any_element()
    }

    fn project_menu(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let demo = |this: &mut Self, text: &str, cx: &mut Context<Self>| {
            this.menu = None;
            let message = text.to_owned();
            this.edit.toast(&message, geppui::now(cx));
            cx.notify();
        };
        popover("project-menu", &self.panels.project_anchor)
            .width(260.0)
            .padding(9.0, 11.0)
            .menu(
                [
                    "project-rename",
                    "project-copy-path",
                    "project-info",
                    "project-export",
                ]
                .map(SharedString::from)
                .to_vec(),
            )
            .on_dismiss(self.close_handler(cx))
            .on_escape(self.close_handler(cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(m.px(4.0))
                    .mb(m.px(9.0))
                    .px(m.px(11.0))
                    .pt(m.px(9.0))
                    .pb(m.px(13.0))
                    .border_b(m.border(1.0))
                    .border_color(t.border)
                    .child(
                        div()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .font_weight(css_weight(700.0))
                            .child(self.project_name()),
                    )
                    .child(
                        div()
                            .text_size(m.px(11.0))
                            .text_color(t.text_muted)
                            .child(tr.t("Projeto atual")),
                    ),
            )
            .child(
                menu_item("project-rename", tr.t("Renomear projeto…"))
                    .icon("pencil-square")
                    .on_click(cx.listener(|this, _, _, cx| {
                        let trigger = this.panels.trigger.clone();
                        this.set_menu(Some(Menu::Rename), trigger, None, cx)
                    })),
            )
            .child(
                menu_item("project-copy-path", tr.t("Copiar caminho"))
                    .icon("clipboard-document")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let text = crate::i18n::tr(cx)
                            .t("Ação de demonstração. Nenhum caminho de projeto está conectado.");
                        demo(this, &text, cx)
                    })),
            )
            .child(
                menu_item("project-info", tr.t("Informações do projeto"))
                    .icon("information-circle")
                    .on_click(cx.listener(|this, _, _, cx| {
                        let trigger = this.panels.trigger.clone();
                        this.set_menu(Some(Menu::Info), trigger, None, cx)
                    })),
            )
            .child(
                menu_item("project-export", tr.t("Exportar configuração…"))
                    .icon("arrow-down-tray")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let text = crate::i18n::tr(cx)
                            .t("Ação de demonstração. Nenhum arquivo foi exportado.");
                        demo(this, &text, cx)
                    })),
            )
            .into_any_element()
    }

    fn rename_dialog(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let focused = self.panels.rename_field.read(cx).is_focused(window);
        dialog("rename", tr.t("Renomear projeto"))
            .close_label(tr.t("Fechar"))
            .on_dismiss(self.close_handler(cx))
            .child(
                div()
                    .mt(m.px(9.0))
                    .text_color(t.text_muted)
                    .line_height(m.px(13.0 * 1.6))
                    .child(tr.t("Escolha o nome exibido neste espaço de trabalho.")),
            )
            .child(
                div()
                    .mt(m.px(22.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(9.0))
                    .text_size(m.px(12.0))
                    .font_weight(css_weight(600.0))
                    .child(tr.t("Nome do projeto"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .min_h(m.px(38.0))
                            .px(m.px(11.0))
                            .rounded(m.px(8.0))
                            .border(m.border(1.0))
                            .border_color(t.input_border)
                            .bg(t.input)
                            .font_weight(css_weight(400.0))
                            .when(focused, |el| {
                                el.shadow(vec![
                                    gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), t.ring)
                                        .spread_radius(m.px(2.0)),
                                ])
                            })
                            .child(self.panels.rename_field.clone()),
                    ),
            )
            .when(self.panels.rename_error, |el| {
                el.child(
                    div()
                        .mt(m.px(9.0))
                        .text_size(m.px(12.0))
                        .text_color(t.accent)
                        .child(tr.t("Não foi possível salvar o nome. Tente novamente.")),
                )
            })
            .child(
                div()
                    .mt(m.px(22.0))
                    .flex()
                    .justify_end()
                    .items_center()
                    .gap(m.px(9.0))
                    .child(
                        dialog_button(
                            "rename-cancel",
                            tr.t("Cancelar"),
                            DialogButtonKind::Secondary,
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.set_menu(None, None, Some(window), cx)
                        })),
                    )
                    .child(
                        dialog_button(
                            "rename-save",
                            tr.t("Salvar nome"),
                            DialogButtonKind::Primary,
                        )
                        .on_click(cx.listener(|this, _, _, cx| this.submit_rename(cx))),
                    ),
            )
            .into_any_element()
    }

    fn info_dialog(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let widgets = active_placements(self.session.committed(), true).len();
        let rows = [
            (tr.t("Nome"), self.project_name()),
            (tr.t("Caminho"), "—".into()),
            (
                tr.t("Organização"),
                tr.t("Área principal, lateral e inferior"),
            ),
            (
                tr.t("Widgets visíveis"),
                tr.f("{0} widgets", &[&widgets.to_string()]),
            ),
        ];
        dialog("info", tr.t("Informações do projeto"))
            .close_label(tr.t("Fechar"))
            .on_dismiss(self.close_handler(cx))
            .child(
                div()
                    .mt(m.px(9.0))
                    .text_color(t.text_muted)
                    .line_height(m.px(13.0 * 1.6))
                    .child(tr.t("Uma visão geral do seu espaço de trabalho.")),
            )
            .child(
                div()
                    .mt(m.px(20.0))
                    .children(rows.into_iter().map(|(k, v)| {
                        div()
                            .flex()
                            .gap(m.px(11.0))
                            .py(m.px(11.0))
                            .border_t(m.border(1.0))
                            .border_color(t.border)
                            .text_size(m.px(12.0))
                            .line_height(m.px(18.0))
                            .child(
                                div()
                                    .w(m.px(90.0))
                                    .flex_none()
                                    .text_color(t.text_muted)
                                    .child(k),
                            )
                            .child(div().flex_1().min_w_0().child(v))
                    })),
            )
            .into_any_element()
    }

    fn plugins_popover(
        &self,
        m: geppui::Metrics,
        t: geppui::Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let heading = popover_heading(
            "plugins-heading",
            "Plugins",
            Some(tr.t("As ferramentas que fazem parte do seu espaço.")),
            tr.t("Fechar"),
            self.close_handler(cx),
            window,
            cx,
        )
        .into_any_element();
        let focused = self.panels.plugin_search.read(cx).is_focused(window);
        self.panels
            .plugin_search
            .update(cx, |f, _| f.set_placeholder(tr.t("Buscar plugins…")));
        let filter = self.panels.plugin_filter;
        let filter_chip = |id: &'static str, label: &str| {
            chip(
                SharedString::from(format!("plugin-filter-{id}")),
                tr.t(label),
                Some((0, false)),
                filter == id,
                true,
                m,
                t,
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                this.panels.plugin_filter = id;
                cx.notify();
            }))
        };
        let developer = self.panels.developer_mode;
        popover("plugins", &self.panels.plugins_anchor)
            .placement(Placement::Below)
            .width(650.0)
            .height(620.0)
            .contained()
            .on_dismiss(self.close_handler(cx))
            .on_escape(self.close_handler(cx))
            .child(heading)
            .child(
                div()
                    .flex()
                    .gap(m.px(11.0))
                    .child(div().flex_1().child(search_box(
                        &self.panels.plugin_search,
                        focused,
                        m,
                        t,
                    )))
                    .child(
                        div().w(m.px(145.0)).child(
                            select(
                                "plugins-sort",
                                vec![
                                    ("original".into(), tr.t("Ordem original")),
                                    ("name".into(), tr.t("Nome (A–Z)")),
                                ],
                                self.panels.plugin_sort.clone(),
                            )
                            .label(tr.t("Ordenar plugins"))
                            .metrics(36.0, 11.0, 15.0)
                            .on_change(cx.listener(
                                |this, v: &SharedString, _, cx| {
                                    this.panels.plugin_sort = v.clone();
                                    cx.notify();
                                },
                            )),
                        ),
                    ),
            )
            .child(
                div()
                    .id("plugins-developer-row")
                    .flex()
                    .items_center()
                    .justify_between()
                    .min_h(m.px(41.0))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.panels.developer_mode = !developer;
                        cx.notify();
                    }))
                    .child(tr.t("Modo desenvolvedor"))
                    .child(
                        switch("plugins-developer", developer)
                            .label(tr.t("Modo desenvolvedor"))
                            .on_toggle(cx.listener(|this, on: &bool, _, cx| {
                                this.panels.developer_mode = *on;
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .my(m.px(9.0))
                    .flex()
                    .gap(m.px(4.0))
                    .child(filter_chip("all", "Todos"))
                    .child(filter_chip("active", "Ativos"))
                    .child(filter_chip("disabled", "Desativados")),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .items_center()
                    .px(m.px(11.0))
                    .py(m.px(28.0))
                    .text_size(m.px(12.0))
                    .text_color(t.text_muted)
                    .child(
                        div()
                            .mb(m.px(9.0))
                            .child(tr.t("Nenhum plugin encontrado. Tente outra busca ou filtro.")),
                    )
                    .child(
                        div()
                            .id("plugins-clear-filters")
                            .px(m.px(6.0))
                            .py(m.px(4.0))
                            .rounded(m.px(6.0))
                            .cursor_pointer()
                            .hover(move |s| s.bg(t.control_hover).text_color(t.text))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.panels.plugin_filter = "all";
                                this.panels
                                    .plugin_search
                                    .update(cx, |f, cx| f.set_text("", cx));
                                cx.notify();
                            }))
                            .child(tr.t("Limpar filtros")),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(m.px(11.0))
                    .mt(m.px(9.0))
                    .pt(m.px(9.0))
                    .border_t(m.border(1.0))
                    .border_color(t.border)
                    .text_size(m.px(11.0))
                    .text_color(t.text_muted)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(tr.f("{0} de {1} plugins", &["0", "0"]))
                            .child(
                                div()
                                    .mt(m.px(3.0))
                                    .text_size(m.px(10.0))
                                    .child(tr.f("{0} plugins ativos", &["0"])),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(m.px(4.0))
                            .child(
                                text_action("plugins-manage", tr.t("Gerenciar widgets")).on_click(
                                    cx.listener(|this, _, window, cx| {
                                        this.set_menu(None, None, Some(window), cx);
                                        this.begin_edit(cx);
                                    }),
                                ),
                            )
                            // The signed-package install arrives with the plugin runtime (stage E).
                            .child(
                                text_action("plugins-install", tr.t("Instalar arquivo assinado"))
                                    .disabled(true),
                            )
                            .when(developer, |el| {
                                el.child(
                                    text_action(
                                        "plugins-load-folder",
                                        tr.t("Carregar pasta local"),
                                    )
                                    .disabled(true),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }

    pub(crate) fn set_snap(&mut self, on: bool, cx: &mut Context<Self>) {
        self.prefs.snap_center = on;
        if self.prefs.save(self.profile.as_ref()).is_err() {
            self.edit.toast(
                "Preferência alterada somente nesta sessão.",
                geppui::now(cx),
            );
        }
        self.record_local(cx);
        cx.notify();
    }

    pub(crate) fn set_expansion(&mut self, on: bool, cx: &mut Context<Self>) {
        self.prefs.horizontal_expansion = on;
        let _ = self.prefs.save(self.profile.as_ref());
        cx.notify();
    }

    /// After a Settings preview opened Edit: catalog closed, message shown.
    pub(crate) fn after_preview(&mut self, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let message = self.session.message().to_owned();
        self.edit.toast(&message, now);
        self.pending_focus = Some(true);
        cx.notify();
    }

    /// Settings "Importar layout": the OS file dialog, then the import preview. Only the file
    /// the user picked is read, at most 64 KiB + 1 bytes.
    pub(crate) fn import_layout(&mut self, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: None,
        });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = picked.await else {
                return;
            };
            let Some(path) = paths.into_iter().next() else {
                return;
            };
            // Off the UI thread: a cloud placeholder or a slow share must not freeze the
            // window. Metadata first (it does not hydrate a placeholder), then a bounded read.
            let read = cx
                .background_executor()
                .spawn(async move { read_layout_file(&path) })
                .await;
            let _ = this.update(cx, |this, cx| {
                let opened = match &read {
                    Ok(text) => this.session.import_preview(text),
                    Err(_) => false,
                };
                if opened {
                    this.after_preview(cx);
                } else {
                    let message = match read {
                        Err(LayoutFileError::TooLarge) => {
                            "A composição deve ter até 64 KiB.".to_owned()
                        }
                        Err(LayoutFileError::Unreadable) => {
                            "Arquivo incompatível. Dados anteriores preservados.".to_owned()
                        }
                        Ok(_) => this.session.message().to_owned(),
                    };
                    this.edit.toast(&message, geppui::now(cx));
                    cx.notify();
                }
            });
        })
        .detach();
    }
}

enum LayoutFileError {
    TooLarge,
    Unreadable,
}

/// Reads a user-picked layout file: a regular file of at most 64 KiB, UTF-8, BOM removed
/// (as the reference's `File.text()`).
fn read_layout_file(path: &std::path::Path) -> Result<String, LayoutFileError> {
    use std::io::Read as _;
    let max = geppio_core::layout::policy::MAX_BYTES as u64;
    let meta = std::fs::metadata(path).map_err(|_| LayoutFileError::Unreadable)?;
    if !meta.is_file() {
        return Err(LayoutFileError::Unreadable);
    }
    if meta.len() > max {
        return Err(LayoutFileError::TooLarge);
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(max + 1).read_to_end(&mut bytes))
        .map_err(|_| LayoutFileError::Unreadable)?;
    if bytes.len() as u64 > max {
        return Err(LayoutFileError::TooLarge);
    }
    let text = String::from_utf8(bytes).map_err(|_| LayoutFileError::Unreadable)?;
    Ok(text
        .strip_prefix('\u{feff}')
        .map(str::to_owned)
        .unwrap_or(text))
}

/// `HH:MM` of an entry. Entries only come from plugin events (stage E), which will record
/// local wall-clock minutes; this formats what the entry carries.
fn format_time(at_ms: f64) -> SharedString {
    let minutes = (at_ms / 60_000.0).floor() as i64;
    let (h, mi) = ((minutes / 60).rem_euclid(24), minutes.rem_euclid(60));
    SharedString::from(format!("{h:02}:{mi:02}"))
}
