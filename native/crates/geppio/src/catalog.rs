//! The widget catalog column (480px, docked right of Main/Bottom while editing):
//! tabs, search, area filters, categories, the tile grid and the destination box
//! (`EditorPanel.tsx`, `widget-browser.css` at alpha.99). Availability comes from the core.
use std::rc::Rc;

use geppui::{Metrics, Theme, css_weight, icon};
use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, InteractiveElement, IntoElement, MouseButton,
    MouseDownEvent, ParentElement, SharedString, StatefulInteractiveElement, Styled, Window, div,
    prelude::FluentBuilder,
};

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
    pub search: String,
    /// Empty means all areas.
    pub areas: Vec<Area>,
    pub category: Option<&'static str>,
    pub destination: Option<&'static str>,
}

impl CatalogState {
    /// Accent/case-normalized substring match over the title.
    pub fn matches(&self, tile: &Tile) -> bool {
        let normalize = |s: &str| {
            s.chars()
                .map(|c| match c {
                    'á' | 'à' | 'â' | 'ã' | 'Á' | 'À' | 'Â' | 'Ã' => 'a',
                    'é' | 'ê' | 'É' | 'Ê' => 'e',
                    'í' | 'Í' => 'i',
                    'ó' | 'ô' | 'õ' | 'Ó' | 'Ô' | 'Õ' => 'o',
                    'ú' | 'Ú' => 'u',
                    'ç' | 'Ç' => 'c',
                    other => other.to_ascii_lowercase(),
                })
                .collect::<String>()
        };
        let text = normalize(&self.search);
        (text.is_empty() || normalize(tile.title).contains(text.trim()))
            && (self.areas.is_empty()
                || self
                    .areas
                    .iter()
                    .any(|a| tile.available.contains(a) || tile.placed.contains(a)))
    }
}

pub type Click = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

pub type AreaAction = Rc<dyn Fn(Area, &mut Window, &mut App)>;
pub type CategoryAction = Rc<dyn Fn(Option<&'static str>, &mut Window, &mut App)>;
pub type TileAction = Rc<dyn Fn(&'static str, &mut Window, &mut App)>;
pub type PlaceAction = Rc<dyn Fn(&'static str, Area, &mut Window, &mut App)>;
pub type PressAction = Rc<dyn Fn(&'static str, &MouseDownEvent, &mut Window, &mut App)>;

pub struct CatalogActions {
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

pub fn render(
    state: &CatalogState,
    tiles: &[Tile],
    m: Metrics,
    t: Theme,
    a: CatalogActions,
) -> Div {
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
                        label.into(),
                    ))
                    .child(text(
                        9.0,
                        12.0,
                        400.0,
                        t.text_muted,
                        format!("{count} widgets").into(),
                    )),
            )
    };
    let tile_view = |tile: &Tile| {
        let id = tile.id;
        let saturated = tile.available.is_empty();
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
            .hover(move |s| s.border_color(t.accent_border).bg(t.accent_soft))
            .cursor_grab()
            .on_mouse_down(MouseButton::Left, move |e, w, cx| press(id, e, w, cx))
            .on_click(move |_, w, cx| choose(id, w, cx))
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
                        text(10.5, 12.0, 500.0, t.text, tile.title.into())
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
        .and_then(|id| tiles.iter().find(|tile| tile.id == id));
    div()
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
                .gap(m.px(7.0))
                .pt(m.px(9.0))
                .px(m.px(11.0))
                .border_b(m.border(1.0))
                .border_color(t.border)
                .child(
                    div()
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
                        .border_color(t.accent)
                        .bg(t.accent_soft)
                        .text_color(t.accent)
                        .font_weight(css_weight(600.0))
                        .child(icon("squares-2x2", m).size(16.0).color(t.accent))
                        .child("Widgets"),
                ),
        )
        .child(
            div()
                .flex()
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
                            text(12.0, 16.0, 400.0, t.text_muted, "Buscar widgets…".into())
                        } else {
                            text(12.0, 16.0, 400.0, t.text, state.search.clone().into())
                        }),
                )
                .child(
                    div()
                        .flex()
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
                        .pr(m.px(7.0))
                        .border_r(m.border(1.0))
                        .border_color(t.border)
                        .child(category_link(None, "Todos os widgets", total))
                        .children(
                            categories
                                .iter()
                                .map(|(c, n)| category_link(Some(*c), c, *n)),
                        ),
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
                                    row.iter().map(|tile| {
                                        div().flex_1().min_w_0().child(tile_view(tile))
                                    }),
                                )
                                .children((row.len()..3).map(|_| div().flex_1()))
                        }))
                        .when(visible.is_empty(), |el| {
                            el.child(text(
                                12.0,
                                16.0,
                                400.0,
                                t.text_muted,
                                "Nenhum widget com esses filtros.".into(),
                            ))
                        }),
                ),
        )
        .child(
            div()
                .border_t(m.border(1.0))
                .border_color(t.border)
                .p(m.px(11.0))
                .bg(t.region)
                .child(text(
                    11.0,
                    15.0,
                    600.0,
                    t.text,
                    destination
                        .map_or("Todas as áreas".into(), |tile| {
                            format!("Onde colocar {}?", tile.title)
                        })
                        .into(),
                ))
                .when_some(destination, |el, tile| {
                    let id = tile.id;
                    el.child(
                        div()
                            .mt(m.px(9.0))
                            .flex()
                            .gap(m.px(6.0))
                            .children(Area::ALL.map(|area| {
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
                                    .child(area.label())
                            })),
                    )
                })
                .when(destination.is_none(), |el| {
                    el.child(text(
                        10.0,
                        15.0,
                        400.0,
                        t.text_muted,
                        "Arraste um widget para a área desejada ou clique para escolher o destino."
                            .into(),
                    ))
                }),
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
