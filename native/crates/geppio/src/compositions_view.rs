//! The "Composições" tab of the edit catalog (`CompositionLibrary.tsx`,
//! `CompositionThumbnail.tsx`, `usePortableCompositions.tsx`, `useCompositionReorder.ts` and
//! `features-compositions.saved-compositions.css` at alpha.99):
//! - search, the Favoritas / Salvas tabs and the 3-column grid of tiles with drawn thumbnails;
//! - "Formato" / "Widgets" on hover, the default pin, the favorite star and the options menu;
//! - reordering by pointer (150ms FLIP of the siblings, the card follows the pointer);
//! - "Restaurar layout padrão", "Salvar atual" with its dialog, "Favoritos cheios", the
//!   confirmations and the portable import preview, export and widget mapping.
//!
//! Every change of the library is one intention of the edit session; the model lives in
//! `geppio_core::workbench::{compositions, portable_compositions}`.
use std::collections::HashMap;

use geppio_core::layout::Region;
use geppio_core::workbench::compositions::{
    capture_current_composition, composition_order, favorite_composition, reorder_composition,
    system_compositions,
};
use geppio_core::workbench::portable::{
    PortableLayout, parse_portable_text, serialize_portable_layout,
};
use geppio_core::workbench::portable_compositions::{
    export_portable_composition, import_portable_composition, portable_dependencies,
    resolve_portable_widgets,
};
use geppio_core::workbench::{ApplyMode, Composition, CompositionMode, WorkbenchSnapshot};
use geppui::{
    AnchorHandle, DialogButtonKind, Metrics, Placement, TextField, Theme, Transition, anchor_probe,
    checkbox, css_weight, dialog, dialog_button, icon, menu_item, popover, text_action,
};
use gpui::{
    AnyElement, AppContext, Context, Div, Entity, InteractiveElement, IntoElement, MouseButton,
    MouseDownEvent, ParentElement, Pixels, Point, ScrollHandle, SharedString,
    StatefulInteractiveElement, Styled, Window, div, prelude::FluentBuilder,
};

use crate::i18n::Tr;
use crate::workbench::Workbench;

/// The library tab.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LibraryTab {
    #[default]
    Favorites,
    Saved,
}

/// The open "Salvar nova composição" form.
#[derive(Clone, Debug, PartialEq)]
pub struct SaveForm {
    pub scopes: Vec<Region>,
    pub side_width: bool,
}

/// What a confirmation runs.
#[derive(Clone, Debug, PartialEq)]
pub enum ConfirmAction {
    /// "Salvar a edição primeiro?" before "Salvar atual".
    SaveFirst,
    /// "Salvar a edição primeiro?" before an import.
    ImportCheckpoint,
    /// Remove a favorite (and the default mark).
    Unfavorite(String),
    /// Delete a saved record.
    Delete(String),
}

/// An open confirmation (`Confirm`).
#[derive(Clone, Debug, PartialEq)]
pub struct Confirm {
    pub title: SharedString,
    pub text: SharedString,
    pub label: SharedString,
    pub destructive: bool,
    pub action: ConfirmAction,
}

/// "Favoritos cheios": which favorite to replace.
#[derive(Clone, Debug, PartialEq)]
pub struct Replace {
    pub id: String,
    pub make_default: bool,
    pub selected: Option<String>,
}

/// The import preview of a picked recipe.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportPreview {
    pub recipe: PortableLayout,
    pub record: Composition,
    pub stamp: String,
    /// When the preview opened: its status shows only messages from then on (the reference
    /// clears the transaction message).
    pub opened_at: f64,
}

/// "Escolher apresentações" for a portable record with ambiguous bindings.
#[derive(Clone, Debug, PartialEq)]
pub struct Mapping {
    pub item: Composition,
    pub stamp: String,
    pub choices: Vec<(String, String)>,
}

/// A tile reorder in progress (`useCompositionReorder`).
#[derive(Clone, Debug, PartialEq)]
pub struct TileDrag {
    pub id: String,
    pub start: (f32, f32),
    pub pos: (f32, f32),
    /// Pointer offset inside the card.
    pub offset: (f32, f32),
    pub started: bool,
    /// Provisional order of the visible tab.
    pub order: Vec<String>,
}

/// The card that followed the pointer, flying to its final cell (150ms).
#[derive(Clone, Debug, PartialEq)]
pub struct Landing {
    pub id: String,
    pub from: (f32, f32),
    pub start: f64,
}

pub struct CompositionsUi {
    pub tab: LibraryTab,
    pub search: Entity<TextField>,
    pub name_field: Entity<TextField>,
    pub import_name: Entity<TextField>,
    pub form: Option<SaveForm>,
    pub options: Option<(String, Point<Pixels>)>,
    pub confirm: Option<Confirm>,
    pub replace: Option<Replace>,
    pub import: Option<ImportPreview>,
    pub mapping: Option<Mapping>,
    pub working: bool,
    /// Hovered tile and the time the pointer entered (or left, when `false`).
    pub hover: Option<(String, f64, bool)>,
    pub drag: Option<TileDrag>,
    pub landing: Option<Landing>,
    /// FLIP offsets of the tiles (CSS px) animating to 0.
    pub flips: HashMap<String, (Transition, Transition)>,
    pub grid: AnchorHandle,
    pub scroll: ScrollHandle,
    pub anchors: HashMap<String, AnchorHandle>,
}

impl CompositionsUi {
    pub fn new(cx: &mut Context<Workbench>) -> Self {
        let search = cx.new(|cx| TextField::new(cx).font(12.0, 16.0).max_length(1024));
        let name_field = cx.new(|cx| TextField::new(cx).max_length(40).font(13.0, 18.0));
        let import_name = cx.new(|cx| TextField::new(cx).max_length(100).font(13.0, 18.0));
        cx.subscribe(&search, |_, _, _, cx| cx.notify()).detach();
        cx.subscribe(&name_field, |this, _, event, cx| match event {
            geppui::TextFieldEvent::Submitted => this.submit_save(cx),
            geppui::TextFieldEvent::Changed => cx.notify(),
        })
        .detach();
        cx.subscribe(&import_name, |this, _, event, cx| match event {
            geppui::TextFieldEvent::Submitted => this.import_preview_submit(false, cx),
            geppui::TextFieldEvent::Changed => cx.notify(),
        })
        .detach();
        Self {
            tab: LibraryTab::Favorites,
            search,
            name_field,
            import_name,
            form: None,
            options: None,
            confirm: None,
            replace: None,
            import: None,
            mapping: None,
            working: false,
            hover: None,
            drag: None,
            landing: None,
            flips: HashMap::new(),
            grid: AnchorHandle::default(),
            scroll: ScrollHandle::new(),
            anchors: HashMap::new(),
        }
    }

    /// Whether a hover fade, a FLIP or a landing is running.
    pub fn animating(&self, now: f64) -> bool {
        self.hover
            .as_ref()
            .is_some_and(|(_, at, _)| now - at < 220.0)
            || self
                .flips
                .values()
                .any(|(x, y)| x.animating(now) || y.animating(now))
            || self.landing.as_ref().is_some_and(|l| now - l.start < 150.0)
    }
}

// ---- thumbnails ---------------------------------------------------------------------------

/// The role of a thumbnail rectangle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellRole {
    Sidebar,
    Omitted(Region),
    Widget(Region),
}

/// One thumbnail rectangle in the 160×80 viewBox (`CompositionThumbnail.cells`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub role: CellRole,
}

/// The saved percentages of a composition, without measuring the workspace.
pub fn cells(c: &Composition) -> Vec<Cell> {
    let side_patch = c.chrome.and_then(|p| p.sidebar).and_then(|e| e.size);
    let bottom_patch = c.chrome.and_then(|p| p.bottom).and_then(|e| e.size);
    let side_size = side_patch.unwrap_or(c.reference.sidebar.width + 30.0);
    let bottom_size = bottom_patch.unwrap_or(c.reference.bottom.height + 20.0);
    let side = if side_patch.is_none() {
        0.0
    } else if side_size <= 250.0 {
        22.0
    } else if side_size <= 340.0 {
        28.0
    } else {
        38.0
    };
    let bottom = if !c.scopes.contains(&Region::Bottom) {
        0.0
    } else if bottom_size <= 160.0 {
        14.0
    } else {
        21.0
    };
    let left = 3.0 + side + if side > 0.0 { 3.0 } else { 0.0 };
    let width = 157.0 - left;
    let mut out = Vec::new();
    if side > 0.0 {
        out.push(Cell {
            x: 3.0,
            y: 3.0,
            width: side,
            height: 74.0,
            role: CellRole::Sidebar,
        });
    }
    for region in [Region::Main, Region::Bottom] {
        if region == Region::Bottom && bottom == 0.0 {
            continue;
        }
        let (top, height) = if region == Region::Main {
            (3.0, 74.0 - bottom - if bottom > 0.0 { 3.0 } else { 0.0 })
        } else {
            (77.0 - bottom, bottom)
        };
        if !c.scopes.contains(&region) {
            out.push(Cell {
                x: left,
                y: top,
                width,
                height,
                role: CellRole::Omitted(region),
            });
            continue;
        }
        let reference = c.reference.get(region);
        for slot in c.format.iter().filter(|s| s.region == region) {
            out.push(Cell {
                x: left + slot.x / reference.width * width,
                y: top + slot.y / reference.height * height,
                width: slot.width / reference.width * width,
                height: slot.height / reference.height * height,
                role: CellRole::Widget(region),
            });
        }
    }
    out
}

/// The thumbnail drawn into a `w`×`h` CSS box (`preserveAspectRatio: xMidYMid meet`):
/// `rx 4`, widget cells stroked 1 unit with the surface colour, omitted regions at 25%.
pub fn thumbnail(c: &Composition, w: f32, h: f32, m: Metrics, t: Theme) -> Div {
    let scale = (w / 160.0).min(h / 80.0);
    let (ox, oy) = ((w - 160.0 * scale) / 2.0, (h - 80.0 * scale) / 2.0);
    let stroke = scale;
    div()
        .relative()
        .w(m.px(w))
        .h(m.px(h))
        .flex_none()
        .children(cells(c).into_iter().map(|cell| {
            let (fill, omitted, widget) = match cell.role {
                CellRole::Sidebar => (t.composition_sidebar, false, false),
                CellRole::Omitted(Region::Bottom) => (t.composition_bottom, true, false),
                CellRole::Omitted(_) => (t.composition_main, true, false),
                CellRole::Widget(Region::Bottom) => (t.composition_bottom, false, true),
                CellRole::Widget(_) => (t.composition_main, false, true),
            };
            let (x, y) = (ox + cell.x as f32 * scale, oy + cell.y as f32 * scale);
            let (cw, ch) = (cell.width as f32 * scale, cell.height as f32 * scale);
            // A centred SVG stroke: half outside the rectangle, half over its fill.
            let grow = if widget { stroke / 2.0 } else { 0.0 };
            div()
                .absolute()
                .left(m.px(x - grow))
                .top(m.px(y - grow))
                .w(m.px(cw + 2.0 * grow))
                .h(m.px(ch + 2.0 * grow))
                .rounded(m.px(4.0 * scale + grow))
                .bg(fill)
                .when(widget, |el| el.border(m.px(stroke)).border_color(t.surface))
                .when(omitted, |el| el.opacity(0.25))
        }))
}

// ---- helpers --------------------------------------------------------------------------------

fn display_name(item: &Composition, tr: Tr) -> SharedString {
    if item.system {
        tr.t(&item.name)
    } else {
        item.name.clone().into()
    }
}

/// The library order of one tab, resolved against the available entries.
fn ordered(snapshot: &WorkbenchSnapshot, all: &[Composition], favorites: bool) -> Vec<Composition> {
    composition_order(snapshot, favorites)
        .into_iter()
        .filter_map(|id| all.iter().find(|c| c.id == id).cloned())
        .collect()
}

/// A random-enough identity (`crypto.randomUUID`).
fn new_id(prefix: &str) -> String {
    format!("{prefix}{}", crate::bars::uuid())
}

/// The reference's `safeExplorerName` for one path component.
pub fn safe_file_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    let stem = lower.split('.').next().unwrap_or("");
    let reserved = matches!(stem, "con" | "prn" | "aux" | "nul")
        || ((stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.chars().count() == 4
            && stem
                .chars()
                .last()
                .is_some_and(|c| matches!(c, '1'..='9' | '¹' | '²' | '³')));
    !name.is_empty()
        && name.encode_utf16().count() <= 255
        && !name.chars().any(|c| (c as u32) < 32 || c as u32 == 127)
        && !name
            .chars()
            .any(|c| matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'))
        && !name.ends_with('.')
        && !name.ends_with(' ')
        // `^(\.|\.\.)(?:\.|$)`: ".", ".." and anything starting with "..".
        && name != "."
        && !name.starts_with("..")
        && !reserved
        && !name
            .as_bytes()
            .windows(2)
            .any(|w| w[0] == b'~' && w[1].is_ascii_digit())
}

/// A picked `.geppio-layout.json` path the reference accepts (`selectedPath`): valid UTF-16
/// (no lone surrogates), absolute on a drive, every component safe, the name ending in the
/// extension.
pub fn selected_path(path: &std::path::Path) -> bool {
    let Some(text) = path.to_str() else {
        return false;
    };
    let bytes = text.as_bytes();
    let drive =
        bytes.len() > 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    let name = path.file_name().and_then(|n| n.to_str());
    drive
        && text.len() <= 8192
        && !text.contains("\\\\")
        && text[3..].split('\\').all(safe_file_name)
        && name.is_some_and(|n| n.to_lowercase().ends_with(".geppio-layout.json"))
}

/// No component of `path` (nor `path`) is a link or junction, and its canonical form is the
/// same path (`inspectExplorerPath`).
fn plain_chain(path: &std::path::Path) -> bool {
    let mut current = Some(path);
    while let Some(p) = current {
        match std::fs::symlink_metadata(p) {
            Ok(meta) if !meta.file_type().is_symlink() => {}
            _ => return false,
        }
        current = p.parent().filter(|parent| !parent.as_os_str().is_empty());
    }
    let (Ok(canonical), Some(text)) = (std::fs::canonicalize(path), path.to_str()) else {
        return false;
    };
    let Some(canonical) = canonical.to_str() else {
        return false;
    };
    let canonical = canonical.strip_prefix(r"\\?\").unwrap_or(canonical);
    canonical.to_lowercase() == text.to_lowercase()
}

/// A file's identity as far as stable std exposes it (`dev/ino/birthtime` in the reference):
/// creation time, last write time and size.
#[cfg(windows)]
fn identity(meta: &std::fs::Metadata) -> (u64, u64, u64) {
    use std::os::windows::fs::MetadataExt as _;
    (
        meta.creation_time(),
        meta.last_write_time(),
        meta.file_size(),
    )
}
#[cfg(not(windows))]
fn identity(meta: &std::fs::Metadata) -> (u64, u64, u64) {
    use std::os::unix::fs::MetadataExt as _;
    (meta.dev(), meta.ino(), meta.size())
}

/// Read access that lets others read but neither write, rename nor delete while we hold it.
fn exclusive(options: &mut std::fs::OpenOptions) -> &mut std::fs::OpenOptions {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        options.share_mode(0x1); // FILE_SHARE_READ
    }
    options
}

/// Outcome of writing an exported recipe.
#[derive(Debug, PartialEq, Eq)]
pub enum ExportOutcome {
    Written,
    Exists,
    /// The file was created but could not be confirmed.
    Unconfirmed,
    Failed,
}

/// Creates the picked file only if it does not exist, writes, flushes and reads it back through
/// the same handle, then confirms the path still names that file (`exportLayoutFile`). A file
/// this call created is never removed: its state is reported.
pub fn write_export(path: &std::path::Path, content: &str) -> ExportOutcome {
    use std::io::{Read as _, Seek as _, Write as _};
    let Some(parent) = path.parent() else {
        return ExportOutcome::Failed;
    };
    if !plain_chain(parent) {
        return ExportOutcome::Failed;
    }
    // `create_new` is atomic and never follows an existing link at the leaf.
    let mut file = match exclusive(
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true),
    )
    .open(path)
    {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return ExportOutcome::Exists,
        Err(_) => return ExportOutcome::Failed,
    };
    let confirmed = (|| -> std::io::Result<bool> {
        if !file.metadata()?.is_file() || !plain_chain(parent) {
            return Ok(false);
        }
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        file.seek(std::io::SeekFrom::Start(0))?;
        let max = geppio_core::layout::policy::MAX_BYTES as u64;
        let mut back = Vec::new();
        (&file).take(max + 1).read_to_end(&mut back)?;
        let written = identity(&file.metadata()?);
        drop(file);
        Ok(back == content.as_bytes()
            && plain_chain(path)
            && std::fs::symlink_metadata(path)
                .is_ok_and(|m| m.is_file() && identity(&m) == written))
    })();
    match confirmed {
        Ok(true) => ExportOutcome::Written,
        _ => ExportOutcome::Unconfirmed,
    }
}

/// Reads a picked recipe (`importLayoutFile`): the path rules, then a regular file of at most
/// 64 KiB read through one handle whose identity matches the checked path before and after
/// the read, UTF-8 with one leading BOM removed.
pub fn read_recipe(path: &std::path::Path) -> Result<PortableLayout, &'static str> {
    use std::io::Read as _;
    if !selected_path(path) {
        return Err("Selecione um arquivo .geppio-layout.json.");
    }
    const UNREADABLE: &str =
        "Composição ilegível ou incompatível. Verifique o formato e o limite de 64 KiB.";
    let max = geppio_core::layout::policy::MAX_BYTES as u64;
    let checked = std::fs::symlink_metadata(path).map_err(|_| UNREADABLE)?;
    if !checked.is_file()
        || checked.file_type().is_symlink()
        || checked.len() > max
        || !plain_chain(path)
    {
        return Err(UNREADABLE);
    }
    let file = exclusive(std::fs::OpenOptions::new().read(true))
        .open(path)
        .map_err(|_| UNREADABLE)?;
    let opened = file.metadata().map_err(|_| UNREADABLE)?;
    if !opened.is_file() || opened.len() > max || identity(&opened) != identity(&checked) {
        return Err(UNREADABLE);
    }
    let mut bytes = Vec::new();
    (&file)
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNREADABLE)?;
    let after = std::fs::symlink_metadata(path).map_err(|_| UNREADABLE)?;
    if bytes.len() as u64 > max || identity(&after) != identity(&checked) || !plain_chain(path) {
        return Err(UNREADABLE);
    }
    drop(file);
    let text = String::from_utf8(bytes).map_err(|_| UNREADABLE)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    parse_portable_text(text).map_err(|_| UNREADABLE)
}

// ---- actions --------------------------------------------------------------------------------

impl Workbench {
    fn library_entries(&self) -> Vec<Composition> {
        self.session.compositions()
    }

    /// The dependency stamp of a portable record (`stamp`): without plugins, the dependency
    /// list itself.
    fn portable_stamp(&self, item: &Composition) -> String {
        format!(
            "{:?}",
            portable_dependencies(self.session.draft(), self.session.registry(), item, &[])
        )
    }

    /// The transaction's latest message (`tx.message`): the last one shown, else the
    /// session's.
    fn latest_message(&self) -> String {
        self.edit
            .toast
            .as_ref()
            .map_or_else(|| self.session.message().to_owned(), |(m, _)| m.clone())
    }

    fn library_message(&mut self, message: &str, cx: &mut Context<Self>) {
        self.edit.toast(message, geppui::now(cx));
        cx.notify();
    }

    /// "Formato" / "Widgets" of a tile (`apply`).
    pub(crate) fn apply_library(&mut self, id: &str, mode: ApplyMode, cx: &mut Context<Self>) {
        let Some(item) = self.session.composition(id) else {
            return;
        };
        if item.portable.is_some() {
            if !self.session.can_import_composition() || self.edit.gesture.is_some() {
                return;
            }
            if mode == ApplyMode::Widgets {
                self.portable_widgets(item, cx);
                return;
            }
        }
        self.apply_local(item, mode, cx);
    }

    fn apply_local(&mut self, item: Composition, mode: ApplyMode, cx: &mut Context<Self>) {
        let now = geppui::now(cx);
        let reduced = geppui::appearance(cx).reduced_motion;
        let surfaces = self.ports.surfaces;
        self.flip_quietly(now, reduced, |w| {
            w.session.apply_composition(&item, mode, &surfaces).is_ok()
        });
        cx.notify();
    }

    fn favorite(
        &mut self,
        id: &str,
        make_default: bool,
        replacement: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        let draft = self.session.draft().clone();
        let org = &draft.organization;
        if make_default && org.default_composition.as_deref() == Some(id) {
            let mut next = draft.clone();
            next.organization.default_composition = None;
            let _ = self.session.edit_action(next);
            cx.notify();
            return;
        }
        let present = org.favorites.iter().any(|f| f == id);
        match favorite_composition(
            &draft,
            id,
            make_default || !present,
            make_default,
            replacement,
        ) {
            Some(next) => {
                let _ = self.session.edit_action(next);
            }
            None => {
                self.compositions.replace = Some(Replace {
                    id: id.to_owned(),
                    make_default,
                    selected: None,
                });
            }
        }
        cx.notify();
    }

    fn toggle_favorite(&mut self, item: &Composition, tr: Tr, cx: &mut Context<Self>) {
        let org = &self.session.draft().organization;
        if !org.favorites.contains(&item.id) {
            self.favorite(&item.id, false, None, cx);
            return;
        }
        let clear_default = org.default_composition.as_deref() == Some(item.id.as_str());
        if clear_default || self.compositions.tab == LibraryTab::Favorites {
            let name = display_name(item, tr);
            self.compositions.confirm = Some(if clear_default {
                Confirm {
                    title: tr.t("Desmarcar a composição padrão?"),
                    text: tr.f("“{0}” precisa deixar de ser padrão para sair dos favoritos. Ao continuar, as duas marcações serão removidas. A composição continuará salva.", &[&name]),
                    label: tr.t("Desmarcar e remover favorito"),
                    destructive: false,
                    action: ConfirmAction::Unfavorite(item.id.clone()),
                }
            } else {
                Confirm {
                    title: tr.f("Remover {0} dos favoritos?", &[&name]),
                    text: tr.t("A composição sairá desta aba e continuará disponível em Composições Salvas."),
                    label: tr.t("Remover dos favoritos"),
                    destructive: false,
                    action: ConfirmAction::Unfavorite(item.id.clone()),
                }
            });
            cx.notify();
        } else {
            self.favorite(&item.id, false, None, cx);
        }
    }

    fn delete_composition(&mut self, id: &str, cx: &mut Context<Self>) {
        let mut next = self.session.draft().clone();
        let org = &mut next.organization;
        org.compositions.retain(|c| c.id != id);
        org.favorites.retain(|f| f != id);
        if let Some(order) = org.composition_order.as_mut() {
            order.retain(|o| o != id);
        }
        if org.default_composition.as_deref() == Some(id) {
            org.default_composition = None;
        }
        let _ = self.session.edit_action(next);
        cx.notify();
    }

    fn run_confirm(&mut self, cx: &mut Context<Self>) {
        let Some(confirm) = self.compositions.confirm.take() else {
            return;
        };
        match confirm.action {
            ConfirmAction::Unfavorite(id) => self.favorite(&id, false, None, cx),
            ConfirmAction::Delete(id) => self.delete_composition(&id, cx),
            ConfirmAction::SaveFirst => {
                let surfaces = self.ports.surfaces;
                let ok = self.session.save(&surfaces, &mut self.store).is_ok();
                let message = self.session.message().to_owned();
                self.library_message(&message, cx);
                if ok {
                    self.open_save_form(cx);
                }
            }
            ConfirmAction::ImportCheckpoint => self.import_preview_submit(true, cx),
        }
        cx.notify();
    }

    /// "Salvar atual" (`saveCurrent`).
    fn save_current(&mut self, tr: Tr, cx: &mut Context<Self>) {
        if !self.session.has_pending() {
            self.open_save_form(cx);
            return;
        }
        self.compositions.confirm = Some(Confirm {
            title: tr.t("Salvar a edição primeiro?"),
            text: tr.t("Salve o checkpoint da edição e continue para criar uma composição. O editor e as reservas continuam abertos."),
            label: tr.t("Salvar edição e continuar"),
            destructive: false,
            action: ConfirmAction::SaveFirst,
        });
        cx.notify();
    }

    fn open_save_form(&mut self, cx: &mut Context<Self>) {
        let chrome = self.session.draft().organization.chrome;
        self.compositions.form = Some(SaveForm {
            scopes: if chrome.bottom.visible {
                vec![Region::Main, Region::Bottom]
            } else {
                vec![Region::Main]
            },
            side_width: chrome.sidebar.visible,
        });
        let placeholder = crate::i18n::tr(cx).t("Ex.: Meu espaço de trabalho");
        self.compositions.name_field.update(cx, |f, cx| {
            f.set_placeholder(placeholder);
            f.set_text("", cx);
        });
        self.pending_text_focus = Some(self.compositions.name_field.clone());
        cx.notify();
    }

    fn submit_save(&mut self, cx: &mut Context<Self>) {
        let Some(form) = self.compositions.form.clone() else {
            return;
        };
        let name: String = self
            .compositions
            .name_field
            .read(cx)
            .text()
            .chars()
            .filter(|c| !crate::prefs::hidden_char(*c))
            .collect();
        let name = name.trim().to_owned();
        if name.is_empty() || (form.scopes.is_empty() && !form.side_width) {
            return;
        }
        let (view, _) = self.session.view(&self.ports.surfaces);
        let record = capture_current_composition(
            &view,
            &new_id("composition:"),
            &name,
            &form.scopes,
            form.side_width,
            self.session.slots(),
        );
        let ok = self
            .session
            .save_composition(record, &mut self.store)
            .is_ok();
        if ok {
            self.compositions.form = None;
            self.compositions
                .name_field
                .update(cx, |f, cx| f.set_text("", cx));
        }
        let message = self.session.message().to_owned();
        self.library_message(&message, cx);
    }

    /// "Restaurar layout padrão": the default favorite (or Padrão) with its widgets.
    fn restore_default(&mut self, cx: &mut Context<Self>) {
        let all = self.library_entries();
        let default = self
            .session
            .draft()
            .organization
            .default_composition
            .clone();
        let item = default
            .and_then(|id| all.iter().find(|c| c.id == id).cloned())
            .or_else(|| {
                system_compositions(self.session.demo_fixtures())
                    .into_iter()
                    .next()
            });
        if let Some(item) = item {
            let id = item.id.clone();
            self.apply_library(&id, ApplyMode::Widgets, cx);
        }
    }

    // ---- portable records ----------------------------------------------------------------

    /// Why a portable record cannot restore its widgets (`reason`), if it cannot.
    fn portable_reason(&self, item: &Composition) -> Option<String> {
        let recipe = item.portable.as_ref()?;
        if recipe.mode == CompositionMode::FormatWidgets && recipe.views.is_empty() {
            return Some("Esta composição não contém associações de widgets.".into());
        }
        let deps = portable_dependencies(self.session.draft(), self.session.registry(), item, &[]);
        deps.iter()
            .find(|d| d.reason.is_some() || d.candidates.is_empty())
            .map(|d| {
                format!(
                    "{} — {}",
                    d.label,
                    crate::i18n::t(d.reason.unwrap_or("Nenhuma apresentação local compatível."))
                )
            })
    }

    fn portable_widgets(&mut self, item: Composition, cx: &mut Context<Self>) {
        if let Some(problem) = self.portable_reason(&item) {
            self.library_message(&problem, cx);
            return;
        }
        let stamp = self.portable_stamp(&item);
        let deps = portable_dependencies(self.session.draft(), self.session.registry(), &item, &[]);
        if deps.iter().any(|d| d.candidates.len() > 1) {
            self.compositions.mapping = Some(Mapping {
                item,
                stamp,
                choices: Vec::new(),
            });
            cx.notify();
        } else {
            self.resolve_portable(item, Vec::new(), stamp, cx);
        }
    }

    fn resolve_portable(
        &mut self,
        item: Composition,
        choices: Vec<(String, String)>,
        expected: String,
        cx: &mut Context<Self>,
    ) {
        let current = self
            .session
            .draft()
            .organization
            .compositions
            .iter()
            .find(|c| c.id == item.id)
            .cloned();
        let Some(current) = current.filter(|c| {
            self.session.can_import_composition()
                && self.portable_stamp(c) == expected
                && c.portable == item.portable
        }) else {
            self.library_message(
                "A composição ou as dependências mudaram. Confira as opções e tente novamente.",
                cx,
            );
            return;
        };
        let (view, _) = self.session.view(&self.ports.surfaces);
        let scene = geppio_core::workbench::compositions::composition_scene(
            self.session.draft(),
            &view,
            &current.scopes,
        );
        let mut group_id = || geppio_core::workbench::groups::new_group_id();
        let value = resolve_portable_widgets(
            &scene,
            self.session.registry(),
            &current,
            &[],
            &choices,
            &mut group_id,
        );
        match value {
            Some(value) => {
                self.compositions.mapping = None;
                self.apply_local(value, ApplyMode::Widgets, cx);
            }
            None => self.library_message("As apresentações atuais são incompatíveis com a composição. Confira os widgets disponíveis.", cx),
        }
    }

    fn import_allowed(&self) -> bool {
        self.session.can_import_composition() && self.edit.gesture.is_none()
    }

    /// "Importar composição…": the OS file dialog, a bounded background read and the preview.
    fn select_import(&mut self, cx: &mut Context<Self>) {
        if self.compositions.working || !self.import_allowed() {
            return;
        }
        self.compositions.working = true;
        let picked = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: None,
        });
        cx.spawn(async move |this, cx| {
            let picked = picked.await;
            let path = match picked {
                Ok(Ok(Some(paths))) => paths.into_iter().next(),
                Ok(Ok(None)) => None,
                _ => {
                    let _ = this.update(cx, |this, cx| {
                        this.compositions.working = false;
                        this.library_message(
                            "Não foi possível receber a composição selecionada.",
                            cx,
                        );
                    });
                    return;
                }
            };
            let read = match path {
                Some(path) => Some(
                    cx.background_executor()
                        .spawn(async move { read_recipe(&path) })
                        .await,
                ),
                None => None,
            };
            let _ = this.update(cx, |this, cx| {
                this.compositions.working = false;
                if !this.import_allowed() {
                    return;
                }
                match read {
                    None => {}
                    Some(Err(message)) => this.library_message(message, cx),
                    Some(Ok(recipe)) => this.preview_recipe(recipe, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn preview_recipe(&mut self, recipe: PortableLayout, cx: &mut Context<Self>) {
        match import_portable_composition(
            self.session.draft(),
            &recipe,
            &recipe.name,
            &new_id("composition:"),
        ) {
            Ok(record) => {
                let stamp = self.portable_stamp(&record);
                let name = record.name.clone();
                self.compositions.import = Some(ImportPreview {
                    recipe,
                    record,
                    stamp,
                    opened_at: geppui::now(cx),
                });
                self.compositions
                    .import_name
                    .update(cx, |f, cx| f.set_text(&name, cx));
                self.pending_text_focus = Some(self.compositions.import_name.clone());
            }
            Err(e) => self.library_message(e.message(), cx),
        }
        cx.notify();
    }

    fn import_preview_submit(&mut self, save_checkpoint: bool, cx: &mut Context<Self>) {
        let Some(preview) = self.compositions.import.clone() else {
            return;
        };
        let name = self.compositions.import_name.read(cx).text().to_owned();
        // Context first (`startWork` → `allowed()`): nothing is saved when the session moved on.
        if name.trim().is_empty() || self.compositions.working || !self.import_allowed() {
            return;
        }
        if self.portable_stamp(&preview.record) != preview.stamp {
            self.library_message(
                "As dependências mudaram. Atualize a prévia antes de importar.",
                cx,
            );
            return;
        }
        if self.session.draft().organization.compositions.len()
            >= geppio_core::workbench::model::limits::COMPOSITIONS
        {
            self.library_message("Limite de composições salvas atingido.", cx);
            return;
        }
        if self.session.pending_import_checkpoint() {
            if !save_checkpoint {
                self.compositions.confirm = Some(Confirm {
                    title: "Salvar a edição primeiro?".into(),
                    text: "Salve o checkpoint da edição para continuar a importação. Cancelar mantém o rascunho e a prévia abertos.".into(),
                    label: "Salvar edição e continuar".into(),
                    destructive: false,
                    action: ConfirmAction::ImportCheckpoint,
                });
                cx.notify();
                return;
            }
            let surfaces = self.ports.surfaces;
            if self.session.save(&surfaces, &mut self.store).is_err() {
                let message = self.session.message().to_owned();
                self.library_message(&message, cx);
                return;
            }
        }
        if !self.import_allowed() {
            return;
        }
        let record = match import_portable_composition(
            self.session.draft(),
            &preview.recipe,
            name.trim(),
            &new_id("composition:"),
        ) {
            Ok(record) => record,
            Err(e) => {
                self.library_message(e.message(), cx);
                return;
            }
        };
        let label = record.name.clone();
        match self
            .session
            .save_imported_composition(record, &mut self.store)
        {
            Ok(()) => {
                self.compositions.import = None;
                self.compositions.tab = LibraryTab::Saved;
                self.compositions
                    .search
                    .update(cx, |f, cx| f.set_text("", cx));
                self.library_message(&format!("Composição importada: {label}."), cx);
            }
            Err(_) => {
                let message = self.session.message().to_owned();
                self.library_message(&message, cx);
            }
        }
    }

    /// "Exportar composição…" (`exportItem`): the saved record's recipe, the OS save dialog
    /// and a create-only write that is read back.
    fn export_item(&mut self, id: &str, cx: &mut Context<Self>) {
        if self.compositions.working || !self.import_allowed() {
            return;
        }
        let Some(saved) = self.session.saved_composition(id).cloned() else {
            self.library_message("Salve a composição antes de exportá-la.", cx);
            return;
        };
        let content = match export_portable_composition(&saved, self.session.registry()) {
            Ok(recipe) => serialize_portable_layout(&recipe),
            Err(e) => {
                self.library_message(e.message(), cx);
                return;
            }
        };
        self.compositions.working = true;
        let picked = cx.prompt_for_new_path(
            std::path::Path::new(""),
            Some("composicao.geppio-layout.json"),
        );
        cx.spawn(async move |this, cx| {
            let message = match picked.await {
                Ok(Ok(None)) => "Exportação cancelada.",
                Ok(Ok(Some(path))) => {
                    // The session may have moved on while the dialog was open (`checkOwner`).
                    let current = this.update(cx, |this, _| this.import_allowed()).unwrap_or(false);
                    if !current {
                        "A janela mudou durante a operação. Abra o seletor novamente."
                    } else if selected_path(&path) {
                        let outcome = cx
                            .background_executor()
                            .spawn(async move { write_export(&path, &content) })
                            .await;
                        match outcome {
                            ExportOutcome::Written => "Composição exportada.",
                            ExportOutcome::Exists => "Esse arquivo já existe. Escolha um novo nome para a composição.",
                            ExportOutcome::Unconfirmed => "A saída pode estar vazia, parcial ou já gravada. Confira o arquivo antes de exportar novamente.",
                            ExportOutcome::Failed => "Não foi possível criar a composição no destino escolhido.",
                        }
                    } else {
                        "Escolha um nome terminado em .geppio-layout.json."
                    }
                }
                _ => "Não foi possível confirmar a exportação. Confira o destino antes de tentar novamente.",
            };
            let _ = this.update(cx, |this, cx| {
                this.compositions.working = false;
                this.library_message(message, cx);
            });
        })
        .detach();
    }

    // ---- reorder ------------------------------------------------------------------------------

    fn library_reorder_enabled(&self, cx: &Context<Self>) -> bool {
        self.editing() && self.compositions.search.read(cx).text().is_empty()
    }

    fn library_tile_down(
        &mut self,
        id: &str,
        pos: (f32, f32),
        origin: (f32, f32),
        order: Vec<String>,
    ) {
        self.compositions.drag = Some(TileDrag {
            id: id.to_owned(),
            start: pos,
            pos,
            offset: (pos.0 - origin.0, pos.1 - origin.1),
            started: false,
            order,
        });
    }

    /// Geometry of the grid cells (CSS px, window coordinates) for `count` tiles.
    fn grid_cells(&self, count: usize) -> Vec<(f32, f32)> {
        let Some(bounds) = self.compositions.grid.bounds() else {
            return Vec::new();
        };
        let m = self.metrics;
        let (x0, y0, w) = (
            m.css(bounds.origin.x),
            m.css(bounds.origin.y),
            m.css(bounds.size.width),
        );
        let tile = (w - 18.0) / 3.0;
        (0..count)
            .map(|i| {
                let (col, row) = ((i % 3) as f32, (i / 3) as f32);
                (x0 + col * (tile + 9.0), y0 + row * (TILE_HEIGHT + 9.0))
            })
            .collect()
    }

    pub(crate) fn compositions_move(
        &mut self,
        pos: (f32, f32),
        pressed: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mut drag) = self.compositions.drag.clone() else {
            return false;
        };
        // A release outside the window never reached us: end the gesture here.
        if !pressed {
            return self.compositions_up(cx);
        }
        drag.pos = pos;
        if !drag.started {
            if ((pos.0 - drag.start.0).powi(2) + (pos.1 - drag.start.1).powi(2)).sqrt() < 4.0 {
                self.compositions.drag = Some(drag);
                return true;
            }
            drag.started = true;
            self.compositions.hover = None;
        }
        let cells = self.grid_cells(drag.order.len());
        if let Some(bounds) = self.compositions.grid.bounds() {
            let m = self.metrics;
            let tile = (m.css(bounds.size.width) - 18.0) / 3.0;
            let inside = pos.0 >= m.css(bounds.origin.x)
                && pos.0 <= m.css(bounds.origin.x) + m.css(bounds.size.width)
                && pos.1 >= m.css(bounds.origin.y)
                && pos.1 <= m.css(bounds.origin.y) + m.css(bounds.size.height);
            if inside {
                let target = cells
                    .iter()
                    .enumerate()
                    .map(|(i, (x, y))| {
                        let (cx, cy) = (x + tile / 2.0, y + TILE_HEIGHT / 2.0);
                        (i, ((pos.0 - cx).powi(2) + (pos.1 - cy).powi(2)).sqrt())
                    })
                    .min_by(|a, b| a.1.total_cmp(&b.1))
                    .map(|(i, _)| i);
                let current = drag.order.iter().position(|o| *o == drag.id);
                if let (Some(target), Some(current)) = (target, current)
                    && target != current
                {
                    let before: Vec<(String, (f32, f32))> = drag
                        .order
                        .iter()
                        .cloned()
                        .zip(cells.iter().copied())
                        .collect();
                    let id = drag.order.remove(current);
                    drag.order.insert(target, id);
                    self.flip_tiles(&before, &drag.order, &cells, Some(&drag.id), cx);
                }
            }
        }
        self.compositions.drag = Some(drag);
        cx.notify();
        true
    }

    fn flip_tiles(
        &mut self,
        before: &[(String, (f32, f32))],
        order: &[String],
        cells: &[(f32, f32)],
        skip: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        if geppui::appearance(cx).reduced_motion {
            return;
        }
        let now = geppui::now(cx);
        for (i, id) in order.iter().enumerate() {
            if Some(id.as_str()) == skip {
                continue;
            }
            let (Some((_, old)), Some(new)) = (before.iter().find(|(b, _)| b == id), cells.get(i))
            else {
                continue;
            };
            let (dx, dy) = (old.0 - new.0, old.1 - new.1);
            if (dx * dx + dy * dy).sqrt() < 0.5 {
                continue;
            }
            let entry = self
                .compositions
                .flips
                .entry(id.clone())
                .or_insert_with(|| (Transition::new(0.0), Transition::new(0.0)));
            let (x0, y0) = (
                entry.0.value(now) + dx as f64,
                entry.1.value(now) + dy as f64,
            );
            entry.0 = Transition::new(x0);
            entry.1 = Transition::new(y0);
            entry.0.set(now, 0.0, 150.0, geppui::motion::FLIGHT);
            entry.1.set(now, 0.0, 150.0, geppui::motion::FLIGHT);
        }
    }

    pub(crate) fn compositions_up(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(drag) = self.compositions.drag.take() else {
            return false;
        };
        if !drag.started {
            return false;
        }
        let favorites = self.compositions.tab == LibraryTab::Favorites;
        let inside = self.compositions.grid.bounds().is_some_and(|b| {
            let m = self.metrics;
            drag.pos.0 >= m.css(b.origin.x)
                && drag.pos.0 <= m.css(b.origin.x) + m.css(b.size.width)
                && drag.pos.1 >= m.css(b.origin.y)
                && drag.pos.1 <= m.css(b.origin.y) + m.css(b.size.height)
        });
        let now = geppui::now(cx);
        if inside {
            let index = drag.order.iter().position(|o| *o == drag.id).unwrap_or(0);
            let before = drag.order.get(index + 1).map(String::as_str);
            if let Some(next) =
                reorder_composition(self.session.draft(), &drag.id, before, favorites)
            {
                let _ = self.session.edit_action(next);
            }
        }
        if !geppui::appearance(cx).reduced_motion {
            self.compositions.landing = Some(Landing {
                id: drag.id.clone(),
                from: (drag.pos.0 - drag.offset.0, drag.pos.1 - drag.offset.1),
                start: now,
            });
        }
        cx.notify();
        true
    }

    pub(crate) fn compositions_escape(&mut self, cx: &mut Context<Self>) -> bool {
        if self.compositions.drag.take().is_some() {
            cx.notify();
            return true;
        }
        let c = &mut self.compositions;
        if c.options.take().is_some()
            || c.confirm.take().is_some()
            || c.replace.take().is_some()
            || c.mapping.take().is_some()
            || c.form.take().is_some()
            || c.import.take().is_some()
        {
            cx.notify();
            return true;
        }
        false
    }

    /// Keyboard reorder of the focused tile (Alt + arrows; `reorder`).
    fn reorder_by(&mut self, id: &str, offset: i64, cx: &mut Context<Self>) {
        if !self.compositions.search.read(cx).text().is_empty() {
            return;
        }
        let favorites = self.compositions.tab == LibraryTab::Favorites;
        let order = composition_order(self.session.draft(), favorites);
        let Some(index) = order.iter().position(|o| o == id) else {
            return;
        };
        let to = index as i64 + offset;
        if to < 0 || to >= order.len() as i64 {
            return;
        }
        let target = (to + i64::from(offset > 0)) as usize;
        let before = order.get(target).map(String::as_str);
        if let Some(next) = reorder_composition(self.session.draft(), id, before, favorites) {
            let _ = self.session.edit_action(next);
        }
        cx.notify();
    }
}

/// Tile height: 1 + 8 + 46 + 6 + 18 + 8 + 1.
pub const TILE_HEIGHT: f32 = 88.0;

// ---- rendering ------------------------------------------------------------------------------

fn section_label(text: SharedString, m: Metrics, t: Theme, color: gpui::Hsla) -> impl IntoElement {
    let _ = t;
    geppui::spaced_text(text.to_uppercase(), m)
        .size(10.0, 16.0)
        .weight(css_weight(650.0))
        .color(color)
        .letter_spacing_em(0.09)
}

/// `.tool-button` at 36px (`.layout-menu-footer`).
#[allow(clippy::too_many_arguments)]
fn tool_button(
    id: &str,
    glyph: &'static str,
    label: SharedString,
    primary: bool,
    disabled: bool,
    grow: bool,
    m: Metrics,
    t: Theme,
) -> gpui::Stateful<Div> {
    let (bg, fg, border, hover) = if primary {
        (
            t.accent,
            t.primary_foreground,
            t.primary_border,
            t.primary_hover,
        )
    } else {
        (t.surface, t.text, t.input_border, t.control_hover)
    };
    div()
        .id(SharedString::from(id.to_owned()))
        .when(grow, |el| el.flex_1())
        .flex()
        .items_center()
        .justify_center()
        .gap(m.px(6.0))
        .h(m.px(36.0))
        .px(m.px(8.0))
        .rounded(m.px(10.0))
        .border(m.border(1.0))
        .border_color(border)
        .bg(bg)
        .text_color(fg)
        .text_size(m.px(12.0))
        .whitespace_nowrap()
        .when(disabled, |el| el.opacity(0.5))
        .when(!disabled, |el| {
            el.cursor_pointer().hover(move |s| s.bg(hover))
        })
        .child(icon(glyph, m).size(16.0).color(fg))
        .child(label)
}

/// A 24px tile control (`.composition-control`).
#[allow(clippy::too_many_arguments)]
fn tile_control(
    id: SharedString,
    glyph: &'static str,
    pressed: bool,
    boxed: bool,
    rotate: f32,
    filled: bool,
    m: Metrics,
    t: Theme,
) -> gpui::Stateful<Div> {
    let color = if glyph == "pin" || pressed {
        t.accent
    } else {
        t.text_muted
    };
    div()
        .id(id)
        .size(m.px(24.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(m.px(7.0))
        .border(m.border(1.0))
        .border_color(if boxed {
            t.border
        } else {
            gpui::transparent_black()
        })
        .when(boxed, |el| el.bg(t.surface))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .cursor_pointer()
        .hover(move |s| s.bg(t.control_hover).border_color(t.border))
        .child(
            icon(if filled { "star-filled" } else { glyph }, m)
                .size(14.0)
                .color(color)
                .rotate_half_turns(rotate / 180.0),
        )
}

impl Workbench {
    /// The library panel shown under the catalog tabs.
    pub(crate) fn compositions_panel(
        &mut self,
        m: Metrics,
        t: Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let tr = crate::i18n::tr(cx);
        let now = geppui::now(cx);
        let placeholder = tr.t("Buscar composições…");
        self.compositions
            .search
            .update(cx, |f, _| f.set_placeholder(placeholder));
        let search = self.compositions.search.read(cx).text().to_owned();
        let search_focused = self.compositions.search.read(cx).is_focused(window);
        let draft = self.session.draft().clone();
        let all = self.library_entries();
        let tab = self.compositions.tab;
        let favorites_tab = tab == LibraryTab::Favorites;
        let list: Vec<Composition> = if search.is_empty() {
            match self.compositions.drag.as_ref().filter(|d| d.started) {
                Some(drag) => drag
                    .order
                    .iter()
                    .filter_map(|id| all.iter().find(|c| c.id == *id).cloned())
                    .collect(),
                None => ordered(&draft, &all, favorites_tab),
            }
        } else {
            let key = crate::catalog::normalize(&search);
            all.iter()
                .filter(|c| crate::catalog::normalize(&display_name(c, tr)).contains(key.trim()))
                .cloned()
                .collect()
        };
        let org = draft.organization.clone();
        let format_id = self.session.format_id().map(str::to_owned);
        let reorder = self.library_reorder_enabled(cx);
        let can_import = self.session.can_import_composition();
        let working = self.compositions.working;
        let full = org.compositions.len() >= geppio_core::workbench::model::limits::COMPOSITIONS;
        let pending = self.session.has_pending();
        self.compositions
            .flips
            .retain(|_, (x, y)| x.animating(now) || y.animating(now));
        if self
            .compositions
            .landing
            .as_ref()
            .is_some_and(|l| now - l.start >= 150.0)
        {
            self.compositions.landing = None;
        }
        let dragging = self
            .compositions
            .drag
            .as_ref()
            .filter(|d| d.started)
            .map(|d| d.id.clone());
        let landing = self.compositions.landing.as_ref().map(|l| l.id.clone());
        let hover = self.compositions.hover.clone();
        let order_ids: Vec<String> = list.iter().map(|c| c.id.clone()).collect();
        let tiles: Vec<AnyElement> = list
            .iter()
            .map(|item| {
                let id = item.id.clone();
                let name = display_name(item, tr);
                let reason = self.portable_reason(item);
                let is_default = org.default_composition.as_deref() == Some(id.as_str());
                let is_favorite = org.favorites.contains(&id);
                let editing_this = format_id.as_deref() == Some(id.as_str());
                let (hovered, since) = match &hover {
                    Some((h, at, entered)) if *h == id => (*entered, now - at),
                    _ => (false, f64::INFINITY),
                };
                let ease = |x: f64| geppui::motion::EASE.ease(x.clamp(0.0, 1.0)) as f32;
                // Name out (80ms) then actions in (90ms after 110ms) on hover; the reverse on leave.
                let (name_opacity, actions_opacity, controls_opacity) = if hovered {
                    (
                        1.0 - ease(since / 80.0),
                        ease((since - 110.0) / 90.0),
                        ease(since / 140.0),
                    )
                } else if since.is_finite() {
                    (
                        ease((since - 110.0) / 90.0),
                        1.0 - ease(since / 80.0),
                        1.0 - ease(since / 140.0),
                    )
                } else {
                    (1.0, 0.0, 0.0)
                };
                let actions_live = actions_opacity > 0.5;
                let flip = self
                    .compositions
                    .flips
                    .get_mut(&id)
                    .map(|(x, y)| (x.sample(now) as f32, y.sample(now) as f32))
                    .unwrap_or((0.0, 0.0));
                let ghost = dragging.as_deref() == Some(id.as_str())
                    || landing.as_deref() == Some(id.as_str());
                let thumb_w = {
                    let grid = self
                        .compositions
                        .grid
                        .bounds()
                        .map_or(435.0, |b| m.css(b.size.width));
                    (grid - 18.0) / 3.0 - 16.0
                };
                let format_id_a = id.clone();
                let widgets_id = id.clone();
                let tile_id = id.clone();
                let tile_id2 = id.clone();
                let hover_id = id.clone();
                let star_item = item.clone();
                let pin_id = id.clone();
                let options_id = id.clone();
                let key_id = id.clone();
                let order_for_drag = order_ids.clone();
                let anchor = self
                    .compositions
                    .anchors
                    .entry(id.clone())
                    .or_default()
                    .clone();
                let anchor_for_options = anchor.clone();
                // Focusable like the reference's tile button: Enter applies the format and
                // Alt+arrows reorder.
                let focus = geppui::button::focus_handle(
                    &SharedString::from(format!("composition-tile-{id}")),
                    None,
                    window,
                    cx,
                );
                let saved_panel = !favorites_tab;
                let pin_opacity = if is_default { 1.0 } else { controls_opacity };
                let star_opacity = if saved_panel && is_favorite {
                    1.0
                } else {
                    controls_opacity
                };
                div()
                    .id(SharedString::from(format!("composition-card-{id}")))
                    .relative()
                    .min_w_0()
                    .flex_1()
                    .left(m.px(flip.0))
                    .top(m.px(flip.1))
                    .when(ghost, |el| el.opacity(0.25))
                    .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                        if this.compositions.drag.as_ref().is_some_and(|d| d.started) {
                            return;
                        }
                        let now = geppui::now(cx);
                        let same = this
                            .compositions
                            .hover
                            .as_ref()
                            .is_some_and(|(h, _, e)| *h == hover_id && e == hovered);
                        if !same
                            && (*hovered
                                || this
                                    .compositions
                                    .hover
                                    .as_ref()
                                    .is_some_and(|(h, _, _)| *h == hover_id))
                        {
                            this.compositions.hover = Some((hover_id.clone(), now, *hovered));
                        }
                        cx.notify();
                    }))
                    .child(anchor_probe(&anchor))
                    .child(
                        div()
                            .id(SharedString::from(format!("composition-tile-{tile_id}")))
                            .w_full()
                            .flex()
                            .flex_col()
                            .items_center()
                            .px(m.px(7.0))
                            .py(m.px(8.0))
                            .rounded(m.px(9.0))
                            .border(m.border(1.0))
                            .border_color(if editing_this {
                                t.accent
                            } else if item.system && editing_this {
                                t.accent_border
                            } else {
                                t.border
                            })
                            .when(editing_this, |el| el.bg(t.accent_soft))
                            .when(!editing_this, |el| el.hover(move |s| s.bg(t.control_hover)))
                            .text_size(m.px(11.0))
                            .line_height(m.px(18.0))
                            .track_focus(&focus)
                            .focus_visible(move |s| {
                                s.shadow(vec![
                                    gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), t.accent)
                                        .spread_radius(m.px(2.0)),
                                ])
                            })
                            .when(reorder, |el| el.cursor_grab())
                            .when(!reorder, |el| el.cursor_pointer())
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, e: &MouseDownEvent, _, cx| {
                                    if !this.library_reorder_enabled(cx) {
                                        return;
                                    }
                                    let m = this.metrics;
                                    let pos = (m.css(e.position.x), m.css(e.position.y));
                                    let origin = this
                                        .compositions
                                        .anchors
                                        .get(&tile_id2)
                                        .and_then(AnchorHandle::bounds)
                                        .map_or(pos, |b| (m.css(b.origin.x), m.css(b.origin.y)));
                                    this.library_tile_down(
                                        &tile_id2,
                                        pos,
                                        origin,
                                        order_for_drag.clone(),
                                    );
                                }),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if this
                                    .compositions
                                    .landing
                                    .as_ref()
                                    .is_some_and(|l| l.id == tile_id)
                                {
                                    return;
                                }
                                this.apply_library(&tile_id, ApplyMode::Format, cx)
                            }))
                            .on_key_down(cx.listener(move |this, e: &gpui::KeyDownEvent, _, cx| {
                                let k = &e.keystroke;
                                if !k.modifiers.alt {
                                    return;
                                }
                                let offset = match k.key.as_str() {
                                    "left" => -1,
                                    "right" => 1,
                                    "up" => -3,
                                    "down" => 3,
                                    _ => return,
                                };
                                this.reorder_by(&key_id, offset, cx);
                                cx.stop_propagation();
                            }))
                            .child(thumbnail(item, thumb_w.max(10.0), 46.0, m, t))
                            .child(
                                div()
                                    .mt(m.px(6.0))
                                    .w_full()
                                    .text_center()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .opacity(name_opacity)
                                    .child(name.clone()),
                            ),
                    )
                    // "Formato" / "Widgets".
                    .child(
                        div()
                            .absolute()
                            .left(m.px(6.0))
                            .right(m.px(6.0))
                            .bottom(m.px(6.0))
                            .flex()
                            .gap(m.px(3.0))
                            .opacity(actions_opacity)
                            .when(!actions_live, |el| el.invisible())
                            .child(
                                restore_button(
                                    SharedString::from(format!("composition-format-{format_id_a}")),
                                    tr.t("Formato"),
                                    false,
                                    m,
                                    t,
                                )
                                .on_click(cx.listener(
                                    move |this, _, _, cx| {
                                        this.apply_library(&format_id_a, ApplyMode::Format, cx)
                                    },
                                )),
                            )
                            .when(item.mode == CompositionMode::FormatWidgets, |el| {
                                let disabled = reason.is_some();
                                el.child(
                                    restore_button(
                                        SharedString::from(format!(
                                            "composition-widgets-{widgets_id}"
                                        )),
                                        tr.t("Widgets"),
                                        disabled,
                                        m,
                                        t,
                                    )
                                    .when(!disabled, |b| {
                                        b.on_click(cx.listener(move |this, _, _, cx| {
                                            this.apply_library(&widgets_id, ApplyMode::Widgets, cx)
                                        }))
                                    }),
                                )
                            }),
                    )
                    .when_some(reason.clone(), |el, reason| {
                        el.child(
                            div()
                                .px(m.px(5.0))
                                .pt(m.px(3.0))
                                .pb(m.px(29.0))
                                .text_size(m.px(11.0))
                                .text_color(t.text_muted)
                                .child(reason),
                        )
                    })
                    // Default pin and favorite star; hidden controls keep their place and an
                    // unpressed pin follows the star (`order: 2`).
                    .child({
                        let pin = div()
                            .opacity(pin_opacity)
                            .when(pin_opacity < 0.01, |el| el.invisible())
                            .child(
                                tile_control(
                                    SharedString::from(format!("composition-pin-{pin_id}")),
                                    "pin",
                                    is_default,
                                    saved_panel || controls_opacity > 0.5,
                                    45.0,
                                    false,
                                    m,
                                    t,
                                )
                                .on_click(cx.listener(
                                    move |this, _, _, cx| this.favorite(&pin_id, true, None, cx),
                                )),
                            );
                        let star = div()
                            .opacity(star_opacity)
                            .when(star_opacity < 0.01, |el| el.invisible())
                            .child(
                                tile_control(
                                    SharedString::from(format!(
                                        "composition-star-{}",
                                        star_item.id
                                    )),
                                    "star",
                                    is_favorite,
                                    true,
                                    0.0,
                                    is_favorite,
                                    m,
                                    t,
                                )
                                .on_click(cx.listener(
                                    move |this, _, _, cx| {
                                        let tr = crate::i18n::tr(cx);
                                        this.toggle_favorite(&star_item, tr, cx)
                                    },
                                )),
                            );
                        let markers = div()
                            .absolute()
                            .top(m.px(5.0))
                            .left(m.px(5.0))
                            .flex()
                            .gap(m.px(2.0));
                        if is_default {
                            markers.child(pin).child(star)
                        } else {
                            markers.child(star).child(pin)
                        }
                    })
                    // Options.
                    .when(
                        controls_opacity > 0.01
                            || self
                                .compositions
                                .options
                                .as_ref()
                                .is_some_and(|(o, _)| *o == id),
                        |el| {
                            el.child(
                                div()
                                    .absolute()
                                    .top(m.px(5.0))
                                    .right(m.px(5.0))
                                    .opacity(
                                        controls_opacity.max(
                                            if self
                                                .compositions
                                                .options
                                                .as_ref()
                                                .is_some_and(|(o, _)| *o == id)
                                            {
                                                1.0
                                            } else {
                                                0.0
                                            },
                                        ),
                                    )
                                    .child(
                                        tile_control(
                                            SharedString::from(format!(
                                                "composition-options-{options_id}"
                                            )),
                                            "ellipsis-horizontal",
                                            false,
                                            true,
                                            90.0,
                                            false,
                                            m,
                                            t,
                                        )
                                        .on_click(
                                            cx.listener(move |this, _, _, cx| {
                                                let m = this.metrics;
                                                let open = this
                                                    .compositions
                                                    .options
                                                    .as_ref()
                                                    .is_some_and(|(o, _)| *o == options_id);
                                                this.compositions.options = if open {
                                                    None
                                                } else {
                                                    anchor_for_options.bounds().map(|b| {
                                                        let right = m.css(b.origin.x)
                                                            + m.css(b.size.width)
                                                            - 5.0;
                                                        let bottom = m.css(b.origin.y) + 5.0 + 24.0;
                                                        (
                                                            options_id.clone(),
                                                            gpui::point(
                                                                m.px(right - 220.0),
                                                                m.px(bottom + 5.0),
                                                            ),
                                                        )
                                                    })
                                                };
                                                cx.notify();
                                            }),
                                        ),
                                    ),
                            )
                        },
                    )
                    .into_any_element()
            })
            .collect();
        let empty = tiles.is_empty();
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut tiles = tiles.into_iter().peekable();
        while tiles.peek().is_some() {
            let row: Vec<AnyElement> = tiles.by_ref().take(3).collect();
            let pad = 3 - row.len();
            rows.push(
                div()
                    .flex()
                    .gap(m.px(9.0))
                    .children(row)
                    .children((0..pad).map(|_| div().flex_1().min_w_0()))
                    .into_any_element(),
            );
        }
        let tab_button = |value: LibraryTab, label: &str| {
            let selected = tab == value;
            div()
                .id(SharedString::from(format!("layout-menu-tab-{value:?}")))
                .flex_1()
                .min_w_0()
                .min_h(m.px(38.0))
                .flex()
                .items_center()
                .justify_center()
                .px(m.px(4.0))
                .py(m.px(9.0))
                .rounded_t(m.px(6.0))
                .border_b(m.border(2.0))
                .border_color(if selected {
                    t.accent
                } else {
                    gpui::transparent_black()
                })
                .when(!selected, |el| el.hover(move |s| s.bg(t.control_hover)))
                .cursor_pointer()
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.compositions.tab = value;
                    this.compositions.drag = None;
                    cx.notify();
                }))
                .child(section_label(
                    tr.t(label),
                    m,
                    t,
                    if selected { t.accent } else { t.text_muted },
                ))
        };
        let search_field = self.compositions.search.clone();
        let search_field2 = self.compositions.search.clone();
        div()
            .id("layout-menu")
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .items_center()
                    .p(m.px(11.0))
                    .mb(m.px(11.0))
                    .border_b(m.border(1.0))
                    .border_color(t.border)
                    .child(
                        div()
                            .id("composition-search")
                            .flex_1()
                            .cursor_text()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.pending_text_focus = Some(search_field2.clone());
                                cx.notify();
                            }))
                            .child(crate::panels::search_box(&search_field, search_focused, m, t)),
                    ),
            )
            .when(search.is_empty(), |el| {
                el.child(
                    div()
                        .flex()
                        .gap(m.px(4.0))
                        .mx(m.px(22.0))
                        .mb(m.px(9.0))
                        .border_b(m.border(1.0))
                        .border_color(t.border)
                        .child(tab_button(LibraryTab::Favorites, "Composições Favoritas"))
                        .child(tab_button(LibraryTab::Saved, "Composições Salvas")),
                )
            })
            .child(
                div()
                    .id("layout-menu-content")
                    .flex_1()
                    .min_h_0()
                    .mx(m.px(11.0))
                    .px(m.px(11.0))
                    .overflow_y_scroll()
                    .track_scroll(&self.compositions.scroll)
                    .child(
                        div()
                            .relative()
                            .flex()
                            .flex_col()
                            .gap(m.px(9.0))
                            .child(anchor_probe(&self.compositions.grid))
                            .children(rows)
                            .when(empty, |el| {
                                el.child(
                                    div()
                                        .text_size(m.px(12.0))
                                        .line_height(m.px(18.0))
                                        .text_color(t.text_muted)
                                        .child(tr.t(if search.is_empty() {
                                            "Adicione composições aos favoritos pela aba Composições Salvas."
                                        } else {
                                            "Nenhuma composição encontrada."
                                        })),
                                )
                            }),
                    ),
            )
            .child(
                div().mx(m.px(22.0)).mt(m.px(9.0)).flex().child(
                    text_action("composition-import", tr.t("Importar composição…"))
                        .disabled(!can_import || working || full)
                        .on_click(cx.listener(|this, _, _, cx| this.select_import(cx))),
                ),
            )
            .when(pending, |el| {
                el.child(
                    div()
                        .mx(m.px(22.0))
                        .mt(m.px(9.0))
                        .text_size(m.px(11.0))
                        .line_height(m.px(16.0))
                        .text_color(t.text_muted)
                        .child(tr.t("Há alterações pendentes. Salvar atual vai pedir para salvar a edição primeiro.")),
                )
            })
            .child(
                div()
                    .mx(m.px(22.0))
                    .mb(m.px(11.0))
                    .mt(m.px(9.0))
                    .pt(m.px(9.0))
                    .border_t(m.border(1.0))
                    .border_color(t.border)
                    .flex()
                    .items_center()
                    .gap(m.px(11.0))
                    .child(
                        tool_button("composition-restore-default", "arrow-path", tr.t("Restaurar layout padrão"), false, false, true, m, t)
                            .on_click(cx.listener(|this, _, _, cx| this.restore_default(cx))),
                    )
                    .child(
                        tool_button("composition-save-current", "plus", tr.t("Salvar atual"), true, full, false, m, t)
                            .when(!full, |el| {
                                el.on_click(cx.listener(|this, _, _, cx| {
                                    let tr = crate::i18n::tr(cx);
                                    this.save_current(tr, cx)
                                }))
                            }),
                    ),
            )
            .into_any_element()
    }

    /// Dialogs, the options menu and the dragged card, above everything else.
    pub(crate) fn composition_overlays(
        &mut self,
        m: Metrics,
        t: Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let tr = crate::i18n::tr(cx);
        let now = geppui::now(cx);
        let mut out = Vec::new();
        let all = self.library_entries();
        let draft = self.session.draft().clone();
        let org = draft.organization.clone();
        // The card following the pointer, or flying to its cell.
        let follow = self
            .compositions
            .drag
            .as_ref()
            .filter(|d| d.started)
            .map(|d| {
                (
                    d.id.clone(),
                    (d.pos.0 - d.offset.0, d.pos.1 - d.offset.1),
                    1.0f32,
                )
            });
        let landing = self.compositions.landing.clone().and_then(|l| {
            let order = composition_order(&draft, self.compositions.tab == LibraryTab::Favorites);
            let index = order.iter().position(|o| *o == l.id)?;
            let cell = *self.grid_cells(order.len()).get(index)?;
            let p = geppui::motion::FLIGHT.ease(((now - l.start) / 150.0).clamp(0.0, 1.0)) as f32;
            Some((
                l.id.clone(),
                (
                    l.from.0 + (cell.0 - l.from.0) * p,
                    l.from.1 + (cell.1 - l.from.1) * p,
                ),
                1.0,
            ))
        });
        if let Some((id, (x, y), _)) = follow.or(landing)
            && let Some(item) = all.iter().find(|c| c.id == id)
        {
            let width = self
                .compositions
                .grid
                .bounds()
                .map_or(139.0, |b| (m.css(b.size.width) - 18.0) / 3.0);
            out.push(
                gpui::deferred(
                    div()
                        .absolute()
                        .left(m.px(x))
                        .top(m.px(y))
                        .w(m.px(width))
                        .flex()
                        .flex_col()
                        .items_center()
                        .px(m.px(7.0))
                        .py(m.px(8.0))
                        .rounded(m.px(9.0))
                        .border(m.border(1.0))
                        .border_color(t.accent_border)
                        .bg(t.surface)
                        .shadow(vec![
                            gpui::BoxShadow::new(
                                m.px(0.0),
                                m.px(8.0),
                                gpui::hsla(0.0, 0.0, 0.0, 0.4),
                            )
                            .blur_radius(m.px(22.0))
                            .spread_radius(m.px(-8.0)),
                        ])
                        .text_size(m.px(11.0))
                        .line_height(m.px(18.0))
                        .child(thumbnail(item, width - 16.0, 46.0, m, t))
                        .child(
                            div()
                                .mt(m.px(6.0))
                                .w_full()
                                .text_center()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .child(display_name(item, tr)),
                        ),
                )
                .with_priority(3)
                .into_any_element(),
            );
        }
        if let Some((id, at)) = self.compositions.options.clone()
            && let Some(item) = all.iter().find(|c| c.id == id).cloned()
        {
            let close = cx.listener(|this, _: &(), _, cx| {
                this.compositions.options = None;
                cx.notify();
            });
            let close = std::rc::Rc::new(close);
            let (c1, c2) = (close.clone(), close.clone());
            let is_default = org.default_composition.as_deref() == Some(id.as_str());
            let is_favorite = org.favorites.contains(&id);
            let can_export = self.session.can_import_composition() && !self.compositions.working;
            let mut items: Vec<SharedString> = Vec::new();
            if !item.system {
                items.push("composition-option-export".into());
            }
            items.push("composition-option-default".into());
            items.push("composition-option-favorite".into());
            if !item.system {
                items.push("composition-option-delete".into());
            }
            let (export_id, default_id, delete_item) = (id.clone(), id.clone(), item.clone());
            let favorite_item = item.clone();
            out.push(
                popover("composition-options", &AnchorHandle::default())
                    .placement(Placement::At(at))
                    .width(190.0)
                    .padding(5.0, 5.0)
                    .menu(items)
                    .on_dismiss(move |w, cx| c1(&(), w, cx))
                    .on_escape(move |w, cx| c2(&(), w, cx))
                    .when(!item.system, |el| {
                        el.child(
                            menu_item("composition-option-export", tr.t("Exportar composição…"))
                                .compact()
                                .disabled(!can_export)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.compositions.options = None;
                                    this.export_item(&export_id, cx)
                                })),
                        )
                    })
                    .child(
                        menu_item("composition-option-default", tr.t(if is_default { "Remover como padrão" } else { "Tornar padrão" }))
                            .compact()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.compositions.options = None;
                                this.favorite(&default_id, true, None, cx)
                            })),
                    )
                    .child(
                        menu_item("composition-option-favorite", tr.t(if is_favorite { "Remover dos favoritos" } else { "Adicionar aos favoritos" }))
                            .compact()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.compositions.options = None;
                                let tr = crate::i18n::tr(cx);
                                this.toggle_favorite(&favorite_item, tr, cx)
                            })),
                    )
                    .when(!item.system, |el| {
                        el.child(
                            menu_item("composition-option-delete", tr.t("Excluir composição"))
                                .compact()
                                .destructive()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.compositions.options = None;
                                    let tr = crate::i18n::tr(cx);
                                    this.compositions.confirm = Some(Confirm {
                                        title: tr.f("Excluir {0}?", &[&delete_item.name]),
                                        text: tr.t("A composição será excluída das salvas e dos favoritos. Os widgets e o espaço de trabalho atual serão preservados."),
                                        label: tr.t("Excluir composição"),
                                        destructive: true,
                                        action: ConfirmAction::Delete(delete_item.id.clone()),
                                    });
                                    cx.notify();
                                })),
                        )
                    })
                    .into_any_element(),
            );
        }
        if self.compositions.form.is_some() {
            out.push(self.save_dialog(m, t, tr, window, cx));
        }
        if let Some(replace) = self.compositions.replace.clone() {
            out.push(self.replace_dialog(&replace, &all, m, t, tr, cx));
        }
        if self.compositions.import.is_some() {
            out.push(self.import_dialog(m, t, tr, window, cx));
        }
        if let Some(mapping) = self.compositions.mapping.clone() {
            out.push(self.mapping_dialog(&mapping, m, t, tr, cx));
        }
        if let Some(confirm) = self.compositions.confirm.clone() {
            out.push(
                dialog("composition-confirm", confirm.title.clone())
                    .close_label(tr.t("Fechar"))
                    .on_dismiss({
                        let view = cx.entity().downgrade();
                        move |_, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.compositions.confirm = None;
                                cx.notify();
                            });
                        }
                    })
                    .child(
                        div()
                            .mt(m.px(9.0))
                            .text_color(t.text_muted)
                            .line_height(m.px(13.0 * 1.6))
                            .child(confirm.text.clone()),
                    )
                    .child(
                        div()
                            .mt(m.px(22.0))
                            .flex()
                            .justify_end()
                            .gap(m.px(9.0))
                            .child(
                                dialog_button(
                                    "composition-confirm-cancel",
                                    tr.t("Cancelar"),
                                    DialogButtonKind::Secondary,
                                )
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.compositions.confirm = None;
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                dialog_button(
                                    "composition-confirm-run",
                                    confirm.label.clone(),
                                    if confirm.destructive {
                                        DialogButtonKind::Destructive
                                    } else {
                                        DialogButtonKind::Primary
                                    },
                                )
                                .on_click(cx.listener(|this, _, _, cx| this.run_confirm(cx))),
                            ),
                    )
                    .into_any_element(),
            );
        }
        out
    }

    fn save_dialog(
        &mut self,
        m: Metrics,
        t: Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let form = self.compositions.form.clone().expect("form open");
        let focused = self.compositions.name_field.read(cx).is_focused(window);
        let (view, _) = self.session.view(&self.ports.surfaces);
        let preview = capture_current_composition(
            &view,
            "preview",
            "preview",
            &form.scopes,
            form.side_width,
            self.session.slots(),
        );
        let disabled = form.scopes.is_empty() && !form.side_width;
        let message = tr.t(&self.latest_message());
        let choice =
            |id: &'static str, label: &str, checked: bool, toggle: Box<dyn Fn(&mut SaveForm)>| {
                let toggle = std::rc::Rc::new(toggle);
                let (t1, t2) = (toggle.clone(), toggle);
                div()
                    .id(id)
                    .flex()
                    .items_center()
                    .gap(m.px(11.0))
                    .min_h(m.px(36.0))
                    .px(m.px(8.0))
                    .py(m.px(6.0))
                    .rounded(m.px(7.0))
                    .cursor_pointer()
                    .hover(move |s| s.bg(t.control_hover))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(form) = this.compositions.form.as_mut() {
                            t1(form);
                        }
                        cx.notify();
                    }))
                    .child(
                        checkbox(SharedString::from(format!("{id}-check")), checked).on_toggle(
                            cx.listener(move |this, _: &bool, _, cx| {
                                if let Some(form) = this.compositions.form.as_mut() {
                                    t2(form);
                                }
                                cx.notify();
                            }),
                        ),
                    )
                    .child(tr.t(label))
            };
        let toggle_region = |region: Region| -> Box<dyn Fn(&mut SaveForm)> {
            Box::new(move |form: &mut SaveForm| {
                if let Some(i) = form.scopes.iter().position(|r| *r == region) {
                    form.scopes.remove(i);
                } else {
                    form.scopes.push(region);
                }
            })
        };
        dialog("composition-save", tr.t("Salvar nova composição"))
            .close_label(tr.t("Fechar"))
            .on_dismiss({
                let view = cx.entity().downgrade();
                move |_, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.compositions.form = None;
                        cx.notify();
                    });
                }
            })
            .child(div().mt(m.px(9.0)).text_color(t.text_muted).child(tr.t("Guarde o formato e os widgets das áreas selecionadas.")))
            .child(
                div()
                    .mt(m.px(18.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(18.0))
                    .child(
                        div().flex().justify_center().child(
                            div().w(m.px(128.0)).p(m.px(6.0)).rounded(m.px(9.0)).border(m.border(1.0)).border_color(t.border).child(thumbnail(&preview, 114.0, 57.0, m, t)),
                        ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(m.px(9.0))
                            .child(div().font_weight(css_weight(600.0)).child(tr.t("Nome")))
                            .child(text_input(&self.compositions.name_field, focused, m, t)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(div().mb(m.px(9.0)).font_weight(css_weight(600.0)).child(tr.t("Áreas incluídas")))
                            .child(choice("composition-scope-main", "Área principal", form.scopes.contains(&Region::Main), toggle_region(Region::Main)))
                            .child(choice("composition-scope-bottom", "Barra inferior", form.scopes.contains(&Region::Bottom), toggle_region(Region::Bottom)))
                            .child(choice("composition-scope-side", "Largura da barra lateral", form.side_width, Box::new(|form: &mut SaveForm| form.side_width = !form.side_width))),
                    )
                    .child(div().text_size(m.px(12.0)).line_height(m.px(18.0)).text_color(t.text_muted).child(tr.t("Inclua as áreas desejadas, mesmo recolhidas. A lateral salva apenas a largura, sem suas barras ou widgets. Áreas não selecionadas permanecem como estão.")))
                    .child(div().child(message))
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .items_center()
                            .gap(m.px(11.0))
                            .pt(m.px(9.0))
                            .border_t(m.border(1.0))
                            .border_color(t.border)
                            .child(geppui::button("composition-save-cancel").label(tr.t("Cancelar")).on_click(cx.listener(|this, _, _, cx| {
                                this.compositions.form = None;
                                cx.notify();
                            })))
                            .child(
                                geppui::button("composition-save-submit")
                                    .label(tr.t("Salvar composição"))
                                    .accent()
                                    .disabled(disabled)
                                    .on_click(cx.listener(|this, _, _, cx| this.submit_save(cx))),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn replace_dialog(
        &mut self,
        replace: &Replace,
        all: &[Composition],
        m: Metrics,
        t: Theme,
        tr: Tr,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let org = self.session.draft().organization.clone();
        let name = all
            .iter()
            .find(|c| c.id == replace.id)
            .map(|c| display_name(c, tr))
            .unwrap_or_default();
        let selected_default =
            replace.selected.is_some() && replace.selected == org.default_composition;
        let cards: Vec<AnyElement> = org
            .favorites
            .iter()
            .filter_map(|id| all.iter().find(|c| c.id == *id))
            .map(|item| {
                let pressed = replace.selected.as_deref() == Some(item.id.as_str());
                let id = item.id.clone();
                let pin = org.default_composition.as_deref() == Some(item.id.as_str());
                div()
                    .id(SharedString::from(format!("composition-replace-{id}")))
                    .relative()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .items_center()
                    .px(m.px(7.0))
                    .py(m.px(8.0))
                    .rounded(m.px(9.0))
                    .border(m.border(1.0))
                    .border_color(if pressed { t.accent_border } else { t.border })
                    .when(pressed, |el| el.bg(t.accent_soft))
                    .when(!pressed, |el| el.hover(move |s| s.bg(t.control_hover)))
                    .cursor_pointer()
                    .text_size(m.px(11.0))
                    .line_height(m.px(18.0))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(r) = this.compositions.replace.as_mut() {
                            r.selected = Some(id.clone());
                        }
                        cx.notify();
                    }))
                    .child(thumbnail(item, 96.0, 46.0, m, t))
                    .child(
                        div()
                            .mt(m.px(6.0))
                            .w_full()
                            .text_center()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .font_weight(css_weight(700.0))
                            .child(display_name(item, tr)),
                    )
                    .when(pin, |el| {
                        el.child(
                            div().absolute().top(m.px(10.0)).left(m.px(10.0)).child(
                                icon("pin", m)
                                    .size(14.0)
                                    .color(t.accent)
                                    .rotate_half_turns(0.25),
                            ),
                        )
                    })
                    .into_any_element()
            })
            .collect();
        let mut rows = Vec::new();
        let mut cards = cards.into_iter().peekable();
        while cards.peek().is_some() {
            let row: Vec<AnyElement> = cards.by_ref().take(3).collect();
            let pad = 3 - row.len();
            rows.push(
                div()
                    .flex()
                    .gap(m.px(9.0))
                    .children(row)
                    .children((0..pad).map(|_| div().flex_1()))
                    .into_any_element(),
            );
        }
        let make_default = replace.make_default;
        let label = if make_default {
            "Substituir e tornar padrão"
        } else if selected_default {
            "Desmarcar e substituir"
        } else {
            "Substituir favorito"
        };
        dialog("composition-favorite-dialog", tr.t("Favoritos cheios"))
            .close_label(tr.t("Fechar"))
            .on_dismiss({
                let view = cx.entity().downgrade();
                move |_, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.compositions.replace = None;
                        cx.notify();
                    });
                }
            })
            .child(div().mt(m.px(9.0)).text_color(t.text_muted).line_height(m.px(13.0 * 1.6)).child(tr.f(
                if make_default { "Para tornar “{0}” padrão, ela também precisa ser favorita. Você já tem 9 favoritas. Escolha qual substituir." } else { "Você já tem 9 composições favoritas. Escolha qual substituir por “{0}”." },
                &[&name],
            )))
            .child(div().mt(m.px(18.0)).mb(m.px(9.0)).flex().flex_col().gap(m.px(9.0)).children(rows))
            .child(div().text_size(m.px(12.0)).text_color(t.text_muted).child(tr.t("A composição substituída continuará em Composições Salvas.")))
            .when(selected_default, |el| {
                el.child(
                    div()
                        .mt(m.px(9.0))
                        .px(m.px(11.0))
                        .py(m.px(9.0))
                        .rounded(m.px(9.0))
                        .border(m.border(1.0))
                        .border_color(t.accent_border)
                        .bg(t.accent_soft)
                        .line_height(m.px(13.0 * 1.5))
                        .child(tr.t(if make_default { "A composição selecionada deixará de ser favorita. A nova composição será o padrão." } else { "A composição selecionada deixará de ser padrão e favorita." })),
                )
            })
            .child(
                div()
                    .mt(m.px(22.0))
                    .flex()
                    .justify_end()
                    .gap(m.px(9.0))
                    .child(dialog_button("composition-replace-cancel", tr.t("Cancelar"), DialogButtonKind::Secondary).on_click(cx.listener(|this, _, _, cx| {
                        this.compositions.replace = None;
                        cx.notify();
                    })))
                    .child(
                        dialog_button("composition-replace-run", tr.t(label), DialogButtonKind::Primary)
                            .disabled(replace.selected.is_none())
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(r) = this.compositions.replace.take()
                                    && let Some(selected) = r.selected
                                {
                                    this.favorite(&r.id, r.make_default, Some(&selected), cx);
                                }
                                cx.notify();
                            })),
                    ),
            )
            .into_any_element()
    }

    fn import_dialog(
        &mut self,
        m: Metrics,
        t: Theme,
        tr: Tr,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let preview = self.compositions.import.clone().expect("import open");
        let focused = self.compositions.import_name.read(cx).is_focused(window);
        let name_empty = self
            .compositions
            .import_name
            .read(cx)
            .text()
            .trim()
            .is_empty();
        let stale = self.portable_stamp(&preview.record) != preview.stamp;
        let full = self.session.draft().organization.compositions.len()
            >= geppio_core::workbench::model::limits::COMPOSITIONS;
        let deps = portable_dependencies(
            self.session.draft(),
            self.session.registry(),
            &preview.record,
            &[],
        );
        let record = &preview.record;
        let region_name = |r: Region| {
            if r == Region::Main {
                "Área principal"
            } else {
                "Barra inferior"
            }
        };
        let status: SharedString = if stale {
            "As dependências mudaram. Atualize a prévia.".into()
        } else if full {
            "Limite de composições salvas atingido.".into()
        } else {
            let latest = self
                .edit
                .toast
                .as_ref()
                .filter(|(_, at)| *at >= preview.opened_at)
                .map(|(m, _)| m.clone())
                .unwrap_or_default();
            tr.t(&latest)
        };
        let working = self.compositions.working;
        let js = |v: f64| geppio_core::json::js_number(v);
        dialog("composition-import", "Importar composição")
            .close_label(tr.t("Fechar"))
            .on_dismiss({
                let view = cx.entity().downgrade();
                move |_, cx| {
                    let _ = view.update(cx, |this, cx| {
                        if !this.compositions.working {
                            this.compositions.import = None;
                        }
                        cx.notify();
                    });
                }
            })
            .child(
                div()
                    .mt(m.px(18.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(18.0))
                    .child(div().flex().justify_center().child(div().w(m.px(128.0)).p(m.px(6.0)).rounded(m.px(9.0)).border(m.border(1.0)).border_color(t.border).child(thumbnail(record, 114.0, 57.0, m, t))))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(m.px(9.0))
                            .child(div().font_weight(css_weight(600.0)).child("Nome da composição"))
                            .child(text_input(&self.compositions.import_name, focused, m, t)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(m.px(4.0))
                            .children(record.scopes.iter().map(|r| {
                                let size = record.reference.get(*r);
                                div().child(format!("• {} · {} × {} px", region_name(*r), js(size.width), js(size.height)))
                            }))
                            .when_some(record.chrome.and_then(|c| c.sidebar).and_then(|e| e.size), |el, size| {
                                el.child(div().child(format!("• Largura da barra lateral · {} px", js(size))))
                            }),
                    )
                    .child(div().child(format!("Espaços: {}. Grupos: {}.", record.format.len(), preview.recipe.groups.len())))
                    .when(!preview.recipe.views.is_empty(), |el| {
                        el.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(m.px(4.0))
                                .child(div().font_weight(css_weight(700.0)).child("Widgets necessários"))
                                .children(deps.iter().map(|d| {
                                    let reason = d.reason.map_or_else(|| format!("{} apresentação(ões) local(is)", d.candidates.len()), str::to_owned);
                                    div().child(format!("• {} — {}", d.label, reason))
                                })),
                        )
                    })
                    .child(div().text_size(m.px(12.0)).text_color(t.text_muted).child("A importação adiciona uma cópia à biblioteca. Use Formato ou Widgets para aplicá-la depois."))
                    .when(stale, |el| {
                        el.child(geppui::button("composition-import-refresh").label("Atualizar prévia").on_click(cx.listener(|this, _, _, cx| {
                            let stamp = this.compositions.import.as_ref().map(|p| this.portable_stamp(&p.record));
                            if let (Some(preview), Some(stamp)) = (this.compositions.import.as_mut(), stamp) {
                                preview.stamp = stamp;
                            }
                            cx.notify();
                        })))
                    })
                    .child(div().child(status))
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .items_center()
                            .gap(m.px(11.0))
                            .pt(m.px(9.0))
                            .border_t(m.border(1.0))
                            .border_color(t.border)
                            .child(geppui::button("composition-import-cancel").label(tr.t("Cancelar")).disabled(working).on_click(cx.listener(|this, _, _, cx| {
                                this.compositions.import = None;
                                cx.notify();
                            })))
                            .child(
                                geppui::button("composition-import-submit")
                                    .label("Importar como nova composição")
                                    .accent()
                                    .disabled(working || stale || full || name_empty)
                                    .on_click(cx.listener(|this, _, _, cx| this.import_preview_submit(false, cx))),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn mapping_dialog(
        &mut self,
        mapping: &Mapping,
        m: Metrics,
        _t: Theme,
        tr: Tr,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let deps = portable_dependencies(
            self.session.draft(),
            self.session.registry(),
            &mapping.item,
            &[],
        );
        let ambiguous: Vec<_> = deps
            .into_iter()
            .filter(|d| d.candidates.len() > 1)
            .collect();
        let stale = self.portable_stamp(&mapping.item) != mapping.stamp;
        let complete = ambiguous.iter().all(|d| {
            mapping
                .choices
                .iter()
                .any(|(k, v)| *k == d.key && !v.is_empty())
        });
        dialog("composition-mapping", "Escolher apresentações")
            .close_label(tr.t("Fechar"))
            .on_dismiss({
                let view = cx.entity().downgrade();
                move |_, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.compositions.mapping = None;
                        cx.notify();
                    });
                }
            })
            .child(div().mt(m.px(9.0)).child(format!(
                "Escolha a apresentação local de cada widget em “{}”.",
                mapping.item.name
            )))
            .children(ambiguous.iter().map(|d| {
                let key = d.key.clone();
                let options: Vec<(SharedString, SharedString)> =
                    std::iter::once((SharedString::from(""), SharedString::from("Escolher…")))
                        .chain(d.candidates.iter().map(|c| {
                            (
                                SharedString::from(c.id.clone()),
                                SharedString::from(c.label.clone()),
                            )
                        }))
                        .collect();
                let value = mapping
                    .choices
                    .iter()
                    .find(|(k, _)| *k == key)
                    .map_or(SharedString::from(""), |(_, v)| v.clone().into());
                div()
                    .mt(m.px(11.0))
                    .flex()
                    .flex_col()
                    .gap(m.px(6.0))
                    .child(div().font_weight(css_weight(600.0)).child(d.label.clone()))
                    .child(
                        geppui::select(
                            SharedString::from(format!("composition-map-{key}")),
                            options,
                            value,
                        )
                        .on_change(cx.listener(
                            move |this, value: &SharedString, _, cx| {
                                if let Some(mapping) = this.compositions.mapping.as_mut() {
                                    mapping.choices.retain(|(k, _)| *k != key);
                                    mapping.choices.push((key.clone(), value.to_string()));
                                }
                                cx.notify();
                            },
                        )),
                    )
            }))
            .child(div().mt(m.px(11.0)).child(if stale {
                SharedString::from(
                    "As apresentações mudaram. Cancele e confira os widgets novamente.",
                )
            } else {
                tr.t(&self.latest_message())
            }))
            .child(
                div()
                    .mt(m.px(22.0))
                    .flex()
                    .justify_end()
                    .gap(m.px(9.0))
                    .child(
                        dialog_button(
                            "composition-mapping-cancel",
                            tr.t("Cancelar"),
                            DialogButtonKind::Secondary,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.compositions.mapping = None;
                            cx.notify();
                        })),
                    )
                    .child(
                        dialog_button(
                            "composition-mapping-run",
                            "Aplicar widgets",
                            DialogButtonKind::Primary,
                        )
                        .disabled(stale || !complete)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(mapping) = this.compositions.mapping.clone() {
                                this.resolve_portable(
                                    mapping.item,
                                    mapping.choices,
                                    mapping.stamp,
                                    cx,
                                );
                            }
                        })),
                    ),
            )
            .into_any_element()
    }
}

/// `.ui-input` at 36px holding a text field.
fn text_input(field: &Entity<TextField>, focused: bool, m: Metrics, t: Theme) -> Div {
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
                gpui::BoxShadow::new(gpui::px(0.0), gpui::px(0.0), t.ring).spread_radius(m.px(2.0)),
            ])
        })
        .child(div().flex_1().min_w_0().child(field.clone()))
}

/// `.composition-restore-button`: 22px, 9px/600.
fn restore_button(
    id: SharedString,
    label: SharedString,
    disabled: bool,
    m: Metrics,
    t: Theme,
) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .flex_1()
        .min_w_0()
        .h(m.px(22.0))
        .flex()
        .items_center()
        .justify_center()
        .px(m.px(1.0))
        .rounded(m.px(5.0))
        .border(m.border(1.0))
        .border_color(t.border)
        .bg(t.surface)
        .text_color(t.text)
        .text_size(m.px(9.0))
        .font_weight(css_weight(600.0))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .when(disabled, |el| el.opacity(0.45))
        .when(!disabled, |el| {
            el.cursor_pointer().hover(move |s| {
                s.bg(t.accent_soft)
                    .border_color(t.accent_border)
                    .text_color(t.accent)
            })
        })
        .child(label)
}

#[cfg(test)]
mod tests {
    use super::*;
    use geppio_core::workbench::compositions::system_compositions;

    #[test]
    fn thumbnails_follow_the_reference_cells() {
        let presets = system_compositions(true);
        let default = &presets[0];
        let drawn = cells(default);
        // Padrão: Sidebar 283 → 28 units; Bottom 167 → 21 units; Main and Bottom cells.
        assert_eq!(drawn[0].role, CellRole::Sidebar);
        assert_eq!((drawn[0].x, drawn[0].width), (3.0, 28.0));
        assert_eq!(drawn[1].role, CellRole::Widget(Region::Main));
        assert!((drawn[1].x - 34.0).abs() < 1e-9 && (drawn[1].height - 50.0).abs() < 1e-9);
        assert_eq!(drawn[2].role, CellRole::Widget(Region::Bottom));
        assert!((drawn[2].y - 56.0).abs() < 1e-9);
        // Foco: Main only, two cells, no Bottom.
        let focus = cells(&presets[1]);
        assert_eq!(
            focus
                .iter()
                .filter(|c| c.role == CellRole::Widget(Region::Main))
                .count(),
            2
        );
        assert!(
            !focus
                .iter()
                .any(|c| matches!(c.role, CellRole::Widget(Region::Bottom)))
        );
    }

    #[test]
    fn picked_paths_follow_the_reference_rules() {
        use std::path::Path;
        assert!(selected_path(Path::new(
            r"C:\Users\dev\Documents\composicao.geppio-layout.json"
        )));
        assert!(selected_path(Path::new(r"D:\a\B.GEPPIO-LAYOUT.JSON")));
        assert!(!selected_path(Path::new(r"C:\Users\dev\composicao.json")));
        assert!(!selected_path(Path::new(
            r"\\server\share\a.geppio-layout.json"
        )));
        assert!(!selected_path(Path::new(
            r"C:\Users\..\a.geppio-layout.json"
        )));
        assert!(!selected_path(Path::new(r"C:\con\a.geppio-layout.json")));
        assert!(!selected_path(Path::new(
            r"C:\PROGRA~1\a.geppio-layout.json"
        )));
        assert!(!selected_path(Path::new(r"C:\dir.\a.geppio-layout.json")));
        assert!(!safe_file_name("a:b") && !safe_file_name("lpt1.txt") && safe_file_name("lpt10"));
    }

    #[test]
    fn exports_are_created_once_and_read_back() {
        let dir = std::env::temp_dir().join(format!("geppio-export-test-{}", crate::bars::uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(&dir).unwrap();
        let dir = std::path::PathBuf::from(dir.to_string_lossy().trim_start_matches(r"\\?\"));
        let path = dir.join("a.geppio-layout.json");
        assert_eq!(write_export(&path, "{\"x\":1}"), ExportOutcome::Written);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"x\":1}");
        assert_eq!(write_export(&path, "{}"), ExportOutcome::Exists);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"x\":1}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A fresh directory in a plain (canonical, link-free) temp path.
    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("geppio-{tag}-{}", crate::bars::uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = std::fs::canonicalize(&dir).unwrap();
        std::path::PathBuf::from(dir.to_string_lossy().trim_start_matches(r"\\?\"))
    }

    const RECIPE: &str = r#"{"kind":"geppio-layout","version":1,"name":"R","mode":"format","scopes":["main"],"reference":{"main":{"width":1200,"height":700}},"chrome":{},"format":[{"key":"s1","region":"main","x":0,"y":0,"width":590,"height":700}],"views":[],"placements":[],"groups":[]}"#;

    #[test]
    fn names_refuse_dot_dot_prefixes_and_lone_surrogates() {
        use std::path::Path;
        assert!(!selected_path(Path::new(r"C:\..x.geppio-layout.json")));
        assert!(!safe_file_name("..x") && !safe_file_name(".") && safe_file_name(".x"));
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt as _;
            let mut wide: Vec<u16> = r"C:\".encode_utf16().collect();
            wide.push(0xd800);
            wide.extend(".geppio-layout.json".encode_utf16());
            let path = std::path::PathBuf::from(std::ffi::OsString::from_wide(&wide));
            assert!(!selected_path(&path));
        }
    }

    #[test]
    fn recipes_are_read_bounded_from_plain_regular_files() {
        let dir = scratch("import-test");
        let file = |name: &str, bytes: &[u8]| {
            let path = dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        };
        assert!(read_recipe(&file("ok.geppio-layout.json", RECIPE.as_bytes())).is_ok());
        let bom = [&[0xef, 0xbb, 0xbf][..], RECIPE.as_bytes()].concat();
        assert!(read_recipe(&file("bom.geppio-layout.json", &bom)).is_ok());
        let mut big = RECIPE.as_bytes().to_vec();
        big.resize(geppio_core::layout::policy::MAX_BYTES + 1, b' ');
        assert!(read_recipe(&file("big.geppio-layout.json", &big)).is_err());
        assert!(read_recipe(&file("bad.geppio-layout.json", &[0xff, 0xfe, 0x7b])).is_err());
        std::fs::create_dir(dir.join("dir.geppio-layout.json")).unwrap();
        assert!(read_recipe(&dir.join("dir.geppio-layout.json")).is_err());
        assert_eq!(
            read_recipe(&dir.join("x.json")).unwrap_err(),
            "Selecione um arquivo .geppio-layout.json."
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A directory junction needs no privilege (`mklink /J`).
    #[cfg(windows)]
    #[test]
    fn junctions_in_the_chain_are_refused() {
        let dir = scratch("junction-test");
        let target = dir.join("target");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("in.geppio-layout.json"), RECIPE).unwrap();
        let link = dir.join("link");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .is_ok_and(|o| o.status.success());
        if made {
            assert!(read_recipe(&link.join("in.geppio-layout.json")).is_err());
            assert_eq!(
                write_export(&link.join("out.geppio-layout.json"), RECIPE),
                ExportOutcome::Failed
            );
            assert!(!target.join("out.geppio-layout.json").exists());
            std::fs::remove_dir(&link).unwrap();
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
