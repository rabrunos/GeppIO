//! The main screen: global header, context row, concave workspace corner, rail, Sidebar
//! (docked, collapse, floating peek), Bottom, splitters, status bar and the Main area.
//! Geometry comes from `geppio_core::shell`; the animated tracks from [`Regions`].
use std::{collections::HashMap, path::PathBuf, time::Duration};

use geppio_core::shell::{self, Responsive, ShellLayout, Tracks};
use geppui::{
    AnchorHandle, Appearance, Metrics, Rect, TextField, Transition, anchor_probe, button,
    css_weight, icon, icon_button,
    motion::{self, duration},
    spaced_text,
};
use gpui::{
    AnyElement, App, AppContext, Context, Div, Entity, FocusHandle, Hsla, InteractiveElement,
    IntoElement, KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    ParentElement, Render, SharedString, StatefulInteractiveElement, Styled, Task, Window,
    WindowControlArea, div, img, prelude::FluentBuilder,
};

use geppio_core::layout::Region;
use geppio_core::workbench::{
    ChromeAdoption, EditSession, WorkbenchChrome, WorkbenchStore, widget_registry,
};
use gpui::ScrollHandle;

use crate::{
    automation::Automation,
    bars::BarsUi,
    edit::{EditUi, FileStore},
    edit_view::Ports,
    options::{Options, Start},
    panels::{Menu, Panels},
    prefs::Prefs,
    regions::{Axis, Publish, Regions, SidebarMode},
    widgets::Properties,
};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// A splitter pointer gesture (window CSS px); the sizes live in [`Regions`].
#[derive(Clone, Copy, Debug)]
struct SplitterDrag {
    axis: Axis,
    start: (f32, f32),
    last: (f32, f32),
}

/// The session-local state the edit history and Cancel restore (`LocalSessionState`).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalState {
    theme: String,
    snap: bool,
    project_name: String,
    properties: LocalProperties,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct LocalProperties {
    name: String,
    comfortable: bool,
    details: bool,
}

pub struct Workbench {
    focus: FocusHandle,
    pub(crate) profile: Option<PathBuf>,
    pub(crate) prefs: Prefs,
    pub(crate) regions: Regions,
    pub(crate) menu: Option<Menu>,
    pub(crate) profile_anchor: AnchorHandle,
    pub(crate) chevron: Transition,
    pub(crate) panels: Panels,
    pub(crate) bars: BarsUi,
    pub(crate) compositions: crate::compositions_view::CompositionsUi,
    /// Header triggers, which regain focus when their panel closes.
    pub(crate) triggers: Triggers,
    /// A text field to focus at the next render.
    pub(crate) pending_text_focus: Option<Entity<TextField>>,
    peek_timer: Option<Task<()>>,
    splitter: Option<SplitterDrag>,
    splitter_hover: [Transition; 2],
    splitter_hovered: [bool; 2],
    /// Focus of the Sidebar and Bottom splitters (keyboard resizing).
    splitter_focus: [FocusHandle; 2],
    /// Focus inside the floating Sidebar keeps the peek open.
    pub(crate) peek_focus: FocusHandle,
    peek_focused: bool,
    /// The confirmed chrome the regions last adopted.
    last_chrome: WorkbenchChrome,
    last_viewport: (f64, f64),
    pub(crate) viewport: (f64, f64),
    pub(crate) automation: Automation,
    pub(crate) session: EditSession,
    pub(crate) store: FileStore,
    pub(crate) edit: EditUi,
    pub(crate) ports: Ports,
    pub(crate) metrics: Metrics,
    pub(crate) scrolls: HashMap<String, ScrollHandle>,
    pub(crate) sidebar_scroll: ScrollHandle,
    pub(crate) main_scroll: ScrollHandle,
    pub(crate) properties: Properties,
    pub(crate) edit_focus: FocusHandle,
    pub(crate) save_focus: FocusHandle,
    /// Focus to apply at the next render: true = Salvar edição, false = Editar layout.
    pub(crate) pending_focus: Option<bool>,
    /// View awaiting the remove confirmation.
    pub(crate) removing: Option<String>,
    /// "Nome de exemplo" of the Propriedades demo widget.
    pub(crate) name_field: Entity<TextField>,
}

/// Focus handles of the header and context triggers.
pub struct Triggers {
    pub plugins: FocusHandle,
    pub bell: FocusHandle,
    pub profile: FocusHandle,
    pub more: FocusHandle,
}

fn regions_width(_s: &ShellLayout) -> f64 {
    geppio_core::shell::SIDEBAR_LIMITS.initial
}

/// Chromium `line-height: normal` for Segoe UI.
fn normal_line(size: f32) -> f32 {
    (size * 1.33).round()
}

pub(crate) fn abs(m: Metrics, r: shell_rect::R) -> Div {
    let p = m.place(r.into());
    div()
        .absolute()
        .left(p.left)
        .top(p.top)
        .w(p.width)
        .h(p.height)
}

/// `geppio_core` rectangles (f64) as GeppUI rectangles (f32).
pub(crate) mod shell_rect {
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
        let mut prefs = Prefs::load(options.profile.as_deref());
        crate::i18n::install(
            cx,
            crate::i18n::I18n {
                preference: prefs.locale(),
                system: crate::i18n::system_locale(),
            },
        );
        // The layout envelope lives in the native profile; demonstration widgets are on.
        let store = FileStore {
            dir: options.profile.clone(),
        };
        // An unreadable file is kept and opens in recovery; only a missing one starts fresh.
        let mut session = match store.get() {
            Ok(stored) => EditSession::open(widget_registry(&[], true), stored.as_deref(), true),
            Err(_) => EditSession::open_unreadable(widget_registry(&[], true)),
        };
        // Region chrome lives in the layout document (`organization.chrome`). The regions an
        // older host kept in preferences.json seed a document that still shows the default
        // ones; they stay in preferences.json until the document has settled them.
        if let Some(legacy) = prefs.legacy_chrome() {
            let mut store = store.clone();
            if session.adopt_initial_chrome(legacy, &mut store) != ChromeAdoption::Deferred {
                prefs.clear_legacy();
                let _ = prefs.save(options.profile.as_ref());
            }
        }
        let chrome = session.draft().organization.chrome;
        let mut regions = Regions::from_chrome(&chrome);
        match options.start {
            Start::Docked => {}
            Start::Collapsed => {
                regions = Regions::new(chrome.sidebar.size, chrome.bottom.size, true, false)
            }
            Start::Peek => {
                regions = Regions::new(chrome.sidebar.size, chrome.bottom.size, true, false);
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
            if !window.is_window_active() {
                this.window_blur(cx);
            }
            if window.is_window_active() && this.automation.reduced_override.is_none() {
                let reduced = crate::platform::reduced_motion();
                cx.global_mut::<Appearance>().reduced_motion = reduced;
                this.regions.reduced = reduced;
                cx.notify();
            }
        })
        .detach();
        let splitter_focus = [cx.focus_handle(), cx.focus_handle()];
        for (i, handle) in splitter_focus.iter().enumerate() {
            let axis = if i == 0 { Axis::X } else { Axis::Y };
            cx.on_blur(handle, window, move |this, _, cx| {
                this.splitter_blur(axis, cx)
            })
            .detach();
        }
        let search = cx.new(|cx| {
            TextField::new(cx)
                .font(12.0, 16.0)
                .placeholder(crate::i18n::t("Buscar widgets…"))
        });
        cx.subscribe(&search, |this, field, event, cx| {
            if *event == geppui::TextFieldEvent::Changed {
                this.edit.catalog.search = field.read(cx).text().to_owned();
                cx.notify();
            }
        })
        .detach();
        let properties = Properties::default();
        let name_field = cx.new(|cx| {
            let mut field = TextField::new(cx).font(10.0, 14.0);
            field.set_text(&properties.name, cx);
            field
        });
        cx.subscribe(&name_field, |this, field, event, cx| {
            if *event == geppui::TextFieldEvent::Changed && !this.editing() {
                this.properties.name = field.read(cx).text().to_owned();
                this.record_local(cx);
                cx.notify();
            }
        })
        .detach();
        let initial = ShellLayout::compute(1280.0, 800.0, Tracks::default());
        let mut this = Self {
            focus,
            profile: options.profile.clone(),
            prefs,
            regions,
            menu: None,
            profile_anchor: AnchorHandle::default(),
            chevron: Transition::new(0.0),
            panels: Panels::new(cx),
            bars: BarsUi::new(cx),
            compositions: crate::compositions_view::CompositionsUi::new(cx),
            triggers: Triggers {
                plugins: cx.focus_handle(),
                bell: cx.focus_handle(),
                profile: cx.focus_handle(),
                more: cx.focus_handle(),
            },
            pending_text_focus: None,
            peek_timer: None,
            splitter: None,
            splitter_hover: [Transition::new(0.0), Transition::new(0.0)],
            splitter_hovered: [false, false],
            splitter_focus,
            peek_focus: cx.focus_handle(),
            peek_focused: false,
            last_chrome: chrome,
            last_viewport: (1280.0, 800.0),
            viewport: (1280.0, 800.0),
            automation: Automation::new(options),
            session,
            store,
            edit: EditUi::new(search),
            ports: Ports::of(&initial, regions_width(&initial)),
            metrics: Metrics::default(),
            scrolls: HashMap::new(),
            sidebar_scroll: ScrollHandle::new(),
            main_scroll: ScrollHandle::new(),
            properties,
            edit_focus: cx.focus_handle(),
            save_focus: cx.focus_handle(),
            pending_focus: None,
            removing: None,
            name_field,
        };
        this.automation.start(&mut this.regions, cx);
        let local = this.local_json(cx);
        this.session.change_local(local);
        this
    }

    // ---- session-local state (`localState`) --------------------------------------------

    fn local_state(&self, cx: &App) -> LocalState {
        LocalState {
            theme: geppui::theme(cx).name.as_str().into(),
            snap: self.prefs.snap_center,
            project_name: self.prefs.project_name.clone(),
            properties: LocalProperties {
                name: self.properties.name.clone(),
                comfortable: self.properties.comfortable,
                details: self.properties.details,
            },
        }
    }

    fn local_json(&self, cx: &App) -> String {
        serde_json::to_string(&self.local_state(cx)).unwrap_or_default()
    }

    /// Records a change of the local state (`changeLocal`): undoable inside Edit.
    pub(crate) fn record_local(&mut self, cx: &mut Context<Self>) {
        let local = self.local_json(cx);
        if self.session.local() != Some(local.as_str()) {
            self.session.change_local(local);
        }
    }

    /// Applies the session's local state after undo, redo or Cancel (`localOwner.apply`).
    pub(crate) fn apply_local_state(&mut self, cx: &mut Context<Self>) {
        let Some(local) = self
            .session
            .local()
            .and_then(|l| serde_json::from_str::<LocalState>(l).ok())
        else {
            return;
        };
        if local == self.local_state(cx) {
            return;
        }
        let theme = if local.theme == "light" {
            geppui::ThemeName::Light
        } else {
            geppui::ThemeName::Dark
        };
        cx.global_mut::<Appearance>().set_theme(theme);
        self.prefs.snap_center = local.snap;
        self.prefs.project_name = local.project_name;
        if self.properties.name != local.properties.name {
            let name = local.properties.name.clone();
            self.name_field
                .update(cx, |field, cx| field.set_text(&name, cx));
        }
        self.properties.name = local.properties.name;
        self.properties.comfortable = local.properties.comfortable;
        self.properties.details = local.properties.details;
        if !self.save_prefs(cx) {
            self.edit.toast(
                "Preferência alterada somente nesta sessão.",
                geppui::now(cx),
            );
        }
        cx.notify();
    }

    // ---- regions in the layout document (`useRegions.publish`) --------------------------

    /// Records a region intention in `organization.chrome`: saved at once outside Edit
    /// ("Preferência salva."), one undoable intention inside it, refused in recovery. Edit
    /// keeps the confirmed visibility; unchanged chrome records nothing.
    pub(crate) fn publish(&mut self, p: Publish, cx: &mut Context<Self>) {
        let canonical = self.session.draft().organization.chrome;
        let mut chrome = canonical;
        let (limits, region) = match p.axis {
            Axis::X => (shell::SIDEBAR_LIMITS, &mut chrome.sidebar),
            Axis::Y => (shell::BOTTOM_LIMITS, &mut chrome.bottom),
        };
        region.size = p.size.clamp(limits.min, limits.max);
        if !self.regions.forced {
            region.visible = p.visible;
        }
        if chrome == canonical {
            return;
        }
        let mut next = self.session.draft().clone();
        next.organization.chrome = chrome;
        let editing = self.editing();
        match self.session.commit_organization(next, &mut self.store) {
            Ok(()) => {
                self.last_chrome = chrome;
                if !editing {
                    let message = self.session.message().to_owned();
                    self.edit.toast(&message, geppui::now(cx));
                }
            }
            Err(_) => {
                // The confirmed chrome comes back (`synchronize`).
                self.regions.sync(&canonical);
                self.last_chrome = canonical;
                let message = self.session.message().to_owned();
                self.edit.toast(&message, geppui::now(cx));
            }
        }
        cx.notify();
    }

    /// Follows the confirmed chrome and the Edit forcing rule, and the measured bounds; a
    /// viewport change cancels a splitter drag.
    fn sync_regions(&mut self) {
        let canonical = self.session.draft().organization.chrome;
        let forced = self.editing();
        if forced != self.regions.forced {
            self.splitter = None;
            self.regions.set_forced(forced);
            self.regions.sync(&canonical);
            self.last_chrome = canonical;
        }
        if canonical != self.last_chrome && !self.regions.changing() {
            self.regions.sync(&canonical);
            self.last_chrome = canonical;
        }
        let (w, h) = self.viewport;
        if (w, h) != self.last_viewport {
            if self.regions.cancel_drag() {
                self.splitter = None;
            }
            self.bars.reorder = None;
            self.last_viewport = (w, h);
        }
        self.regions.set_bounds(
            shell::sidebar_max(w),
            (h - shell::HEADER - shell::STATUS).min(shell::BOTTOM_LIMITS.max),
        );
    }

    /// The window lost focus: drags end without recording and keyboard adjustments revert.
    fn window_blur(&mut self, cx: &mut Context<Self>) {
        if self.regions.cancel_drag() {
            self.splitter = None;
        }
        self.regions.revert_keyboard();
        self.bars.reorder = None;
        self.bars.restore = None;
        self.edit_cancel_gesture(cx);
        self.compositions_cancel_drag(cx);
        cx.notify();
    }

    /// Moves focus as the edit UI asked (the reference's `focus()` calls).
    fn apply_edit_focus(
        &mut self,
        request: crate::edit::FocusRequest,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        use crate::edit::FocusRequest;
        match request {
            FocusRequest::Search => {
                let handle = gpui::Focusable::focus_handle(&self.edit.search, cx);
                window.focus(&handle, cx);
            }
            FocusRequest::Workbench => window.focus(&self.focus.clone(), cx),
            FocusRequest::Destination => {
                // The first enabled destination: refused areas take no focus.
                let tiles = self.tiles();
                if let Some(area) = self.first_destination(&tiles) {
                    let handle = crate::catalog::control_focus(
                        &format!("catalog-place-{}", area.key()),
                        window,
                        cx,
                    );
                    window.focus(&handle, cx);
                }
            }
            FocusRequest::Control(id) => {
                let handle = crate::catalog::control_focus(&id, window, cx);
                window.focus(&handle, cx);
            }
        }
    }

    /// A pending splitter keyboard resize is its own intention: it is settled before a widget
    /// gesture starts, so the gesture's Esc or undo never takes it along.
    pub(crate) fn settle_splitter_keyboard(&mut self, cx: &mut Context<Self>) {
        if let Some(p) = self.regions.commit_keyboard() {
            self.publish(p, cx);
        }
    }

    fn splitter_blur(&mut self, axis: Axis, cx: &mut Context<Self>) {
        let _ = axis;
        if let Some(p) = self.regions.commit_keyboard() {
            self.publish(p, cx);
        }
        cx.notify();
    }

    fn splitter_key(&mut self, axis: Axis, e: &KeyDownEvent, cx: &mut Context<Self>) {
        let k = &e.keystroke;
        let (handled, publish) = self.regions.key(axis, k.key.as_str(), k.modifiers.shift);
        if handled {
            if !self.regions.dragging() {
                self.splitter = None;
            }
            if let Some(p) = publish {
                self.publish(p, cx);
            }
            cx.stop_propagation();
            cx.notify();
        }
    }

    /// "Escolher widgets" (`begin`): Edit with the catalog on Widgets.
    pub(crate) fn choose_widgets(&mut self, cx: &mut Context<Self>) {
        self.edit.catalog.tab = crate::catalog::CatalogTab::Widgets;
        if self.editing() {
            if !self.edit.catalog_open {
                let now = geppui::now(cx);
                let reduced = geppui::appearance(cx).reduced_motion;
                self.edit.set_catalog(true, now, reduced);
            }
            cx.notify();
        } else {
            self.begin_edit(cx);
        }
    }

    /// Writes preferences.json; false when the write failed (the session keeps the value).
    pub(crate) fn save_prefs(&mut self, cx: &App) -> bool {
        self.prefs.theme = geppui::theme(cx).name.as_str().into();
        // A failed write keeps the session usable; the next change retries.
        self.prefs.save(self.profile.as_ref()).is_ok()
    }

    /// Theme from the rail, the profile menu or Settings (`changeLocal({ theme })`).
    pub(crate) fn toggle_theme(&mut self, cx: &mut Context<Self>) {
        let next = geppui::theme(cx).name.toggled();
        cx.global_mut::<Appearance>().set_theme(next);
        if !self.save_prefs(cx) {
            self.edit.toast(
                "Preferência alterada somente nesta sessão.",
                geppui::now(cx),
            );
        }
        self.record_local(cx);
        cx.notify();
    }

    /// Pin button or the active rail bar (`toggle('sidebar')`); nothing in Edit.
    pub(crate) fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        self.peek_timer = None;
        if let Some(p) = self.regions.toggle_sidebar() {
            self.publish(p, cx);
        }
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
                } else if !this.peek_focused {
                    // Focus inside the floating Sidebar keeps it open (`:focus-within`).
                    this.regions.close_peek();
                }
                cx.notify();
            });
        }));
    }

    pub(crate) fn peek_hover(&mut self, hovered: bool, cx: &mut Context<Self>) {
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
        // A release outside the window never reached us: end the gesture here.
        if event.pressed_button != Some(MouseButton::Left) {
            self.on_mouse_up(cx);
            return;
        }
        drag.last = (m.css(event.position.x), m.css(event.position.y));
        self.splitter = Some(drag);
        let delta = match drag.axis {
            Axis::X => (drag.last.0 - drag.start.0) as f64,
            Axis::Y => (drag.start.1 - drag.last.1) as f64,
        };
        self.regions.drag_by(delta);
        cx.notify();
    }

    fn on_mouse_up(&mut self, cx: &mut Context<Self>) {
        let Some(drag) = self.splitter.take() else {
            return;
        };
        let travel =
            ((drag.last.0 - drag.start.0).abs() + (drag.last.1 - drag.start.1).abs()) as f64;
        // A release under 4px of travel is a click: toggle the region (not in Edit).
        if let Some(p) = self.regions.end_drag(travel) {
            self.publish(p, cx);
        }
        let index = if drag.axis == Axis::X { 0 } else { 1 };
        let hovered = self.splitter_hovered[index];
        self.splitter_hover(index, hovered, cx);
        cx.notify();
    }

    fn on_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        // Keys inside the open "Remover widget?" dialog stay there: Escape closes only it.
        if self.removing.is_some() {
            if event.keystroke.key == "escape" {
                self.removing = None;
                cx.notify();
            }
            return;
        }
        if self.menu.is_none() && self.edit_key(event, cx) {
            return;
        }
        if event.keystroke.key == "escape" {
            if self.regions.cancel_drag() {
                self.splitter = None;
                cx.notify();
                return;
            }
            if self.menu.is_none() && self.compositions_escape(cx) {
                return;
            }
            if self.menu.is_none() && self.bars_escape(cx) {
                return;
            }
            if self.menu.is_none() && self.edit_escape(cx) {
                return;
            }
            if self.menu.is_some() {
                self.set_menu(None, None, Some(window), cx);
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
                             label: SharedString,
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
                    .child(
                        div()
                            .mt(m.half_pixel_nudge(14.5))
                            .child(crate::i18n::t("Projetos")),
                    )
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
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, _, cx| {
                                let trigger = this.triggers.more.clone();
                                this.set_menu(Some(Menu::Project), Some(trigger), None, cx)
                            }))
                            .child(
                                div()
                                    .mt(m.half_pixel_nudge(14.5))
                                    .child(self.project_name()),
                            )
                            .child(icon("chevron-down", m).size(18.0).color(t.text)),
                    )
                    .child(
                        div()
                            .occlude()
                            .relative()
                            .ml(m.px(11.0))
                            .child(anchor_probe(&self.panels.plugins_anchor))
                            .child(
                                button("plugins")
                                    .label(crate::i18n::t("Plugins"))
                                    .icon("squares-2x2", 16.0)
                                    .height(30.0, 8.0)
                                    .accent()
                                    .pressed(self.menu == Some(Menu::Plugins))
                                    .padding_x(8.0)
                                    .text(13.0, 650.0)
                                    .focus(&self.triggers.plugins)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        if this.menu == Some(Menu::Plugins) {
                                            this.set_menu(None, None, Some(window), cx)
                                        } else {
                                            let trigger = this.triggers.plugins.clone();
                                            this.set_menu(
                                                Some(Menu::Plugins),
                                                Some(trigger),
                                                None,
                                                cx,
                                            )
                                        }
                                    })),
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
                    .child({
                        let unread = self.unread_notifications();
                        let tr = crate::i18n::tr(cx);
                        div()
                            .occlude()
                            .relative()
                            .child(anchor_probe(&self.panels.bell_anchor))
                            .child(
                                icon_button("bell", "bell")
                                    .label(if unread > 0 {
                                        tr.f("Notificações, {0} não lidas", &[&unread.to_string()])
                                    } else {
                                        tr.t("Notificações")
                                    })
                                    .size(32.0, 24.0)
                                    .color(t.text)
                                    .hover_bg(t.chrome_hover)
                                    .focus(&self.triggers.bell)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        if this.menu == Some(Menu::Notifications) {
                                            this.set_menu(None, None, Some(window), cx)
                                        } else {
                                            let trigger = this.triggers.bell.clone();
                                            this.set_menu(
                                                Some(Menu::Notifications),
                                                Some(trigger),
                                                None,
                                                cx,
                                            )
                                        }
                                    })),
                            )
                            .when(unread > 0, |el| {
                                el.child(
                                    div()
                                        .absolute()
                                        .top(m.px(3.0))
                                        .right(m.px(3.0))
                                        .size(m.px(13.0))
                                        .rounded_full()
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .bg(t.notification)
                                        .text_color(t.primary_foreground)
                                        .text_size(m.px(8.0))
                                        .child(unread.to_string()),
                                )
                            })
                    })
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
                            .track_focus(&self.triggers.profile)
                            .when(profile_open, |el| el.bg(t.chrome_hover))
                            .hover(move |s| s.bg(t.chrome_hover))
                            .on_click(cx.listener(|this, _, window, cx| {
                                if this.menu == Some(Menu::Profile) {
                                    this.set_menu(None, None, Some(window), cx)
                                } else {
                                    let trigger = this.triggers.profile.clone();
                                    this.set_menu(Some(Menu::Profile), Some(trigger), None, cx)
                                }
                            }))
                            .child(anchor_probe(&self.profile_anchor))
                            .child(
                                img("avatar.png")
                                    .w(m.px(30.0))
                                    .h(m.px(31.0))
                                    .rounded_full()
                                    .flex_none(),
                            )
                            .when(!c.r.compact_header, |el| {
                                el.child(crate::i18n::tr(cx).t("Olá, Dev!"))
                            })
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
                                crate::i18n::t("Minimizar"),
                                WindowControlArea::Min,
                            ))
                            .child(window_button(
                                "window-max",
                                "stop",
                                crate::i18n::t("Maximizar"),
                                WindowControlArea::Max,
                            ))
                            .child(window_button(
                                "window-close",
                                "x-mark",
                                crate::i18n::t("Fechar"),
                                WindowControlArea::Close,
                            )),
                    ),
            )
    }

    fn context(&self, c: &Ctx, s: &ShellLayout, cx: &mut Context<Self>) -> Div {
        let (m, t) = (c.m, c.t);
        let editing = self.editing();
        let explorer = if c.r.compact_header {
            button("explorer")
                .icon("folder-open", 24.0)
                .width(36.0)
                .tooltip(crate::i18n::t("Ver arquivos"))
        } else {
            button("explorer")
                .icon("folder-open", 24.0)
                .label(crate::i18n::t("Ver arquivos"))
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
            // `.project-text { min-width: 0 }`: the title and subtitle shrink with an ellipsis.
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_shrink(1.0)
                    .min_w_0()
                    .overflow_hidden()
                    .mt(m.half_pixel_nudge(56.5))
                    .child(
                        spaced_text(self.project_name(), m)
                            .size(18.0, 22.0)
                            .weight(css_weight(700.0))
                            .color(t.text)
                            .letter_spacing_em(-0.25 / 18.0)
                            .truncate(),
                    )
                    .child(
                        div()
                            .text_size(m.px(12.0))
                            .line_height(m.px(16.0))
                            .text_color(t.text_muted)
                            .whitespace_nowrap()
                            .overflow_hidden()
                            .text_ellipsis()
                            .child(crate::i18n::t("Nenhuma pasta de projeto aberta")),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .gap(m.px(4.0))
                    .mx(m.px(14.0))
                    .child(
                        button("experience-workbench")
                            .label(crate::i18n::t("Bancada de Trabalho"))
                            .pressed(true)
                            .disabled(editing),
                    )
                    .child(
                        button("experience-code")
                            .label(crate::i18n::t("GeppIO Code"))
                            .tooltip(crate::i18n::t("GeppIO Code (fora do escopo desta etapa)"))
                            .disabled(editing),
                    ),
            )
            .child(
                // `.workspace-controls { max-width: 230px; min-width: 0 }`.
                button("project-local")
                    .label(crate::i18n::t("Projeto / arquivo avulso"))
                    .max_width(230.0)
                    .text(12.0, 400.0)
                    .tooltip(crate::i18n::t("Projeto local")),
            )
            .child(
                button("terminal")
                    .label(crate::i18n::t("Mostrar Terminal"))
                    .disabled(editing),
            )
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
                                .tooltip(crate::i18n::t("Editar layout"))
                                .when(editing, |b| b.accent())
                                .disabled(self.session.recovery() && !editing)
                                .focus(&self.edit_focus)
                                .on_click(cx.listener(|this, _, _, cx| this.begin_edit(cx))),
                        ),
                    )
                    .child(
                        div()
                            .relative()
                            .ml(m.px(6.0))
                            .child(anchor_probe(&self.panels.project_anchor))
                            .child(
                                button("project-more")
                                    .icon("ellipsis-horizontal", 24.0)
                                    .width(36.0)
                                    .tooltip(crate::i18n::t("Mais opções do projeto"))
                                    .focus(&self.triggers.more)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        if this.menu == Some(Menu::Project) {
                                            this.set_menu(None, None, Some(window), cx)
                                        } else {
                                            let trigger = this.triggers.more.clone();
                                            this.set_menu(
                                                Some(Menu::Project),
                                                Some(trigger),
                                                None,
                                                cx,
                                            )
                                        }
                                    })),
                            ),
                    ),
            )
    }

    fn empty_region(&self, c: &Ctx, id: &'static str, cx: &mut Context<Self>) -> Div {
        let (m, t) = (c.m, c.t);
        let disabled = self.session.recovery() && !self.editing();
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
                    .child(crate::i18n::t("Nenhum widget nesta área")),
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
                    .when(disabled, |el| el.opacity(0.5))
                    .when(!disabled, |el| {
                        el.cursor_pointer()
                            .hover(move |s| s.bg(t.control_hover).text_color(t.text))
                            .on_click(cx.listener(|this, _, _, cx| this.choose_widgets(cx)))
                    })
                    .child(crate::i18n::t("Escolher widgets")),
            )
    }

    #[allow(clippy::too_many_arguments)]
    fn sidebar_contents(
        &self,
        c: &Ctx,
        width: f32,
        floating: bool,
        height: f32,
        frames: Vec<AnyElement>,
        world: f32,
        cx: &mut Context<Self>,
    ) -> Div {
        let (m, t) = (c.m, c.t);
        let heading = {
            let tr = crate::i18n::tr(cx);
            let snapshot = self.session.draft();
            snapshot
                .organization
                .bars
                .iter()
                .find(|b| b.id == snapshot.organization.active_bar)
                .map(|b| self.bar_label(b, tr))
                .unwrap_or_default()
        };
        // Docked header: 50px with 9px top padding. Floating: 40px with 4.5px.
        let header_h = if floating { 40.0 } else { 50.0 };
        let (pin_top, heading_top) = if floating { (3.5, 4.5) } else { (13.5, 9.0) };
        let label = if floating {
            crate::i18n::t("Fixar barra lateral")
        } else {
            crate::i18n::t("Recolher barra lateral")
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
                        spaced_text(heading.to_uppercase(), m)
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
                        .disabled(self.editing())
                        .on_click(cx.listener(|this, _, _, cx| this.toggle_sidebar(cx))),
                    ),
            )
            .child({
                let port_h = (height - header_h - 18.0).max(0.0);
                let area = div().absolute().left(m.px(15.0)).top(m.px(header_h + 9.0));
                if frames.is_empty() {
                    area.w(m.px(width - 30.0))
                        .h(m.px(port_h))
                        .child(self.empty_region(
                            c,
                            if floating {
                                "sidebar-floating"
                            } else {
                                "sidebar"
                            },
                            cx,
                        ))
                } else {
                    // The 15px stable gutter sits right of the widget column (reference scrollbar).
                    area.w(m.px(width - 15.0)).h(m.px(port_h)).child(
                        geppui::scroll_area(
                            if floating {
                                "sidebar-floating-scroll"
                            } else {
                                "sidebar-scroll"
                            },
                            &self.sidebar_scroll,
                        )
                        .child(
                            div()
                                .relative()
                                .w(m.px(width - 30.0))
                                .h(m.px(world.max(port_h)))
                                .children(frames),
                        ),
                    )
                }
            })
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
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let (m, t) = (c.m, c.t);
        let mut out = Vec::new();
        // `:focus-visible`: the accent line follows keyboard focus (or a pending keyboard
        // resize), not focus that a click or a closing popover left on the splitter.
        let keyboard = window.last_input_was_keyboard();
        let focused = [Axis::X, Axis::Y].map(|axis| {
            let i = if axis == Axis::X { 0 } else { 1 };
            self.splitter_focus[i].is_focused(window)
                && (keyboard || self.regions.keyboard_pending(axis))
        });
        let opacity = |i: usize| {
            if focused[i] {
                0.75
            } else {
                self.splitter_hover[i].value(now) as f32
            }
        };
        let docked = self.regions.mode() == SidebarMode::Docked;
        if docked || self.splitter.is_some_and(|d| d.axis == Axis::X) {
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
                .track_focus(&self.splitter_focus[0].clone().tab_stop(docked))
                .cursor_col_resize()
                .on_hover(cx.listener(|this, h: &bool, _, cx| this.splitter_hover(0, *h, cx)))
                .on_key_down(
                    cx.listener(|this, e: &KeyDownEvent, _, cx| this.splitter_key(Axis::X, e, cx)),
                )
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, e: &MouseDownEvent, window, cx| {
                        let pos = (m.css(e.position.x), m.css(e.position.y));
                        this.regions.begin_drag(Axis::X);
                        this.splitter = Some(SplitterDrag {
                            axis: Axis::X,
                            start: pos,
                            last: pos,
                        });
                        window.focus(&this.splitter_focus[0], cx);
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
                .track_focus(&self.splitter_focus[1].clone().tab_stop(true))
                .cursor_row_resize()
                .on_hover(cx.listener(|this, h: &bool, _, cx| this.splitter_hover(1, *h, cx)))
                .on_key_down(
                    cx.listener(|this, e: &KeyDownEvent, _, cx| this.splitter_key(Axis::Y, e, cx)),
                )
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, e: &MouseDownEvent, window, cx| {
                        let pos = (m.css(e.position.x), m.css(e.position.y));
                        this.regions.begin_drag(Axis::Y);
                        this.splitter = Some(SplitterDrag {
                            axis: Axis::Y,
                            start: pos,
                            last: pos,
                        });
                        window.focus(&this.splitter_focus[1], cx);
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
                    .child(crate::i18n::t("Nenhum documento"))
                    .child(
                        div()
                            .px(m.px(3.0))
                            .child(crate::i18n::t("Terminal: sem sessão")),
                    ),
            )
            .when(!c.r.narrow, |el| el.child(div().child(VERSION)))
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
        self.metrics = m;
        // A window resize changes every measured region: a running edit gesture ends.
        if self.viewport != self.last_viewport {
            self.edit_cancel_gesture(cx);
            self.compositions_cancel_drag(cx);
        }
        self.sync_regions();
        if let Some(request) = self.edit.focus.take() {
            self.apply_edit_focus(request, window, cx);
        }
        self.edit.search_focused = self.edit.search.read(cx).is_focused(window);
        self.peek_focused = self.peek_focus.contains_focused(window, cx);
        if let Some(field) = self.pending_text_focus.take() {
            let handle = gpui::Focusable::focus_handle(&field, cx);
            window.focus(&handle, cx);
        }
        if let Some(save) = self.pending_focus.take() {
            let handle = if save {
                self.save_focus.clone()
            } else {
                self.edit_focus.clone()
            };
            window.focus(&handle, cx);
        }
        let frame = self.regions.sample(now);
        let catalog_track = self.edit.catalog_track.sample(now);
        self.edit.settle(now);
        self.chevron.sample(now);
        for i in 0..2 {
            self.splitter_hover[i].sample(now);
        }
        let rail_scrolling = self.rail_autoscroll(cx);
        let edit_scrolling = self.edit_tick(cx) | self.compositions_autoscroll(cx);
        // Undo/redo pressed during a drop flight run when it lands.
        if self.edit.flight.is_none() && !self.edit.queued.is_empty() {
            for command in std::mem::take(&mut self.edit.queued) {
                self.edit_command(command, cx);
            }
        }
        let animating = rail_scrolling
            || edit_scrolling
            || self.regions.animating(now)
            || self.chevron.animating(now)
            || self.splitter_hover.iter().any(|h| h.animating(now))
            || self.edit.animating(now)
            || self.compositions.animating(now);
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
            sidebar_width: self.regions.shown_sidebar_width(),
            bottom_height: self.regions.bottom_layout_height(),
            catalog: catalog_track,
        };
        let s = ShellLayout::compute(w, h, tracks);
        self.ports = Ports::of(&s, self.regions.shown_sidebar_width());
        self.ports.surfaces.expanded = self.prefs.horizontal_expansion;
        let editing = self.editing();
        let main_frames = self.region_frames(Region::Main, m, t, now, editing, window, cx);
        let bottom_frames = self.region_frames(Region::Bottom, m, t, now, editing, window, cx);
        let sidebar_frames = self.region_frames(Region::Sidebar, m, t, now, editing, window, cx);
        let sidebar_world = self.sidebar_world();
        let (edit_below, edit_top) = self.edit_layers(&s, m, t, now, window, cx);
        let floating_port = (
            (s.floating.w - 2.0 - 30.0) as f32,
            (s.floating.h - 2.0 - 40.0 - 18.0) as f32,
        );
        let (floating_frames, floating_world) = if self.regions.floating {
            self.floating_frames(floating_port.0, floating_port.1, m, t, cx)
        } else {
            (Vec::new(), 0.0)
        };
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
        layers.push(self.context(&c, &s, cx).into_any_element());
        // Main region.
        layers.push(if main_frames.is_empty() {
            abs(m, s.main_port.into())
                .child(self.empty_region(&c, "main", cx))
                .into_any_element()
        } else {
            // An infeasible projection keeps reference geometry: Main scrolls on both axes with
            // the thin platform bars of `.placement-port`.
            let (world_w, world_h) = self.main_world();
            abs(m, s.main_port.into())
                .child(
                    geppui::scroll_area("main-port", &self.main_scroll)
                        .both_axes(
                            (world_w, world_h),
                            (s.main_port.w as f32, s.main_port.h as f32),
                        )
                        .child(
                            div()
                                .relative()
                                .w(m.px(world_w))
                                .h(m.px(world_h))
                                .children(main_frames),
                        ),
                )
                .into_any_element()
        });
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
                            .child(if bottom_frames.is_empty() {
                                self.empty_region(&c, "bottom", cx).into_any_element()
                            } else {
                                div()
                                    .relative()
                                    .size_full()
                                    .children(bottom_frames)
                                    .into_any_element()
                            }),
                    )
                    .into_any_element(),
            );
        }
        let splitters = self.splitters(&c, &s, now, window, cx);
        // "Ampliar Bottom": Bottom cannot fit its widgets' minimums (`bottom-recovery`).
        let bottom_infeasible = {
            let (view, feasible) = self.session.view(&self.ports.surfaces);
            !feasible.bottom && view.placements.iter().any(|p| p.region == Region::Bottom)
        };
        if bottom_infeasible && s.bottom_clip.h > 30.0 {
            let tr = crate::i18n::tr(cx);
            layers.push(
                abs(
                    m,
                    rect(
                        s.bottom_clip.x + 15.0,
                        s.bottom_clip.y + 15.0,
                        (s.bottom_clip.w - 30.0).max(0.0),
                        (s.bottom_clip.h - 30.0).max(0.0),
                    ),
                )
                .id("bottom-recovery")
                .occlude()
                .flex()
                .flex_wrap()
                .items_center()
                .content_center()
                .gap(m.px(6.0))
                .bg(t.surface)
                .text_color(t.text)
                .child(
                    div()
                        .w_full()
                        .child(tr.t("Espaço insuficiente. Amplie a região antes de salvar.")),
                )
                .child(
                    button("bottom-recovery-expand")
                        .label(tr.t("Ampliar Bottom"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            let p = this.regions.expand_bottom();
                            this.publish(p, cx);
                        })),
                )
                .into_any_element(),
            );
        }
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
                        self.regions.shown_sidebar_width() as f32,
                        false,
                        height,
                        sidebar_frames,
                        sidebar_world,
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
                    .track_focus(&self.peek_focus)
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
                    .child(self.sidebar_contents(
                        &c,
                        (f.w - 2.0) as f32,
                        true,
                        inner_h,
                        floating_frames,
                        floating_world,
                        cx,
                    ))
                    .into_any_element(),
            );
        }
        layers.push(self.rail(m, t, s.rail, cx).into_any_element());
        if let Some(separator) = self.rail_separator(&c, &s, frame.track) {
            layers.push(separator);
        }
        layers.extend(edit_below);
        // Splitters stay usable in Edit (resize without collapsing).
        layers.extend(splitters);
        layers.push(self.status_bar(&c, &s).into_any_element());
        layers.push(self.header(&c, cx).into_any_element());
        layers.extend(self.overlays(m, t, window, cx));
        layers.extend(self.bar_overlays(m, t, window, cx));
        layers.extend(self.composition_overlays(m, t, window, cx));
        layers.extend(edit_top);

        if let Some(drag) = self.splitter.filter(|_| self.regions.resizing.is_some()) {
            let cover =
                div()
                    .id("splitter-drag-cover")
                    .absolute()
                    .left_0()
                    .top_0()
                    .size_full()
                    .occlude()
                    .on_mouse_move(cx.listener(move |this, e: &MouseMoveEvent, _, cx| {
                        this.on_mouse_move(e, m, cx)
                    }))
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(|this, _: &MouseUpEvent, _, cx| this.on_mouse_up(cx)),
                    );
            layers.push(
                gpui::deferred(if drag.axis == Axis::X {
                    cover.cursor_col_resize()
                } else {
                    cover.cursor_row_resize()
                })
                .with_priority(5)
                .into_any_element(),
            );
        }
        if self.automation.trace.is_some() {
            self.trace_edit_state(now, window, cx);
        }
        let floating = s.floating;
        let (context_rect, status_rect) = (s.context, s.status);
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
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, window, cx| {
                if e.keystroke.key == "tab" && !e.keystroke.modifiers.control {
                    if e.keystroke.modifiers.shift {
                        window.focus_prev(cx);
                    } else {
                        window.focus_next(cx);
                    }
                    return;
                }
                this.on_key(e, window, cx)
            }))
            .on_mouse_move(cx.listener(move |this, e: &MouseMoveEvent, _, cx| {
                if !geppui::appearance(cx).clock.frozen() {
                    let pos = (m.css(e.position.x), m.css(e.position.y));
                    let pressed = e.pressed_button == Some(MouseButton::Left);
                    if !this.compositions_move(pos, pressed, cx)
                        && !this.bars_move(pos, cx)
                        && !this.edit_move(pos, pressed, cx)
                    {
                        this.on_mouse_move(e, m, cx)
                    }
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, e: &MouseUpEvent, _, cx| {
                    let m = this.metrics;
                    let pos = (m.css(e.position.x), m.css(e.position.y));
                    if !this.compositions_up(cx) && !this.bars_up(cx) && !this.edit_up(pos, cx) {
                        this.on_mouse_up(cx)
                    }
                }),
            )
            // The window captures the mouse during a press: a release outside it ends the
            // gesture as a release (pointer capture in the reference).
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, e: &MouseUpEvent, _, cx| {
                    let m = this.metrics;
                    let pos = (m.css(e.position.x), m.css(e.position.y));
                    if !this.compositions_up(cx) && !this.bars_up(cx) && !this.edit_up(pos, cx) {
                        this.on_mouse_up(cx)
                    }
                }),
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
                        && !context_rect.contains(x, y)
                        && !status_rect.contains(x, y)
                    {
                        this.regions.close_peek();
                        cx.notify();
                    }
                }),
            )
            .children(layers)
    }
}
