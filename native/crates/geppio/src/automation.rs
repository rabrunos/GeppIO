//! Deterministic hooks for side-by-side comparisons, enabled only by `GEPPIO_NATIVE_TEST_*`:
//! a frozen clock inside a motion (`state@fraction`), scripted input scenarios and a
//! per-frame JSON-lines trace written inside the validated test profile.
use std::{fs::File, io::Write as _, time::Duration};

use geppui::{Appearance, motion::duration};
use gpui::Context;

use crate::{
    options::{Freeze, Options, Script},
    regions::Frame,
    workbench::Workbench,
};

pub struct Trace {
    file: File,
}

impl Trace {
    pub fn frame(&mut self, now: f64, f: &Frame, animating: bool) {
        if animating {
            let _ = writeln!(
                self.file,
                "{{\"t\":{now:.3},\"track\":{:.3},\"bottom\":{:.3},\"peekX\":{:.3},\"peekO\":{:.4},\"backdrop\":{:.4}}}",
                f.track, f.bottom, f.peek_x, f.peek_opacity, f.backdrop
            );
        }
    }
    pub fn event(&mut self, now: f64, event: &str) {
        let _ = writeln!(self.file, "{{\"t\":{now:.3},\"event\":\"{event}\"}}");
    }
}

pub struct Automation {
    pub reduced_override: Option<bool>,
    pub trace: Option<Trace>,
    freeze: Option<(Freeze, f64)>,
    script: Option<Script>,
}

impl Automation {
    pub fn new(options: &Options) -> Self {
        Self {
            reduced_override: options.reduced_motion,
            trace: options
                .trace
                .as_ref()
                .and_then(|p| File::options().write(true).create_new(true).open(p).ok())
                .map(|file| Trace { file }),
            freeze: options.freeze,
            script: options.script,
        }
    }

    pub fn start(&mut self, regions: &mut crate::regions::Regions, cx: &mut Context<Workbench>) {
        if let Some((state, fraction)) = self.freeze.take() {
            cx.global_mut::<Appearance>().clock.freeze(Some(0.0));
            regions.sample(0.0);
            let span = match state {
                Freeze::Collapse => {
                    regions.toggle_sidebar();
                    duration::REGION
                }
                Freeze::Expand => {
                    *regions = crate::regions::Regions::new(
                        regions.sidebar_width,
                        regions.bottom_height,
                        true,
                        regions.bottom_collapsed,
                    );
                    regions.sample(0.0);
                    regions.toggle_sidebar();
                    duration::REGION
                }
                Freeze::Peek => {
                    *regions = crate::regions::Regions::new(
                        regions.sidebar_width,
                        regions.bottom_height,
                        true,
                        regions.bottom_collapsed,
                    );
                    regions.sample(0.0);
                    regions.open_peek();
                    duration::REGION
                }
                Freeze::Bottom => {
                    regions.toggle_bottom();
                    duration::REGION
                }
            };
            regions.sample(0.0);
            cx.global_mut::<Appearance>()
                .clock
                .freeze(Some(span * fraction));
        }
        let Some(script) = self.script.take() else {
            return;
        };
        let steps: Vec<(u64, &'static str)> = match script {
            Script::CollapseInterrupt => vec![(1000, "toggle"), (170, "toggle"), (900, "quit")],
            Script::CollapseFull => vec![(1000, "toggle"), (700, "toggle"), (700, "quit")],
            Script::Peek => vec![
                (1000, "collapse"),
                (600, "open"),
                (700, "close"),
                (600, "quit"),
            ],
            Script::PeekInterrupt => vec![
                (1000, "collapse"),
                (600, "open"),
                (100, "close"),
                (700, "quit"),
            ],
            Script::Bottom => vec![(1000, "bottom"), (700, "bottom"), (700, "quit")],
            Script::Theme => vec![(1000, "theme"), (500, "quit")],
        };
        cx.spawn(async move |this, cx| {
            for (wait, action) in steps {
                cx.background_executor()
                    .timer(Duration::from_millis(wait))
                    .await;
                if action == "quit" {
                    cx.update(|cx| cx.quit());
                    return;
                }
                let _ = this.update(cx, |this, cx| {
                    let now = geppui::now(cx);
                    if let Some(trace) = this.automation.trace.as_mut() {
                        trace.event(now, action);
                    }
                    match action {
                        "toggle" => this.toggle_sidebar(cx),
                        "collapse" => {
                            this.toggle_sidebar(cx);
                            this.regions.block_peek = false;
                        }
                        "open" => this.regions.open_peek(),
                        "close" => this.regions.close_peek(),
                        "bottom" => this.regions.toggle_bottom(),
                        "theme" => this.toggle_theme(cx),
                        _ => {}
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }
}
