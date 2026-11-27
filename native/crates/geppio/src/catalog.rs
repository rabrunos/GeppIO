//! The widget catalog column (480px, docked right of Main/Bottom while editing):
//! the Widgets / Composições tabs, search, the plugin filter, area filters, the slot banner,
//! categories with "Explore plugins", the tile grid, the destination box and the footer
//! (`EditorPanel.tsx`, `widget-browser.css` at alpha.99). Availability comes from the core.
use std::rc::Rc;

use geppui::{AnchorHandle, Metrics, Theme, anchor_probe, css_weight, icon};
use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, InteractiveElement, IntoElement, MouseButton,
    MouseDownEvent, ParentElement, SharedString, StatefulInteractiveElement, Styled, Window, div,
    prelude::FluentBuilder,
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
    /// Regions where adding it is currently feasible.
    pub available: Vec<Area>,
    /// Regions where it is already placed.
    pub placed: Vec<Area>,
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
    /// Accent/case-normalized substring match over the title.
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
            && (self.areas.is_empty()
                || self
                    .areas
                    .iter()
                    .any(|a| tile.available.contains(a) || tile.placed.contains(a)))
    }
}

pub type Click = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

pub type AreaAction = Rc<dyn Fn(Area, &mut Window, &mut App)>;
pub type TabAction = Rc<dyn Fn(CatalogTab, &mut Window, &mut App)>;
pub type CategoryAction = Rc<dyn Fn(Option<&'static str>, &mut Window, &mut App)>;
pub type TileAction = Rc<dyn Fn(&'static str, &mut Window, &mut App)>;
pub type PlaceAction = Rc<dyn Fn(&'static str, Area, &mut Window, &mut App)>;
pub type PressAction = Rc<dyn Fn(&'static str, &MouseDownEvent, &mut Window, &mut App)>;

pub struct CatalogActions {
    pub select_tab: TabAction,
    pub toggle_plugin_menu: Click,
    pub explore: Click,
    pub cancel_slot: Click,
    pub clear_filters: Click,
    pub toggle_area: AreaAction,
    pub choose_category: CategoryAction,
    pub choose_tile: TileAction,
    pub place: PlaceAction,
    /// Pointer-down on a tile (drag source); receives the CSS position of the press.
    pub press_tile: PressAction,
    pub focus_search: Click,
}

fn region_icon(area: Option<Area>, m: Metrics, color: gpui::Hsla) -> AnyElement {
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

/// What the catalog column shows besides the widget tiles.
pub struct CatalogExtra {
    /// The composition library (Composições tab).
    pub compositions: Option<AnyElement>,
    /// "{área}, espaço N" of the chosen slot.
    pub slot_label: Option<SharedString>,
    /// Records the funnel button for the plugin filter popover.
    pub filter_anchor: AnchorHandle,
    /// The destination's widget has a single presence (`presence === 'single-view'`).
    pub single_view: bool,
}

pub fn render(
    state: &CatalogState,
    tiles: &[Tile],
    m: Metrics,
    t: Theme,
    a: CatalogActions,
    extra: CatalogExtra,
) -> Div {
    let tab_button = |value: CatalogTab, label: &'static str| {
        let selected = state.tab == value;
        let select = a.select_tab.clone();
        div()
            .id(ElementId::Name(format!("catalog-tab-{value:?}").into()))
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
            .child(icon("squares-2x2", m).size(16.0).color(if selected {
                t.accent
            } else {
                t.text_muted
            }))
            .child(crate::i18n::t(label))
    };
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
                .child(tab_button(CatalogTab::Widgets, "Widgets"))
                .child(tab_button(CatalogTab::Compositions, "Composições")),
        );
    if state.tab == CatalogTab::Compositions {
        return root.children(extra.compositions);
    }
    let choosing = state.slot.is_some();
    let visible: Vec<&Tile> = tiles
        .iter()
        .filter(|tile| state.matches(tile) && state.category.is_none_or(|c| tile.category == c))
        .collect();
    let mut categories: Vec<(&'static str, usize)> = Vec::new();
    for tile in tiles.iter().filter(|tile| state.matches(tile)) {
        match categories.iter_mut().find(|(c, _)| *c == tile.category) {
            Some((_, n)) => *n += 1,
            None => categories.push((tile.category, 1)),
        }
    }
    let total = tiles.iter().filter(|tile| state.matches(tile)).count();
    let text = |size: f32, line: f32, weight: f32, color: gpui::Hsla, value: SharedString| {
        div()
            .text_size(m.px(size))
            .line_height(m.px(line))
            .font_weight(css_weight(weight))
            .text_color(color)
            .child(value)
    };
    let category_link = |key: Option<&'static str>, label: &'static str, count: usize| {
        let current = state.category == key;
        let choose = a.choose_category.clone();
        div()
            .id(ElementId::Name(
                format!("catalog-category-{}", key.unwrap_or("all")).into(),
            ))
            .flex()
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
            )
    };
    let tile_view = |tile: &Tile| {
        let id = tile.id;
        let saturated = tile.available.is_empty() && !choosing;
        let disabled = choosing && tile.reason.is_some();
        let (choose, press) = (a.choose_tile.clone(), a.press_tile.clone());
        div()
            .id(ElementId::Name(format!("catalog-tile-{id}").into()))
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
            .when(!disabled, |el| {
                el.hover(move |s| s.border_color(t.accent_border).bg(t.accent_soft))
                    .on_click(move |_, w, cx| choose(id, w, cx))
            })
            .when(!choosing, |el| {
                el.cursor_grab()
                    .on_mouse_down(MouseButton::Left, move |e, w, cx| press(id, e, w, cx))
            })
            .when(choosing && !disabled, |el| el.cursor_pointer())
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
                        text(10.5, 12.0, 500.0, t.text, crate::i18n::t(tile.title))
                            .w_full()
                            .text_center()
                            .line_clamp(2),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .left(m.px(5.0))
                    .right(m.px(5.0))
                    .bottom(m.px(6.0))
                    .flex()
                    .justify_center()
                    .gap(m.px(4.0))
                    .min_h(m.px(14.0))
                    .children(tile.placed.iter().map(|area| {
                        div()
                            .size(m.px(18.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(region_icon(Some(*area), m, t.accent))
                    })),
            )
    };
    let area_button = |area: Option<Area>| {
        let pressed = match area {
            None => state.areas.is_empty(),
            Some(area) => state.areas.contains(&area),
        };
        let toggle = a.toggle_area.clone();
        div()
            .id(ElementId::Name(format!("catalog-area-{area:?}").into()))
            .size(m.px(28.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded(m.px(5.0))
            .when(pressed, |el| el.bg(t.accent_soft))
            .cursor_pointer()
            .on_click(move |_, w, cx| {
                if let Some(area) = area {
                    toggle(area, w, cx)
                }
            })
            .child(region_icon(
                area,
                m,
                if pressed { t.accent } else { t.text_muted },
            ))
    };
    let destination = state
        .destination
        .filter(|_| !choosing)
        .and_then(|id| tiles.iter().find(|tile| tile.id == id));
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
    root.child(
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(m.px(7.0))
            .p(m.px(11.0))
            .mb(m.px(11.0))
            .border_b(m.border(1.0))
            .border_color(t.border)
            .child(
                div()
                    .id("catalog-search")
                    .flex_1()
                    .flex()
                    .items_center()
                    .gap(m.px(9.0))
                    .h(m.px(36.0))
                    .px(m.px(11.0))
                    .rounded(m.px(8.0))
                    .border(m.border(1.0))
                    .border_color(t.input_border)
                    .bg(t.input)
                    .cursor_text()
                    .on_click({
                        let focus = a.focus_search.clone();
                        move |e, w, cx| focus(e, w, cx)
                    })
                    .child(icon("magnifying-glass", m).size(16.0).color(t.text_muted))
                    .child(if state.search.is_empty() {
                        text(
                            12.0,
                            16.0,
                            400.0,
                            t.text_muted,
                            crate::i18n::t("Buscar widgets…"),
                        )
                    } else {
                        text(12.0, 16.0, 400.0, t.text, state.search.clone().into())
                    }),
            )
            .child(
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
            )
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
                    .child(area_button(None))
                    .children(Area::ALL.map(|area| area_button(Some(area)))),
            ),
    )
    .when_some(extra.slot_label.clone(), |el, label| {
        let cancel = a.cancel_slot.clone();
        el.child(
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
                .child(
                    div()
                        .id("catalog-slot-cancel")
                        .size(m.px(28.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(m.px(8.0))
                        .cursor_pointer()
                        .hover(move |s| s.bg(t.control_hover))
                        .on_click(move |e, w, cx| cancel(e, w, cx))
                        .child(icon("x-mark", m).size(16.0).color(t.text)),
                ),
        )
    })
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
                        div()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .flex_col()
                            .child(category_link(None, "Todos os widgets", total))
                            .children(
                                categories
                                    .iter()
                                    .map(|(c, n)| category_link(Some(*c), c, *n)),
                            ),
                    )
                    .child({
                        let explore = a.explore.clone();
                        div()
                            .id("catalog-explore")
                            .flex()
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
                            .child(icon("chevron-right", m).size(14.0).color(t.accent))
                    }),
            )
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(m.px(9.0))
                    // Three equal columns (repeat(3, minmax(0, 1fr))); the last row is padded.
                    .children(visible.chunks(3).map(|row| {
                        div()
                            .flex()
                            .gap(m.px(9.0))
                            .children(
                                row.iter()
                                    .map(|tile| div().flex_1().min_w_0().child(tile_view(tile))),
                            )
                            .children((row.len()..3).map(|_| div().flex_1()))
                    }))
                    .when(visible.is_empty(), |el| {
                        let clear = a.clear_filters.clone();
                        el.child(
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
                                    geppui::text_action(
                                        "catalog-clear-filters",
                                        crate::i18n::t("Limpar filtros"),
                                    )
                                    .on_click(move |e, w, cx| clear(e, w, cx)),
                                ),
                        )
                    }),
            ),
    )
    .when_some(destination, |el, tile| {
        let id = tile.id;
        el.child(
            div()
                .flex_none()
                .border_t(m.border(1.0))
                .border_color(t.border)
                .p(m.px(11.0))
                .bg(t.region)
                .child(
                    text(
                        11.0,
                        15.0,
                        600.0,
                        t.text,
                        crate::i18n::t("Onde colocar {0}?")
                            .replace("{0}", &crate::i18n::t(tile.title))
                            .into(),
                    )
                    .mb(m.px(9.0)),
                )
                .child(
                    text(
                        11.0,
                        16.0,
                        400.0,
                        t.text_muted,
                        crate::i18n::t(if extra.single_view {
                            "Este widget tem uma única presença. Escolha para onde mover."
                        } else {
                            "Este widget compartilha os dados entre presenças em áreas diferentes."
                        }),
                    )
                    .mb(m.px(9.0)),
                )
                .child(div().flex().gap(m.px(6.0)).children(Area::ALL.map(|area| {
                    let enabled = tile.available.contains(&area);
                    let place = a.place.clone();
                    div()
                        .id(ElementId::Name(
                            format!("catalog-place-{id}-{area:?}").into(),
                        ))
                        .flex_1()
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(m.px(6.0))
                        .px(m.px(5.0))
                        .py(m.px(8.0))
                        .rounded(m.px(7.0))
                        .border(m.border(1.0))
                        .border_color(t.border)
                        .bg(t.elevated)
                        .text_size(m.px(11.0))
                        .when(!enabled, |el| el.opacity(0.5))
                        .when(enabled, |el| {
                            el.cursor_pointer()
                                .hover(move |s| s.border_color(t.accent))
                                .on_click(move |_, w, cx| place(id, area, w, cx))
                        })
                        .child(region_icon(Some(area), m, t.text_muted))
                        .child(crate::i18n::t(area.label()))
                }))),
        )
    })
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
                    crate::i18n::t("{0} widgets").replace("{0}", &visible.len().to_string()),
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
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tile(id: &'static str, title: &'static str, available: Vec<Area>) -> Tile {
        Tile {
            id,
            title,
            category: "Organização",
            owner: "host",
            reason: None,
            available,
            placed: vec![],
        }
    }

    #[test]
    fn search_ignores_case_and_accents_and_areas_filter() {
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
    }
}
