//! A host that knows nothing about GeppIO: theme switch, buttons, a popover, a dialog,
//! a scroll area and an interruptible transition, through GeppUI's public API only.
#![forbid(unsafe_code)]

use geppui::{
    AnchorHandle, Appearance, GeppuiAssets, ThemeName, Transition, anchor_probe, button, dialog,
    icon_button, menu_item,
    motion::{self, duration},
    popover, scroll_area, spaced_text,
};
use gpui::{
    App, AppContext, Bounds, Context, IntoElement, ParentElement, Render, ScrollHandle, Styled,
    Window, WindowBounds, WindowOptions, div, point, prelude::FluentBuilder, px, size,
};

struct Demo {
    open: bool,
    dialog: bool,
    anchor: AnchorHandle,
    slide: Transition,
    scroll: ScrollHandle,
}

impl Demo {
    fn toggle_slide(&mut self, cx: &mut Context<Self>) {
        let target = if self.slide.target() > 0.0 {
            0.0
        } else {
            240.0
        };
        let d = geppui::appearance(cx).duration(duration::REGION);
        self.slide.request(target, d, motion::REGION);
        cx.notify();
    }
}

impl Render for Demo {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = geppui::theme(cx);
        let m = geppui::metrics(window, cx);
        let now = geppui::now(cx);
        let x = self.slide.sample(now) as f32;
        if self.slide.animating(now) {
            window.request_animation_frame();
        }
        let view = cx.entity().downgrade();
        let view2 = view.clone();
        div()
            .size_full()
            .bg(t.region)
            .text_color(t.text)
            .font_family(geppui::UI_FONT)
            .text_size(m.px(13.0))
            .p(m.px(22.0))
            .flex()
            .flex_col()
            .gap(m.px(16.0))
            .child(
                spaced_text("GEPPUI", m)
                    .size(14.0, 22.0)
                    .color(t.text_muted)
                    .letter_spacing_em(0.08),
            )
            .child(
                div()
                    .flex()
                    .gap(m.px(11.0))
                    .child(button("theme").label("Alternar tema").on_click(cx.listener(
                        |_, _, _, cx| {
                            let next = geppui::theme(cx).name.toggled();
                            cx.global_mut::<Appearance>().set_theme(next);
                            cx.refresh_windows();
                        },
                    )))
                    .child(
                        button("slide")
                            .label("Mover")
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_slide(cx))),
                    )
                    .child(
                        div().relative().child(anchor_probe(&self.anchor)).child(
                            icon_button("menu", "ellipsis-horizontal")
                                .label("Menu")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.open = !this.open;
                                    cx.notify();
                                })),
                        ),
                    ),
            )
            .child(
                div().relative().h(m.px(40.0)).child(
                    div()
                        .absolute()
                        .left(m.px(x))
                        .size(m.px(40.0))
                        .rounded(m.px(8.0))
                        .bg(t.accent),
                ),
            )
            .child(
                div()
                    .h(m.px(160.0))
                    .w(m.px(320.0))
                    .border(m.border(1.0))
                    .border_color(t.border)
                    .rounded(m.px(12.0))
                    .bg(t.surface)
                    .child(
                        scroll_area("list", &self.scroll).children((1..=20).map(|i| {
                            div()
                                .px(m.px(11.0))
                                .py(m.px(6.0))
                                .child(format!("Item {i}"))
                        })),
                    ),
            )
            .when(self.open, |el| {
                el.child(
                    popover("demo-menu", &self.anchor)
                        .width(248.0)
                        .padding(9.0, 11.0)
                        .on_dismiss(move |_, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.open = false;
                                cx.notify();
                            });
                        })
                        .child(
                            menu_item("about", "Abrir diálogo")
                                .icon("information-circle")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.open = false;
                                    this.dialog = true;
                                    cx.notify();
                                })),
                        ),
                )
            })
            .when(self.dialog, |el| {
                el.child(dialog("demo-dialog", "Diálogo").on_dismiss(move |_, cx| {
                    let _ = view2.update(cx, |this, cx| {
                        this.dialog = false;
                        cx.notify();
                    });
                }))
            })
    }
}

fn main() {
    gpui_platform::application()
        .with_assets(GeppuiAssets)
        .run(|cx: &mut App| {
            geppui::init(cx, Appearance::new(ThemeName::Light));
            let bounds = Bounds {
                origin: point(px(80.0), px(80.0)),
                size: size(px(640.0), px(420.0)),
            };
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    ..Default::default()
                },
                |_, cx| {
                    cx.new(|_| Demo {
                        open: false,
                        dialog: false,
                        anchor: AnchorHandle::default(),
                        slide: Transition::new(0.0),
                        scroll: ScrollHandle::new(),
                    })
                },
            )
            .expect("open the demo window");
            cx.activate(true);
        });
}
