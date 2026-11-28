//! The widget catalog column (480px, docked right of Main/Bottom while editing):
//! the Widgets / Composições tabs, search, the plugin filter, area filters, the slot banner,
//! categories with "Explore plugins", the tile grid with presences, the destination box and
//! the footer (`EditorPanel.tsx`, `widget-browser.css` at alpha.99). Availability and the
//! reasons come from the core.
use std::collections::HashMap;
use std::rc::Rc;

use geppui::{AnchorHandle, Metrics, Theme, anchor_probe, css_weight, icon, titled};
use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, FocusHandle, InteractiveElement, IntoElement,
    KeyDownEvent, MouseButton, MouseDownEvent, ParentElement, ScrollHandle, SharedString, Stateful,
    StatefulInteractiveElement, Styled, Window, div, prelude::FluentBuilder,
};

/// The catalog tab.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CatalogTab {
    #[default]
    Widgets,
    Compositions,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Area {
    Sidebar,
    Main,
    Bottom,
}

impl Area {
    pub const ALL: [Area; 3] = [Area::Sidebar, Area::Main, Area::Bottom];
    pub fn label(self) -> &'static str {
        match self {
            Area::Sidebar => "Lateral",
            Area::Main => "Principal",
            Area::Bottom => "Inferior",
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Area::Sidebar => "sidebar",
            Area::Main => "main",
            Area::Bottom => "bottom",
        }
    }
}

/// One catalog entry as the core reports it.
#[derive(Clone, Debug, PartialEq)]
pub struct Tile {
    pub id: &'static str,
    pub title: &'static str,
    pub category: &'static str,
    /// Owner (`host` or a plugin) for the plugin filter.
    pub owner: &'static str,
    /// Why the chosen slot cannot take it (slot mode only).
    pub reason: Option<SharedString>,
    /// Regions where adding it is currently feasible (a free area or an accepting slot).
    pub available: Vec<Area>,
    /// The regions the type allows (`constraint.regions`).
    pub allowed: Vec<Area>,
    /// The presences under the tile: view id and area, the Sidebar only for the active bar,
    /// in Sidebar → Main → Bottom order.
    pub presences: Vec<(String, Area)>,
    /// Why no area can take it (`unavailable`).
    pub unavailable: SharedString,
}

pub fn glyph(id: &str) -> &'static str {
    match id.strip_prefix("host:").unwrap_or(id) {
        "summary" | "chart" => "chart-bar",
        "queue" => "queue-list",
        "library" => "folder",
        "notes" => "clipboard-document-list",
        "activity" => "clock",
        "properties" => "adjustments-horizontal",
        _ => "squares-2x2",
    }
}

fn category_glyph(category: &str) -> &'static str {
    match category {
        "Indicadores" => "chart-bar",
        "Organização" => "queue-list",
        "Anotações" => "clipboard-document-list",
        "Desenvolvimento" => "code-bracket",
        _ => "squares-2x2",
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct CatalogState {
    pub tab: CatalogTab,
    pub search: String,
    /// Empty means all areas.
    pub areas: Vec<Area>,
    pub category: Option<&'static str>,
    pub destination: Option<&'static str>,
    /// The view the destination box moves (`movingTarget`): set by a short click on a
    /// frame's grip, `None` for a catalog insertion.
    pub moving: Option<String>,
    /// Owner filter (`None` = all plugins).
    pub plugin: Option<&'static str>,
    pub plugin_menu: bool,
    /// The chosen format slot (`chosenSlot`).
    pub slot: Option<String>,
    /// Filters to restore when the slot choice ends (`previous`).
    pub saved: Option<Box<CatalogState>>,
}

/// The display name of an owner (`ownerName`).
pub fn owner_name(owner: Option<&str>) -> SharedString {
    match owner {
        None => crate::i18n::t("Todos os plugins"),
        Some("host") => "GeppIO".into(),
        Some(other) => other.to_owned().into(),
    }
}

/// Accent- and case-insensitive search key (`normalizeSearch`: NFD without diacritics,
/// lower case), for the Latin letters the catalogue uses.
pub fn normalize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            'ñ' | 'Ñ' => 'n',
            other => other.to_lowercase().next().unwrap_or(other),
        })
        .collect()
}

impl CatalogState {
    /// The area filter (`types`): the type allows one of the chosen areas.
    pub fn in_areas(&self, tile: &Tile) -> bool {
        self.areas.is_empty() || self.areas.iter().any(|a| tile.allowed.contains(a))
    }

    /// Accent/case-normalized substring match over the title, the plugin and the areas
    /// (`matches`).
    pub fn matches(&self, tile: &Tile) -> bool {
        let text = normalize(&self.search);
        (text.is_empty()
            || normalize(&format!(
                "{} {} {}",
                crate::i18n::t(tile.title),
                tile.title,
                owner_name(Some(tile.owner))
            ))
            .contains(text.trim()))
            && self.plugin.is_none_or(|p| p == tile.owner)
            && self.in_areas(tile)
    }

    /// A plugin or a category that no longer has entries falls back to "all"
    /// (`selectedPlugin`, `selectedCategory`). Returns whether anything changed.
    pub fn normalize(&mut self, tiles: &[Tile]) -> bool {
        let mut changed = false;
        if let Some(p) = self.plugin
            && !tiles
                .iter()
                .any(|tile| self.in_areas(tile) && tile.owner == p)
        {
            self.plugin = None;
            changed = true;
        }
        if let Some(c) = self.category
            && !tiles
                .iter()
                .any(|tile| self.matches(tile) && tile.category == c)
        {
            self.category = None;
            changed = true;
        }
        changed
    }

    /// What resets the grid's scroll to the top when it changes.
    pub fn filter_key(&self) -> String {
        format!(
            "{}|{:?}|{:?}|{:?}|{:?}",
            self.search, self.areas, self.plugin, self.category, self.slot
        )
    }
}

pub type Click = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

pub type AreaAction = Rc<dyn Fn(Option<Area>, &mut Window, &mut App)>;
pub type TabAction = Rc<dyn Fn(CatalogTab, &mut Window, &mut App)>;
pub type CategoryAction = Rc<dyn Fn(Option<&'static str>, &mut Window, &mut App)>;
pub type TileAction = Rc<dyn Fn(&'static str, &mut Window, &mut App)>;
pub type PlaceAction = Rc<dyn Fn(Area, &mut Window, &mut App)>;
pub type PressAction = Rc<dyn Fn(&'static str, &MouseDownEvent, &mut Window, &mut App)>;
pub type PresenceAction = Rc<dyn Fn(String, &mut Window, &mut App)>;
pub type Mark = Rc<dyn Fn(&mut Window, &mut App)>;

pub struct CatalogActions {
    pub select_tab: TabAction,
    pub toggle_plugin_menu: Click,
    pub explore: Click,
    pub cancel_slot: Click,
    pub clear_filters: Click,
    /// An area filter, or `None` for "Todas as áreas".
    pub toggle_area: AreaAction,
    pub choose_category: CategoryAction,
    pub choose_tile: TileAction,
    pub place: PlaceAction,
    /// Pointer-down on a tile (drag source); receives the CSS position of the press.
    pub press_tile: PressAction,
    /// A presence button: asks to remove that view.
    pub remove_presence: PresenceAction,
    /// A click in the widget browser outside the tiles and the destination box.
    pub close_destination: Click,
    /// Marks a click as inside a tile or the destination box (the outside-click handler
    /// of the browser runs after it and keeps the box). The click still reaches the window,
    /// so a pointer gesture always ends.
    pub inside: Mark,
}

/// The destination box ("Onde colocar {0}?").
pub struct Destination {
    pub title: SharedString,
    pub policy: SharedString,
    /// Per area (Sidebar, Main, Bottom): why it is refused, `None` when it is enabled.
    pub reasons: [Option<SharedString>; 3],
}

/// The transient motion of the catalog at frame time.
#[derive(Clone, Copy, Debug, Default)]
pub struct CatalogMotion {
    /// The slot banner and the grid entering after a slot was chosen: (opacity, offset) of
    /// the banner content (−6px → 0) and of the grid (6px → 0).
    pub banner: Option<(f32, f32)>,
    pub grid: Option<(f32, f32)>,
    /// The rejected tile and its offset (the 280ms shake).
    pub shake: Option<(&'static str, (f32, f32))>,
}

/// What the catalog column shows besides the widget tiles.
pub struct CatalogExtra {
    /// The composition library (Composições tab).
    pub compositions: Option<AnyElement>,
    /// "{área}, espaço N" of the chosen slot.
    pub slot_label: Option<SharedString>,
    /// Records the funnel button for the plugin filter popover.
    pub filter_anchor: AnchorHandle,
    /// The search field.
    pub search: AnyElement,
    pub destination: Option<Destination>,
    pub grid_scroll: ScrollHandle,
    pub category_scroll: ScrollHandle,
    /// The tiles' layout bounds (the drag picture starts there and a refusal returns there).
    pub anchors: HashMap<&'static str, AnchorHandle>,
    pub motion: CatalogMotion,
}

pub(crate) fn region_icon(area: Option<Area>, m: Metrics, color: gpui::Hsla) -> AnyElement {
    // Outer frame plus the highlighted area at 40% (RegionIcon at alpha.99).
    let (x, y, w, h) = match area {
        None => (4.0, 5.0, 16.0, 14.0),
        Some(Area::Sidebar) => (4.0, 5.0, 3.0, 14.0),
        Some(Area::Main) => (9.0, 5.0, 11.0, 14.0),
        Some(Area::Bottom) => (4.0, 16.0, 16.0, 3.0),
    };
    let k = 19.0 / 24.0;
    div()
        .relative()
        .size(m.px(19.0))
        .child(
            div()
                .absolute()
                .left(m.px(3.0 * k))
                .top(m.px(4.0 * k))
                .w(m.px(18.0 * k))
                .h(m.px(16.0 * k))
                .rounded(m.px(2.0 * k))
                .border(m.px(1.7 * k))
                .border_color(color),
        )
        .child(
            div()
                .absolute()
                .left(m.px(x * k))
                .top(m.px(y * k))
                .w(m.px(w * k))
                .h(m.px(h * k))
                .bg(color.opacity(0.4)),
        )
        .into_any_element()
}

/// A control that takes keyboard focus (Enter/Space click it) and shows the focus ring.
pub(crate) fn focusable(
    el: Stateful<Div>,
    id: &str,
    enabled: bool,
    t: Theme,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    if !enabled {
        return el;
    }
    let handle = geppui::button::focus_handle(&SharedString::from(id.to_owned()), None, window, cx);
    let ring = t.ring;
    el.track_focus(&handle).focus_visible(move |s| {
        s.shadow(vec![
            gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), ring).spread_radius(gpui::px(2.0)),
        ])
    })
}

/// The focus handle of a catalog control by id (`catalog-tile-{type}`, `catalog-place-{area}`).
pub fn control_focus(id: &str, window: &mut Window, cx: &mut App) -> FocusHandle {
    geppui::button::focus_handle(&SharedString::from(id.to_owned()), None, window, cx)
}

#[allow(clippy::too_many_arguments)]
pub fn render(
    state: &CatalogState,
    tiles: &[Tile],
    m: Metrics,
    t: Theme,
    a: CatalogActions,
    extra: CatalogExtra,
    window: &mut Window,
    cx: &mut App,
) -> Div {
    let tab_ids = ["catalog-tab-widgets", "catalog-tab-compositions"];
    let tab_handles = [
        control_focus(tab_ids[0], window, cx),
        control_focus(tab_ids[1], window, cx),
    ];
    let tab_button = |value: CatalogTab, label: &'static str, index: usize| {
        let selected = state.tab == value;
        let select = a.select_tab.clone();
        let keys = a.select_tab.clone();
        let other = tab_handles[1 - index].clone();
        let first = tab_handles[0].clone();
        let last = tab_handles[1].clone();
        let ring = t.ring;
        div()
            .id(ElementId::Name(tab_ids[index].into()))
            .role(gpui::Role::Tab)
            .aria_label(crate::i18n::t(label))
            .aria_selected(selected)
            // A roving tab stop: only the selected tab is in the Tab order.
            .track_focus(&tab_handles[index].clone().tab_stop(selected))
            .focus_visible(move |s| {
                s.shadow(vec![
                    gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), ring)
                        .spread_radius(gpui::px(2.0)),
                ])
            })
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .gap(m.px(7.0))
            .min_h(m.px(34.0))
            .px(m.px(11.0))
            .py(m.px(7.0))
            .rounded_t(m.px(7.0))
            .border_b(m.border(2.0))
            .border_color(if selected {
                t.accent
            } else {
                gpui::transparent_black()
            })
            .when(selected, |el| el.bg(t.accent_soft))
            .when(!selected, |el| el.hover(move |s| s.bg(t.control_hover)))
            .text_color(if selected { t.accent } else { t.text_muted })
            .font_weight(css_weight(600.0))
            .cursor_pointer()
            .on_click(move |_, w, cx| select(value, w, cx))
            .on_key_down(move |e: &KeyDownEvent, w, cx| {
                let (target, handle) = match e.keystroke.key.as_str() {
                    "home" => (CatalogTab::Widgets, &first),
                    "end" => (CatalogTab::Compositions, &last),
                    "left" | "right" => (
                        if value == CatalogTab::Widgets {
                            CatalogTab::Compositions
                        } else {
                            CatalogTab::Widgets
                        },
                        &other,
                    ),
                    _ => return,
                };
                keys(target, w, cx);
                w.focus(handle, cx);
                cx.stop_propagation();
            })
            .child(icon("squares-2x2", m).size(16.0).color(if selected {
                t.accent
            } else {
                t.text_muted
            }))
            .child(crate::i18n::t(label))
    };
    let tabs = [
        tab_button(CatalogTab::Widgets, "Widgets", 0),
        tab_button(CatalogTab::Compositions, "Composições", 1),
    ];
    let root = div()
        .size_full()
        .flex()
        .flex_col()
        .rounded_tl(m.px(17.0))
        .border_t(m.border(1.0))
        .border_l(m.border(1.0))
        .border_color(t.border)
        .bg(t.elevated)
        .text_size(m.px(12.0))
        .line_height(m.px(16.0))
        .text_color(t.text)
        .child(
            div()
                .flex()
                .flex_none()
                .gap(m.px(7.0))
                .pt(m.px(9.0))
                .px(m.px(11.0))
                .border_b(m.border(1.0))
                .border_color(t.border)
                .children(tabs),
        );
    if state.tab == CatalogTab::Compositions {
        return root.children(extra.compositions);
    }
    let choosing = state.slot.is_some();
    let matching: Vec<&Tile> = tiles.iter().filter(|tile| state.matches(tile)).collect();
    let visible: Vec<&Tile> = matching
        .iter()
        .copied()
        .filter(|tile| state.category.is_none_or(|c| tile.category == c))
        .collect();
    let mut categories: Vec<(&'static str, usize)> = Vec::new();
    for tile in &matching {
        match categories.iter_mut().find(|(c, _)| *c == tile.category) {
            Some((_, n)) => *n += 1,
            None => categories.push((tile.category, 1)),
        }
    }
    let total = matching.len();
    let text = |size: f32, line: f32, weight: f32, color: gpui::Hsla, value: SharedString| {
        div()
            .text_size(m.px(size))
            .line_height(m.px(line))
            .font_weight(css_weight(weight))
            .text_color(color)
            .child(value)
    };
    let category_link = |key: Option<&'static str>,
                         label: &'static str,
                         count: usize,
                         window: &mut Window,
                         cx: &mut App| {
        let current = state.category == key;
        let choose = a.choose_category.clone();
        let id = format!("catalog-category-{}", key.unwrap_or("all"));
        let el = div()
            .id(ElementId::Name(id.clone().into()))
            .role(gpui::Role::Button)
            .aria_label(crate::i18n::t(label))
            .aria_selected(current)
            .flex()
            .flex_none()
            .items_center()
            .gap(m.px(7.0))
            .min_h(m.px(49.0))
            .px(m.px(5.0))
            .py(m.px(7.0))
            .border_r(m.border(2.0))
            .border_color(if current {
                t.accent
            } else {
                gpui::transparent_black()
            })
            .rounded_l(m.px(7.0))
            .when(current, |el| el.bg(t.accent_soft))
            .when(!current, |el| el.hover(move |s| s.bg(t.control_hover)))
            .cursor_pointer()
            .on_click(move |_, w, cx| choose(key, w, cx))
            .child(
                icon(category_glyph(key.unwrap_or("all")), m)
                    .size(19.0)
                    .color(if current { t.accent } else { t.text_muted }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(text(
                        10.5,
                        14.0,
                        500.0,
                        if current { t.accent } else { t.text },
                        crate::i18n::t(label),
                    ))
                    .child(text(
                        9.0,
                        12.0,
                        400.0,
                        t.text_muted,
                        crate::i18n::t("{0} widgets")
                            .replace("{0}", &count.to_string())
                            .into(),
                    )),
            );
        focusable(el, &id, true, t, window, cx)
    };
    let slot_label = extra.slot_label.clone().unwrap_or_default();
    let tile_view = |tile: &Tile, window: &mut Window, cx: &mut App| {
        let id = tile.id;
        let saturated = tile.available.is_empty() && !choosing;
        let disabled = choosing && tile.reason.is_some();
        let (choose, press, keep) = (
            a.choose_tile.clone(),
            a.press_tile.clone(),
            a.inside.clone(),
        );
        let title = crate::i18n::t(tile.title);
        let tooltip: SharedString = if choosing {
            tile.reason.clone().unwrap_or_else(|| {
                crate::i18n::t("Escolher {0}: {1}")
                    .replace("{0}", &title)
                    .replace("{1}", &slot_label)
                    .into()
            })
        } else if !tile.available.is_empty() {
            crate::i18n::t("Arraste para adicionar. Clique para escolher uma área.")
        } else {
            tile.unavailable.clone()
        };
        let shake = extra.motion.shake.filter(|(s, _)| *s == id).map(|(_, o)| o);
        let key = format!("catalog-tile-{id}");
        let anchor = extra.anchors.get(id).cloned().unwrap_or_default();
        let el = div()
            .id(ElementId::Name(key.clone().into()))
            .role(gpui::Role::Button)
            .aria_label(title.clone())
            .relative()
            .flex()
            .flex_col()
            .items_center()
            .gap(m.px(2.0))
            .min_h(m.px(96.0))
            .pt(m.px(8.0))
            .px(m.px(5.0))
            .pb(m.px(26.0))
            .rounded(m.px(10.0))
            .border(m.border(1.0))
            .border_color(t.border)
            .bg(if saturated { t.input } else { t.workspace })
            .when(saturated, |el| el.opacity(0.58))
            .when(disabled, |el| el.opacity(0.5))
            .when_some(shake, |el, (dx, dy)| el.left(m.px(dx)).top(m.px(dy)))
            .when(!disabled, |el| {
                el.hover(move |s| s.border_color(t.accent_border).bg(t.accent_soft))
                    .on_click(move |_, w, cx| {
                        keep(w, cx);
                        choose(id, w, cx);
                    })
            })
            .when(!choosing, |el| {
                el.cursor_grab()
                    .on_mouse_down(MouseButton::Left, move |e, w, cx| press(id, e, w, cx))
            })
            .when(choosing && !disabled, |el| el.cursor_pointer())
            .child(anchor_probe(&anchor))
            .child(
                div()
                    .size(m.px(34.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon(glyph(id), m).size(27.0).color(t.accent)),
            )
            // The 24px label row centres one line and clamps at two (`-webkit-line-clamp: 2`).
            .child(
                div()
                    .w_full()
                    .h(m.px(24.0))
                    .flex()
                    .flex_col()
                    .justify_center()
                    .child(
                        text(10.5, 12.0, 500.0, t.text, title.clone())
                            .w_full()
                            .text_center()
                            .line_clamp(2),
                    ),
            );
        let tile_el = titled(
            focusable(el, &key, !disabled, t, window, cx),
            key.clone(),
            (!disabled).then_some(tooltip),
        );
        // Presences: "Remover {0} da área {1}" (`.widget-browser-presence`).
        let presences = tile.presences.iter().map(|(view, area)| {
            let remove = a.remove_presence.clone();
            let keep = a.inside.clone();
            let view = view.clone();
            let pid = format!("catalog-presence-{view}");
            let label: SharedString = crate::i18n::t("Remover {0} da área {1}")
                .replace("{0}", &title)
                .replace("{1}", &crate::i18n::t(area.label()))
                .into();
            let el = div()
                .id(ElementId::Name(pid.clone().into()))
                .role(gpui::Role::Button)
                .aria_label(label.clone())
                .size(m.px(18.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(m.px(5.0))
                .cursor_pointer()
                .hover(move |s| s.bg(t.control_hover))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |_, w, cx| {
                    keep(w, cx);
                    remove(view.clone(), w, cx);
                })
                .child(region_icon(Some(*area), m, t.accent));
            titled(focusable(el, &pid, true, t, window, cx), pid, Some(label))
        });
        let presence_row = div()
            .absolute()
            .left(m.px(5.0))
            .right(m.px(5.0))
            .bottom(m.px(6.0))
            .flex()
            .justify_center()
            .gap(m.px(4.0))
            .min_h(m.px(14.0))
            .children(presences.collect::<Vec<_>>());
        div().relative().child(tile_el).child(presence_row)
    };
    let area_button = |area: Option<Area>, window: &mut Window, cx: &mut App| {
        let pressed = match area {
            None => state.areas.is_empty(),
            Some(area) => state.areas.contains(&area),
        };
        let toggle = a.toggle_area.clone();
        let id = format!("catalog-area-{}", area.map_or("all", Area::key));
        let label: SharedString = match area {
            None => crate::i18n::t("Todas as áreas"),
            Some(area) => crate::i18n::t(if pressed {
                "Remover filtro: {0}"
            } else {
                "Filtrar por: {0}"
            })
            .replace("{0}", &crate::i18n::t(area.label()))
            .into(),
        };
        let el = div()
            .id(ElementId::Name(id.clone().into()))
            .role(gpui::Role::Button)
            .aria_label(label.clone())
            .aria_toggled(if pressed {
                gpui::Toggled::True
            } else {
                gpui::Toggled::False
            })
            .size(m.px(28.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded(m.px(5.0))
            .when(pressed, |el| el.bg(t.accent_soft))
            .when(!pressed, |el| el.hover(move |s| s.bg(t.control_hover)))
            .cursor_pointer()
            .on_click(move |_, w, cx| toggle(area, w, cx))
            .child(region_icon(
                area,
                m,
                if pressed { t.accent } else { t.text_muted },
            ));
        titled(focusable(el, &id, true, t, window, cx), id, Some(label))
    };
    let filter_active = state.plugin.is_some();
    let areas_label = if state.areas.is_empty() {
        crate::i18n::t("Todas as áreas").to_string()
    } else {
        state
            .areas
            .iter()
            .map(|a| crate::i18n::t(a.label()).to_string())
            .collect::<Vec<_>>()
            .join(" + ")
    };
    let area_buttons: Vec<_> = std::iter::once(None)
        // `REGIONS` order: Main, Sidebar, Bottom.
        .chain([Area::Main, Area::Sidebar, Area::Bottom].map(Some))
        .map(|area| area_button(area, window, cx))
        .collect();
    let funnel = focusable(
        div()
            .id("catalog-plugin-filter")
            .relative()
            .size(m.px(32.0))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(m.px(8.0))
            .when(filter_active, |el| el.bg(t.accent_soft))
            .when(!filter_active, |el| {
                el.hover(move |s| s.bg(t.control_hover))
            })
            .cursor_pointer()
            .on_click({
                let toggle = a.toggle_plugin_menu.clone();
                move |e, w, cx| toggle(e, w, cx)
            })
            .child(anchor_probe(&extra.filter_anchor))
            .child(icon("funnel", m).size(17.0).color(if filter_active {
                t.accent
            } else {
                t.text
            }))
            .when(filter_active, |el| {
                el.child(
                    div()
                        .absolute()
                        .top(m.px(3.0))
                        .right(m.px(3.0))
                        .size(m.px(5.0))
                        .rounded_full()
                        .bg(t.accent),
                )
            }),
        "catalog-plugin-filter",
        true,
        t,
        window,
        cx,
    );
    let slot_banner = extra.slot_label.clone().map(|label| {
        let cancel = a.cancel_slot.clone();
        let keep = a.inside.clone();
        let (opacity, dy) = extra.motion.banner.unwrap_or((1.0, 0.0));
        let close = titled(
            focusable(
                div()
                    .id("catalog-slot-cancel")
                    .size(m.px(28.0))
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .rounded(m.px(8.0))
                    .cursor_pointer()
                    .hover(move |s| s.bg(t.control_hover))
                    .on_click(move |e, w, cx| {
                        keep(w, cx);
                        cancel(e, w, cx);
                    })
                    .child(icon("x-mark", m).size(16.0).color(t.text)),
                "catalog-slot-cancel",
                true,
                t,
                window,
                cx,
            ),
            "catalog-slot-cancel",
            Some(crate::i18n::t("Cancelar seleção de widget")),
        );
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(m.px(9.0))
            .mx(m.px(11.0))
            .mb(m.px(11.0))
            .p(m.px(9.0))
            .rounded(m.px(8.0))
            .border(m.border(1.0))
            .border_color(t.accent_border)
            .bg(t.accent_soft)
            .child(
                div()
                    .relative()
                    .top(m.px(dy))
                    .opacity(opacity)
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(m.px(4.0))
                    .child(text(
                        12.0,
                        16.0,
                        600.0,
                        t.text,
                        crate::i18n::t("Escolher widget"),
                    ))
                    .child(text(10.0, 13.0, 400.0, t.text_muted, label)),
            )
            .child(close)
    });
    let mut category_links = vec![category_link(None, "Todos os widgets", total, window, cx)];
    for (c, n) in &categories {
        category_links.push(category_link(Some(*c), c, *n, window, cx));
    }
    let explore = {
        let explore = a.explore.clone();
        focusable(
            div()
                .id("catalog-explore")
                .flex()
                .flex_none()
                .items_center()
                .gap(m.px(5.0))
                .px(m.px(6.0))
                .py(m.px(9.0))
                .rounded(m.px(8.0))
                .border(m.border(1.0))
                .border_color(t.accent_border)
                .bg(t.accent_soft)
                .cursor_pointer()
                .on_click(move |e, w, cx| explore(e, w, cx))
                .child(icon("plus", m).size(14.0).color(t.accent))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(m.px(4.0))
                        .child(text(
                            9.0,
                            12.0,
                            700.0,
                            t.text,
                            crate::i18n::t("Explore plugins"),
                        ))
                        .child(text(
                            8.0,
                            12.0,
                            400.0,
                            t.text_muted,
                            crate::i18n::t("Mais recursos para seu projeto"),
                        )),
                )
                .child(icon("chevron-right", m).size(14.0).color(t.accent)),
            "catalog-explore",
            true,
            t,
            window,
            cx,
        )
    };
    let tile_views: Vec<Div> = visible
        .iter()
        .map(|tile| tile_view(tile, window, cx))
        .collect();
    let mut rows: Vec<Div> = Vec::new();
    let mut tile_views = tile_views.into_iter().peekable();
    while tile_views.peek().is_some() {
        // Three equal columns (repeat(3, minmax(0, 1fr))); the last row is padded.
        let row: Vec<Div> = tile_views.by_ref().take(3).collect();
        let pad = 3 - row.len();
        rows.push(
            div()
                .flex()
                .flex_none()
                .gap(m.px(9.0))
                .children(
                    row.into_iter()
                        .map(|tile| div().flex_1().min_w_0().child(tile)),
                )
                .children((0..pad).map(|_| div().flex_1())),
        );
    }
    let (grid_opacity, grid_dx) = extra.motion.grid.unwrap_or((1.0, 0.0));
    let empty = visible.is_empty().then(|| {
        let clear = a.clear_filters.clone();
        div()
            .py(m.px(22.0))
            .flex()
            .flex_col()
            .items_center()
            .child(text(
                12.0,
                16.0,
                400.0,
                t.text_muted,
                crate::i18n::t("Nenhum widget com esses filtros."),
            ))
            .child(
                geppui::text_action("catalog-clear-filters", crate::i18n::t("Limpar filtros"))
                    .on_click(move |e, w, cx| clear(e, w, cx)),
            )
    });
    let destination = extra.destination.map(|d| {
        let buttons: Vec<_> = Area::ALL
            .into_iter()
            .zip(d.reasons)
            .map(|(area, reason)| {
                let enabled = reason.is_none();
                let place = a.place.clone();
                let keep = a.inside.clone();
                let id = format!("catalog-place-{}", area.key());
                // A disabled `.ui-button` takes no pointer events: its reason is not a tooltip.
                let title: Option<SharedString> = enabled.then(|| {
                    crate::i18n::t("Colocar em {0}")
                        .replace("{0}", &crate::i18n::t(area.label()))
                        .into()
                });
                let el = div()
                    .id(ElementId::Name(id.clone().into()))
                    .role(gpui::Role::Button)
                    .aria_label(crate::i18n::t(area.label()))
                    .flex_1()
                    .flex()
                    .items_center()
                    .justify_center()
                    .px(m.px(5.0))
                    .py(m.px(8.0))
                    .rounded(m.px(7.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.surface)
                    .text_size(m.px(11.0))
                    .when(!enabled, |el| el.opacity(0.5))
                    .when(enabled, |el| {
                        el.cursor_pointer()
                            .hover(move |s| s.border_color(t.accent))
                            .on_click(move |_, w, cx| {
                                keep(w, cx);
                                place(area, w, cx);
                            })
                    })
                    .child(crate::i18n::t(area.label()));
                titled(focusable(el, &id, enabled, t, window, cx), id, title)
            })
            .collect();
        div()
            .id("catalog-destination")
            .flex_none()
            .border_t(m.border(1.0))
            .border_color(t.border)
            .p(m.px(11.0))
            .bg(t.region)
            .on_click({
                let keep = a.inside.clone();
                move |_, w, cx| keep(w, cx)
            })
            .child(text(11.0, 15.0, 600.0, t.text, d.title).mb(m.px(9.0)))
            .child(text(11.0, 16.0, 400.0, t.text_muted, d.policy).mb(m.px(9.0)))
            .child(div().flex().gap(m.px(6.0)).children(buttons))
    });
    let close_destination = a.close_destination.clone();
    root.child(
        div()
            .id("widgets-menu")
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .on_click(move |e, w, cx| close_destination(e, w, cx))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(m.px(7.0))
                    .p(m.px(11.0))
                    .mb(m.px(11.0))
                    .border_b(m.border(1.0))
                    .border_color(t.border)
                    .child(extra.search)
                    .child(funnel)
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .gap(m.px(2.0))
                            .p(m.px(2.0))
                            .rounded(m.px(8.0))
                            .border(m.border(1.0))
                            .border_color(t.border)
                            .bg(t.input)
                            .children(area_buttons),
                    ),
            )
            .children(slot_banner)
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .gap(m.px(11.0))
                    .px(m.px(11.0))
                    .pb(m.px(9.0))
                    .child(
                        div()
                            .w(m.px(144.0))
                            .flex_none()
                            .flex()
                            .flex_col()
                            .gap(m.px(11.0))
                            .pr(m.px(7.0))
                            .border_r(m.border(1.0))
                            .border_color(t.border)
                            .child(
                                div().flex_1().min_h_0().child(
                                    geppui::scroll_area(
                                        "catalog-categories",
                                        &extra.category_scroll,
                                    )
                                    .thin()
                                    .child(div().flex().flex_col().children(category_links)),
                                ),
                            )
                            .child(explore),
                    )
                    .child(
                        div().flex_1().min_w_0().min_h_0().child(
                            geppui::scroll_area("catalog-grid", &extra.grid_scroll)
                                .thin()
                                .child(
                                    div()
                                        .relative()
                                        .left(m.px(grid_dx))
                                        .opacity(grid_opacity)
                                        .flex()
                                        .flex_col()
                                        .gap(m.px(9.0))
                                        .children(rows)
                                        .children(empty),
                                ),
                        ),
                    ),
            )
            .children(destination)
            .child(
                div()
                    .flex_none()
                    .mx(m.px(11.0))
                    .mb(m.px(9.0))
                    .p(m.px(9.0))
                    .rounded(m.px(8.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.input)
                    .flex()
                    .flex_col()
                    .gap(m.px(4.0))
                    .child(text(
                        10.0,
                        13.0,
                        600.0,
                        t.text,
                        format!(
                            "{} · {} · {}",
                            crate::i18n::t("{0} widgets")
                                .replace("{0}", &visible.len().to_string()),
                            owner_name(state.plugin),
                            areas_label
                        )
                        .into(),
                    ))
                    .child(text(
                        10.0,
                        15.0,
                        400.0,
                        t.text_muted,
                        crate::i18n::t(if choosing {
                            "Clique em um widget para preencher o espaço selecionado."
                        } else {
                            "Dica: arraste um widget até a área desejada ou clique para escolher o destino."
                        }),
                    )),
            ),
    )
}

/// The 280ms rejection shake of a tile (`translate` keyframes, `ease-out`).
pub fn shake_offset(elapsed_ms: f64) -> Option<(f32, f32)> {
    const KEYS: [(f64, f32, f32); 7] = [
        (0.0, 0.0, 0.0),
        (0.18, 0.0, -4.0),
        (0.32, -3.0, -4.0),
        (0.48, 3.0, -4.0),
        (0.64, -2.0, -3.0),
        (0.8, 2.0, -2.0),
        (1.0, 0.0, 0.0),
    ];
    if !(0.0..280.0).contains(&elapsed_ms) {
        return None;
    }
    let p = geppui::motion::EASE_OUT.ease(elapsed_ms / 280.0);
    let i = KEYS
        .iter()
        .rposition(|k| k.0 <= p)
        .unwrap_or(0)
        .min(KEYS.len() - 2);
    let (a, b) = (KEYS[i], KEYS[i + 1]);
    let f = ((p - a.0) / (b.0 - a.0)).clamp(0.0, 1.0) as f32;
    Some((a.1 + (b.1 - a.1) * f, a.2 + (b.2 - a.2) * f))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(id: &'static str, title: &'static str, allowed: Vec<Area>) -> Tile {
        Tile {
            id,
            title,
            category: "Organização",
            owner: "host",
            reason: None,
            available: allowed.clone(),
            allowed,
            presences: vec![],
            unavailable: SharedString::default(),
        }
    }

    #[test]
    fn search_ignores_case_and_accents_and_areas_filter_by_type() {
        let atividade = tile("activity", "Atividade", vec![Area::Main]);
        let ideias = tile("notes", "Ideias em aberto", vec![Area::Sidebar]);
        let state = CatalogState {
            search: "ATIVIDÁDE".into(),
            ..Default::default()
        };
        assert!(state.matches(&atividade) && !state.matches(&ideias));
        let sidebar = CatalogState {
            areas: vec![Area::Sidebar],
            ..Default::default()
        };
        assert!(sidebar.matches(&ideias) && !sidebar.matches(&atividade));
        // The area filter follows what the type allows, not where it is free right now.
        let mut full = tile("chart", "Ritmo", vec![Area::Main, Area::Bottom]);
        full.available.clear();
        let bottom = CatalogState {
            areas: vec![Area::Bottom],
            ..Default::default()
        };
        assert!(bottom.matches(&full));
    }

    #[test]
    fn emptied_category_and_plugin_fall_back_to_all() {
        let tiles = vec![tile("activity", "Atividade", vec![Area::Main])];
        let mut state = CatalogState {
            category: Some("Indicadores"),
            plugin: Some("other"),
            ..Default::default()
        };
        assert!(state.normalize(&tiles));
        assert_eq!((state.category, state.plugin), (None, None));
        assert!(!state.normalize(&tiles));
    }

    #[test]
    fn shake_follows_the_keyframes() {
        assert_eq!(shake_offset(0.0), Some((0.0, 0.0)));
        assert_eq!(shake_offset(280.0), None);
        let (_, y) = shake_offset(60.0).unwrap();
        assert!(y < -1.0, "lifts early: {y}");
    }
}
