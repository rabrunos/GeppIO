//! The seven Electron demonstration widgets (`renderer/src/WidgetContent.tsx` and
//! `fixtures.css` at 0.1.0-alpha.99). All content is synthetic; geometry and type come from
//! the reference DOM measured at 1280×800.
use geppui::{Metrics, Theme, css_weight, icon, scroll_area, spaced_text};
use gpui::{
    AnyElement, Div, Hsla, InteractiveElement, IntoElement, ParentElement, ScrollHandle,
    SharedString, StatefulInteractiveElement, Styled, div, prelude::FluentBuilder,
};

/// Demo widget identity and title (`shared/workbench/model.ts` registry).
pub const DEMO: [(&str, &str); 7] = [
    ("summary", "Panorama"),
    ("queue", "Fila de trabalho"),
    ("library", "Biblioteca"),
    ("notes", "Ideias em aberto"),
    ("activity", "Atividade"),
    ("properties", "Propriedades"),
    ("chart", "Ritmo"),
];

pub fn title(id: &str) -> &'static str {
    DEMO.iter()
        .find(|(k, _)| *k == id)
        .map(|(_, t)| *t)
        .unwrap_or("Widget de teste")
}

/// Interactive state of the Propriedades demo (host model, not persisted in layout).
#[derive(Clone, Debug, PartialEq)]
pub struct Properties {
    pub name: String,
    pub comfortable: bool,
    pub details: bool,
}

impl Default for Properties {
    fn default() -> Self {
        Self {
            name: "Meu espaço de trabalho".into(),
            comfortable: false,
            details: true,
        }
    }
}

struct Ink {
    m: Metrics,
    t: Theme,
}

impl Ink {
    fn text(
        &self,
        size: f32,
        line: f32,
        weight: f32,
        color: Hsla,
        value: impl Into<SharedString>,
    ) -> Div {
        div()
            .text_size(self.m.px(size))
            .line_height(self.m.px(line))
            .font_weight(css_weight(weight))
            .text_color(color)
            .child(crate::i18n::t(&value.into()))
    }
    /// Text that is already composed from translated parts.
    fn raw(&self, size: f32, line: f32, weight: f32, color: Hsla, value: String) -> Div {
        div()
            .text_size(self.m.px(size))
            .line_height(self.m.px(line))
            .font_weight(css_weight(weight))
            .text_color(color)
            .child(SharedString::from(value))
    }
    fn caption(&self, value: &'static str, line: f32) -> Div {
        self.text(9.0, line, 400.0, self.t.text_muted, value)
    }
    fn tight(
        &self,
        size: f32,
        line: f32,
        weight: f32,
        spacing_px: f32,
        color: Hsla,
        value: &'static str,
    ) -> AnyElement {
        spaced_text(crate::i18n::t(value), self.m)
            .size(size, line)
            .weight(css_weight(weight))
            .color(color)
            .letter_spacing_em(spacing_px / size)
            .into_any_element()
    }
}

/// How a frame is drawn while editing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FrameLook {
    /// The last pointer-downed frame (`.widget-frame.selected`).
    pub selected: bool,
    /// Its last preview or drop was refused (`.widget-frame.invalid`).
    pub invalid: bool,
    /// Content is inert while editing (`contentLocked`): its scroll keeps its offset and the
    /// wheel goes to the region; its controls are drawn without interaction.
    pub locked: bool,
}

/// The frame of a widget: 1px border, 12px radius, surface background, heading and a
/// scrolling content area. `compact` is the Bottom heading (28px, 13/18 title).
pub fn frame(
    id: &str,
    compact: bool,
    m: Metrics,
    t: Theme,
    content: AnyElement,
    scroll: &ScrollHandle,
    look: FrameLook,
) -> Div {
    let (heading_h, pad_y, title_size, title_line) = if compact {
        (28.0, 5.0, 13.0, 18.0)
    } else {
        (42.0, 11.0, 16.0, 20.0)
    };
    div()
        .size_full()
        .flex()
        .flex_col()
        .overflow_hidden()
        .rounded(m.px(12.0))
        .border(m.border(1.0))
        .border_color(if look.selected || look.invalid {
            t.accent
        } else {
            t.border
        })
        // `--warning` is the accent: a 1px ring outside the border.
        .when(look.invalid, |el| {
            el.shadow(vec![
                gpui::BoxShadow::new(m.px(0.0), m.px(0.0), t.accent).spread_radius(m.px(1.0)),
            ])
        })
        .bg(t.surface)
        .child(
            div()
                .flex_none()
                .flex()
                .items_center()
                .min_h(m.px(heading_h))
                .px(m.px(11.0))
                .py(m.px(pad_y))
                .text_size(m.px(title_size))
                .line_height(m.px(title_line))
                .font_weight(css_weight(650.0))
                .text_color(t.text)
                .child(crate::i18n::t(title(id))),
        )
        .child(
            if compact {
                // Bottom content clips instead of scrolling (`[data-owner-region="bottom"] .widget-content`).
                div().flex_1().min_h_0().overflow_hidden().child(content)
            } else {
                div().flex_1().min_h_0().child(
                    scroll_area(SharedString::from(format!("widget-scroll-{id}")), scroll)
                        .thin()
                        .arrows(true)
                        .locked(look.locked)
                        .child(content),
                )
            }
            .relative(),
        )
}

/// Widget content by id. `compact` selects the Bottom variants.
/// `name`: the live "Nome de exemplo" field of the visible frame; copies (drag pictures,
/// the floating Sidebar) show its text.
#[allow(clippy::too_many_arguments)]
pub fn content(
    id: &str,
    compact: bool,
    m: Metrics,
    t: Theme,
    props: &Properties,
    on_props: impl Fn(Properties, &mut gpui::App) + Clone + 'static,
    name: Option<AnyElement>,
    locked: bool,
) -> AnyElement {
    let k = Ink { m, t };
    match id {
        "summary" => {
            // Bottom: 4px 8px padding, a 14px statement and 3px gaps.
            let (px, py, size, gap) = if compact { (8.0, 4.0, 14.0, 3.0) } else { (17.0, 13.0, 20.0, 7.0) };
            let line = (size * 1.2f32 * 100.0).round() / 100.0;
            div()
                .px(m.px(px))
                .py(m.px(py))
                .child(k.text(13.0, 17.0, 400.0, t.text, "ESPAÇO EM CONSTRUÇÃO"))
                .child(
                    div()
                        .my(m.px(gap))
                        .child(k.tight(size, line, 500.0, -0.5, t.text, "Seu próximo"))
                        .child(k.tight(size, line, 500.0, -0.5, t.text, "ambiente de trabalho.")),
                )
                .child(div().mt(m.px(gap)).child(k.text(9.0, 12.0, 400.0, t.text_muted, "7 widgets de demonstração.")))
                .into_any_element()
        }
        "queue" => queue(&k).into_any_element(),
        "library" => div()
            .p(m.px(14.0))
            .flex()
            .flex_wrap()
            .gap(m.px(9.0))
            .children([("archive-box", "Coleções"), ("cube", "Componentes"), ("photo", "Referências"), ("document-text", "Documentos")].map(|(glyph, label)| {
                div()
                    .flex_basis(gpui::relative(0.45))
                    .flex_grow(1.0)
                    .min_h(m.px(82.0))
                    .px(m.px(11.0))
                    .py(m.px(16.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(12.0))
                    .rounded(m.px(7.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .bg(t.input)
                    .child(icon(glyph, m).size(20.0).color(t.text_muted))
                    .child(k.text(9.0, 12.0, 400.0, t.text, label))
            }))
            .into_any_element(),
        "notes" => div()
            .p(m.px(18.0))
            .child(k.text(13.0, 17.0, 400.0, t.text, "NOTAS DE LABORATÓRIO"))
            .child(
                div()
                    .my(m.px(9.0))
                    .text_size(m.px(19.0))
                    .line_height(m.px(26.6))
                    .font_weight(css_weight(500.0))
                    .text_color(t.text)
                    .child(crate::i18n::t("Uma base, antes das ferramentas.")),
            )
            .child(div().my(m.px(12.0)).child(k.text(11.0, 19.8, 400.0, t.text_muted, "O objetivo aqui é experimentar a organização, a densidade e o comportamento dos widgets.")))
            .child(
                div()
                    .my(m.px(17.0))
                    .pl(m.px(10.0))
                    .border_l(m.border(2.0))
                    .border_color(t.accent)
                    .child(k.text(11.0, 19.8, 400.0, t.text, "O layout só muda quando você entra no modo de edição.")),
            )
            .child(div().my(m.px(12.0)).child(k.text(11.0, 19.8, 400.0, t.text_muted, "O cabeçalho é fixo. Sidebar, Main e Bottom são regiões irmãs.")))
            .child(k.caption("Texto fictício para testar leitura e rolagem.", 14.4))
            .into_any_element(),
        "activity" => div()
            .px(m.px(15.0))
            .py(m.px(2.0))
            .children((0..18).map(|i| {
                let title = ["Composição carregada", "Referência disponível", "Nova possibilidade"][i % 3];
                div()
                    .flex()
                    .gap(m.px(10.0))
                    .py(m.px(14.0))
                    .border_b(m.border(1.0))
                    .border_color(t.border)
                    .child(div().mt(m.px(5.0)).size(m.px(5.0)).flex_none().rounded_full().bg(t.text_muted))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            // An inline strong inside a 13px block: the line box is 17px tall.
                            .child(k.text(10.0, 17.0, 500.0, t.text, title))
                            .child(div().mt(m.px(4.0)).child(k.raw(9.0, 14.4, 400.0, t.text_muted, format!("{} {:02} {}", crate::i18n::t("Registro de exemplo"), i + 1, crate::i18n::t("· atividade simulada."))))),
                    )
            }))
            .into_any_element(),
        "properties" => properties(&k, props, on_props, name, locked).into_any_element(),
        "chart" => chart(&k, compact).into_any_element(),
        _ => k.text(13.0, 17.0, 400.0, t.text, "Widget de teste").into_any_element(),
    }
}

fn queue(k: &Ink) -> Div {
    let (m, t) = (k.m, k.t);
    let widths = [221.2 / 446.5, 88.02 / 446.5, 137.28 / 446.5];
    let cell = |w: f32| {
        div()
            .w(gpui::relative(w))
            .flex_none()
            .px(m.px(13.0))
            .py(m.px(12.0))
    };
    let header = ["Experimento", "Tipo", "Estado"];
    let rows = [
        ("Organizar uma composição", "Layout", "Explorar"),
        ("Experimentar o painel", "Surface", "Disponível"),
        ("Trocar a aparência", "Tema", "Disponível"),
        ("SDK para terceiros", "Futuro", "Fora desta base"),
    ];
    div()
        .flex()
        .flex_col()
        .child(
            div()
                .flex()
                .justify_between()
                .items_center()
                .pt(m.px(16.0))
                .px(m.px(14.0))
                .pb(m.px(10.0))
                .child(k.text(10.0, 14.0, 400.0, t.text_muted, "Conteúdo simulado"))
                .child(k.text(10.0, 14.0, 400.0, t.text_muted, "04 itens")),
        )
        .child(
            div()
                .flex()
                .border_b(m.border(1.0))
                .border_color(t.border)
                .children(header.iter().zip(widths).map(|(label, w)| {
                    cell(w).child(
                        spaced_text(crate::i18n::t(label).to_uppercase(), m)
                            .size(8.0, 11.0)
                            .weight(css_weight(500.0))
                            .color(t.text_muted)
                            .letter_spacing_em(0.8 / 8.0),
                    )
                })),
        )
        .children(rows.map(|(name, kind, status)| {
            div()
                .flex()
                .border_b(m.border(1.0))
                .border_color(t.border)
                .child(cell(widths[0]).child(k.text(10.0, 16.0, 400.0, t.text, name)))
                .child(cell(widths[1]).child(k.text(10.0, 16.0, 400.0, t.text, kind)))
                .child(
                    cell(widths[2]).child(
                        // The tag is inline: its padding does not grow the 16px line box.
                        div().h(m.px(16.0)).flex().items_center().child(
                            div()
                                .px(m.px(5.0))
                                .py(m.px(3.0))
                                .rounded(m.px(4.0))
                                .bg(t.input)
                                .whitespace_nowrap()
                                .child(k.text(8.0, 12.8, 400.0, t.text_muted, status)),
                        ),
                    ),
                )
        }))
        .child(div().px(m.px(13.0)).py(m.px(8.0)).child(k.caption(
            "Tabela de referência · não é uma fila real de tarefas.",
            14.4,
        )))
}

fn field(k: &Ink, label: &'static str, height: f32, control: AnyElement) -> Div {
    let m = k.m;
    div()
        .flex()
        .items_center()
        .gap(m.px(10.0))
        .my(m.px(9.0))
        .child(
            div()
                .w(m.px(105.0))
                .flex_none()
                .child(k.text(10.0, 14.0, 400.0, k.t.text, label)),
        )
        .child(div().flex_1().h(m.px(height)).child(control))
}

fn properties(
    k: &Ink,
    props: &Properties,
    on_props: impl Fn(Properties, &mut gpui::App) + Clone + 'static,
    name: Option<AnyElement>,
    locked: bool,
) -> Div {
    let (m, t) = (k.m, k.t);
    let boxed = |value: AnyElement| {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_between()
            .px(m.px(8.0))
            .rounded(m.px(5.0))
            .border(m.border(1.0))
            .border_color(t.border)
            .bg(t.canvas)
            .text_size(m.px(10.0))
            .text_color(t.text)
            .child(value)
    };
    let choose_density = {
        let (on_props, props) = (on_props.clone(), props.clone());
        move |value: &SharedString, _: &mut gpui::Window, cx: &mut gpui::App| {
            on_props(
                Properties {
                    comfortable: value.as_ref() == "comfortable",
                    ..props.clone()
                },
                cx,
            )
        }
    };
    let toggle_details = {
        let (on_props, props) = (on_props.clone(), props.clone());
        move |_: &gpui::ClickEvent, _: &mut gpui::Window, cx: &mut gpui::App| {
            on_props(
                Properties {
                    details: !props.details,
                    ..props.clone()
                },
                cx,
            )
        }
    };
    let name = name.unwrap_or_else(|| {
        div()
            .child(SharedString::from(props.name.clone()))
            .into_any_element()
    });
    div()
        .px(m.px(17.0))
        .py(m.px(13.0))
        .child(div().mb(m.px(11.0)).child(k.text(
            10.0,
            14.0,
            400.0,
            t.text_muted,
            "Controles de demonstração. Não executam operações externas.",
        )))
        .child(field(
            k,
            "Nome de exemplo",
            32.0,
            boxed(name).into_any_element(),
        ))
        .child(field(
            k,
            "Visualização",
            34.0,
            if locked {
                // Inert while editing: the closed select, without its list.
                boxed(
                    div()
                        .flex_1()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(crate::i18n::t(if props.comfortable {
                            "Confortável"
                        } else {
                            "Compacta"
                        }))
                        .child(icon("chevron-down", m).size(12.0).color(t.text_muted))
                        .into_any_element(),
                )
                .into_any_element()
            } else {
                geppui::select(
                    "properties-density",
                    vec![
                        ("compact".into(), crate::i18n::t("Compacta")),
                        ("comfortable".into(), crate::i18n::t("Confortável")),
                    ],
                    if props.comfortable {
                        "comfortable"
                    } else {
                        "compact"
                    },
                )
                .label(crate::i18n::t("Visualização"))
                .metrics(34.0, 10.0, 14.0)
                .boxed(5.0, t.canvas, t.border, 8.0)
                .on_change(choose_density)
                .into_any_element()
            },
        ))
        .child(
            div()
                .id("properties-details")
                .mt(m.px(15.0))
                .flex()
                .items_center()
                .gap(m.px(7.0))
                .when(!locked, |el| el.cursor_pointer().on_click(toggle_details))
                .child(
                    div()
                        .size(m.px(13.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(m.px(3.0))
                        .when(props.details, |el| el.bg(t.accent))
                        .when(!props.details, |el| {
                            el.border(m.border(1.0))
                                .border_color(t.input_border)
                                .bg(t.canvas)
                        })
                        .when(props.details, |el| {
                            el.child(icon("check", m).size(11.0).color(t.primary_foreground))
                        }),
                )
                .child(k.text(10.0, 14.0, 400.0, t.text, "Mostrar detalhes de exemplo")),
        )
        .child(div().mt(m.px(13.0)).child(k.text(
            9.0,
            12.0,
            400.0,
            t.text_muted,
            "Interagir com um campo não desloca o widget.",
        )))
}

fn chart(k: &Ink, compact: bool) -> Div {
    let (m, t) = (k.m, k.t);
    let heights = [
        30.0, 45.0, 37.0, 63.0, 52.0, 81.0, 74.0, 92.0, 64.0, 85.0, 97.0, 78.0,
    ];
    let (pad_y, pad_x, bars) = if compact {
        (4.0, 8.0, 79.31)
    } else {
        (12.0, 16.0, 62.0)
    };
    div()
        .px(m.px(pad_x))
        .py(m.px(pad_y))
        .child(
            div()
                .flex()
                .justify_between()
                .child(k.text(10.0, 14.0, 400.0, t.text, "Ritmo fictício"))
                .child(k.text(10.0, 14.0, 700.0, t.accent, "+24%")),
        )
        .child(
            div()
                .flex()
                .items_end()
                .gap(m.px(5.0))
                .h(m.px(bars))
                .my(m.px(if compact { 2.0 } else { 9.0 }))
                .children(heights.map(|h| {
                    div()
                        .flex_1()
                        .h(gpui::relative(h / 100.0))
                        .rounded_t(m.px(2.0))
                        .bg(t.accent_muted)
                })),
        )
        .child(k.caption(
            "Não representa memória, CPU nem métricas reais.",
            if compact { 11.7 } else { 14.4 },
        ))
}
