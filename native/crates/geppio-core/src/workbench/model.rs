//! Workbench model (`shared/workbench/model.ts`): widget registry, snapshot types, limits
//! and the organization helpers shared by the codec and the commands.
use super::chrome::{WorkbenchChrome, default_chrome};
use super::portable::PortableLayout;
use super::presentations::{Presentation, Presentations};
use crate::freeform::{Layout, constraint_in_region, constraints, default_freeform};
use crate::js;
use crate::layout::policy::{GAP, MAX_SIZE, MAX_WIDGETS};
use crate::layout::{Constraint, Constraints, PerRegion, Placement, References, Region, Size};

/// Storage key of the active host envelope.
pub const WORKBENCH_KEY: &str = "geppio:workbench:v1";
/// Identity of the protected Home bar.
pub const HOME: &str = "home";
/// Icons a user bar may use.
pub const BAR_ICONS: [&str; 16] = [
    "home", "folder", "star", "code", "notes", "chart", "library", "widgets", "calendar", "chat",
    "terminal", "queue", "clock", "swatch", "link", "git",
];
/// Height of a tab group's strip, added to the group's minimum height.
pub const TAB_STRIP_HEIGHT: f64 = 32.0;

/// Organization limits (`LIMITS`).
pub mod limits {
    /// Active custom bars a new activation may reach.
    pub const ACTIVE_BARS: usize = 14;
    /// Active custom bars an existing document may contain.
    pub const LEGACY_ACTIVE_BARS: usize = 20;
    /// Saved custom bars.
    pub const SAVED_BARS: usize = 100;
    /// Saved compositions.
    pub const COMPOSITIONS: usize = 100;
    /// Favorite compositions.
    pub const FAVORITES: usize = 9;
    /// Whole intentions kept by the edit history.
    pub const HISTORY: usize = 256;
}

/// Frame appearance.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appearance {
    /// Card frame.
    Card,
    /// Seamless frame.
    Seamless,
}

/// How many presentations a type may have.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Presence {
    /// One view in one region.
    SingleView,
    /// One view per region (shared model).
    MultipleAreas,
}

/// A registered widget type. Metadata comes only from bundled declarations or validated
/// native inventory; documents cannot add fields or authority.
#[derive(Clone, Debug, PartialEq)]
pub struct WidgetType {
    /// Qualified type identity (`host:…` or `plugin:<plugin>:<widget>`).
    pub id: String,
    /// Owner (`host` or `plugin:<plugin>`).
    pub owner: String,
    /// Catalog title (pt-BR).
    pub title: String,
    /// Catalog category (pt-BR).
    pub category: String,
    /// Catalog description (pt-BR).
    pub description: String,
    /// Frame appearance.
    pub appearance: Appearance,
    /// Presence rule.
    pub presence: Presence,
    /// Sizing contract.
    pub constraint: Constraint,
    /// Synthetic demo fixture name (host demo widgets only).
    pub fixture: Option<String>,
    /// Plugin widget identity.
    pub widget_id: Option<String>,
    /// Plugin identity.
    pub plugin_id: Option<String>,
    /// Retired demo type: excluded from the catalog, archived on load.
    pub retired: bool,
    /// Declared by recovery only; the plugin no longer provides it.
    pub missing: bool,
    /// Presentations available in Main (`presentations.main`).
    pub presentations: Option<Vec<Presentation>>,
    /// Returning to Normal reuses the stored Normal seed.
    pub preserve_normal_geometry: bool,
    /// The frame can be maximized.
    pub maximize: bool,
    /// The type can host a tab group.
    pub tab_host: bool,
    /// The type can join a tab group.
    pub tab_member: bool,
}

/// The widget registry (`ReadonlyMap<string, WidgetType>`), in registration order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Registry {
    types: Vec<WidgetType>,
}

impl Registry {
    /// Builds a registry; a later duplicate identity replaces the earlier entry in place.
    pub fn new(types: impl IntoIterator<Item = WidgetType>) -> Self {
        let mut out = Self::default();
        for t in types {
            match out.types.iter_mut().find(|e| e.id == t.id) {
                Some(slot) => *slot = t,
                None => out.types.push(t),
            }
        }
        out
    }
    /// The type with an identity.
    pub fn get(&self, id: &str) -> Option<&WidgetType> {
        self.types.iter().find(|t| t.id == id)
    }
    /// Whether an identity is registered.
    pub fn has(&self, id: &str) -> bool {
        self.get(id).is_some()
    }
    /// Every type in order.
    pub fn types(&self) -> &[WidgetType] {
        &self.types
    }
}

/// A plugin widget declaration (`manifest.widgets[i]`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginWidget {
    /// Widget identity inside the plugin.
    pub id: String,
    /// Title.
    pub title: String,
}

/// The parts of an installed plugin the registry reads (`InstalledPlugin`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstalledPlugin {
    /// Plugin identity.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Manifest API version (1 or 2).
    pub api_version: u32,
    /// Declared widgets.
    pub widgets: Vec<PluginWidget>,
    /// Widgets kept only for recovery of saved documents.
    pub recovery_widgets: Vec<PluginWidget>,
}

fn host_type(
    id: &str,
    title: &str,
    category: &str,
    description: &str,
    min: Size,
    default: Size,
    regions: &[Region],
) -> WidgetType {
    WidgetType {
        id: id.to_owned(),
        owner: "host".to_owned(),
        title: title.to_owned(),
        category: category.to_owned(),
        description: description.to_owned(),
        appearance: Appearance::Card,
        presence: Presence::SingleView,
        constraint: Constraint {
            min,
            default,
            max: Size::new(24000.0, 24000.0),
            resize_x: true,
            resize_y: true,
            region_min: PerRegion::default(),
            regions: regions.to_vec(),
        },
        fixture: None,
        widget_id: None,
        plugin_id: None,
        retired: false,
        missing: false,
        presentations: None,
        preserve_normal_geometry: false,
        maximize: true,
        tab_host: false,
        tab_member: false,
    }
}

/// The essential first-party host types: file editor, file explorer, terminal and Git.
pub fn host_types() -> Vec<WidgetType> {
    use Region::{Bottom, Main, Sidebar};
    vec![
        host_type(
            "host:file-editor",
            "Editor de arquivo",
            "Arquivos & Editor",
            "Editor oficial essencial. Compartilha o documento aberto no modo Editor.",
            Size::new(320.0, 240.0),
            Size::new(640.0, 480.0),
            &[Main],
        ),
        host_type(
            "host:file-explorer",
            "Explorador de arquivos",
            "Arquivos & Editor",
            "Árvore oficial da pasta selecionada. Compartilha a navegação com o modo Editor.",
            Size::new(180.0, 160.0),
            Size::new(300.0, 400.0),
            &[Main, Sidebar],
        ),
        host_type(
            "host:terminal",
            "Terminal",
            "Terminal & Tarefas",
            "PowerShell interativo oficial. A mesma sessão no Editor e nos Widgets.",
            Size::new(320.0, 105.0),
            Size::new(640.0, 320.0),
            &[Main, Bottom],
        ),
        host_type(
            "host:git-changes",
            "Alterações Git",
            "Desenvolvimento",
            "Consulta Git real da pasta do Explorador. Status e comparação somente leitura.",
            Size::new(180.0, 180.0),
            Size::new(320.0, 420.0),
            &[Main, Sidebar],
        ),
    ]
}

/// The seven demo fixtures: `(fixture, title, category)`.
pub const DEMO_WIDGETS: [(&str, &str, &str); 7] = [
    ("summary", "Panorama", "Indicadores"),
    ("queue", "Fila de trabalho", "Organização"),
    ("library", "Biblioteca", "Organização"),
    ("notes", "Ideias em aberto", "Anotações"),
    ("activity", "Atividade", "Organização"),
    ("properties", "Propriedades", "Desenvolvimento"),
    ("chart", "Ritmo", "Indicadores"),
];

/// The seven demo widget types (`host:<fixture>`), retired unless `demo_fixtures`.
pub fn demo_types(demo_fixtures: bool) -> Vec<WidgetType> {
    let cs = constraints();
    DEMO_WIDGETS
        .iter()
        .map(|&(fixture, title, category)| {
            let base = cs.get(fixture).expect("fixture constraint").clone();
            let region_min = PerRegion {
                main: None,
                sidebar: Some(Size::new(150.0, base.min.height)),
                bottom: (fixture == "summary" || fixture == "chart")
                    .then(|| Size::new(base.min.width, 105.0)),
            };
            WidgetType {
                id: format!("host:{fixture}"),
                owner: "host".to_owned(),
                title: title.to_owned(),
                category: category.to_owned(),
                description: "Widget de demonstração do GeppIO.".to_owned(),
                appearance: Appearance::Card,
                presence: if fixture == "notes" || fixture == "library" {
                    Presence::MultipleAreas
                } else {
                    Presence::SingleView
                },
                constraint: Constraint { region_min, ..base },
                fixture: Some(fixture.to_owned()),
                widget_id: None,
                plugin_id: None,
                retired: !demo_fixtures,
                missing: false,
                presentations: ["summary", "queue", "properties", "activity"]
                    .contains(&fixture)
                    .then(|| {
                        vec![
                            Presentation::Normal,
                            Presentation::Docked,
                            Presentation::Overlay,
                        ]
                    }),
                preserve_normal_geometry: false,
                maximize: false,
                tab_host: false,
                tab_member: false,
            }
        })
        .collect()
}

/// The widget registry (`widgetRegistry`): demo fixtures, the host essentials and every
/// plugin widget (including recovery-only declarations).
pub fn widget_registry(plugins: &[InstalledPlugin], demo_fixtures: bool) -> Registry {
    let mut entries = demo_types(demo_fixtures);
    entries.extend(host_types());
    for plugin in plugins {
        let essentials = plugin.id == "geppio.workspace-essentials";
        for widget in plugin.widgets.iter().chain(&plugin.recovery_widgets) {
            let w = widget.id.as_str();
            let tabbed = essentials && ["notes", "checklist", "prompts"].contains(&w);
            let everywhere =
                tabbed || (plugin.id == "geppio.time-tracker" && ["timer", "reports"].contains(&w));
            let mut region_min = PerRegion::default();
            if everywhere {
                region_min.sidebar = Some(Size::new(150.0, 112.0));
                region_min.bottom = Some(Size::new(180.0, 105.0));
            }
            entries.push(WidgetType {
                id: format!("plugin:{}:{}", plugin.id, w),
                owner: format!("plugin:{}", plugin.id),
                title: widget.title.clone(),
                category: "Plugins".to_owned(),
                description: plugin.name.clone(),
                appearance: Appearance::Card,
                presence: Presence::SingleView,
                constraint: Constraint {
                    min: Size::new(180.0, 112.0),
                    default: if plugin.api_version == 2 {
                        Size::new(360.0, 360.0)
                    } else {
                        Size::new(310.0, 160.0)
                    },
                    max: Size::new(MAX_SIZE, MAX_SIZE),
                    resize_x: true,
                    resize_y: true,
                    region_min,
                    regions: if everywhere {
                        Region::ALL.to_vec()
                    } else {
                        vec![Region::Main]
                    },
                },
                fixture: None,
                widget_id: Some(w.to_owned()),
                plugin_id: Some(plugin.id.clone()),
                retired: false,
                missing: !plugin.widgets.iter().any(|current| current.id == widget.id),
                presentations: (essentials && w == "notes").then(|| {
                    vec![
                        Presentation::Normal,
                        Presentation::Docked,
                        Presentation::Overlay,
                    ]
                }),
                preserve_normal_geometry: essentials && w == "notes",
                maximize: essentials && ["notes", "scratch", "checklist", "prompts"].contains(&w),
                tab_host: tabbed,
                tab_member: tabbed,
            });
        }
    }
    Registry::new(entries)
}

/// The model identity of a type (`model:<type>`).
pub fn model_id(type_id: &str) -> String {
    format!("model:{type_id}")
}

/// A presentation of a model in the workbench.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct View {
    /// View identity (also the placement identity).
    pub id: String,
    /// Widget type.
    pub type_id: String,
    /// Model identity (`model:<type>`).
    pub model_id: String,
}

impl View {
    /// A view of a type.
    pub fn new(id: impl Into<String>, type_id: &str) -> Self {
        Self {
            id: id.into(),
            type_id: type_id.to_owned(),
            model_id: model_id(type_id),
        }
    }
}

/// A tab group sharing one frame.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WidgetGroup {
    /// `group:<uuid>`.
    pub id: String,
    /// View whose placement is the group frame.
    pub frame_id: String,
    /// Member views in tab order.
    pub members: Vec<String>,
    /// Active tab.
    pub active: String,
}

/// Tab groups (`{ version: 1, entries }`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WidgetGroups {
    /// Groups in order.
    pub entries: Vec<WidgetGroup>,
}

/// Insertion-ordered `type → y` map of a bar (`positions`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Positions {
    entries: Vec<(String, f64)>,
}

impl Positions {
    /// An empty map.
    pub fn new() -> Self {
        Self::default()
    }
    /// The saved y of a type.
    pub fn get(&self, type_id: &str) -> Option<f64> {
        self.entries
            .iter()
            .find(|(k, _)| k == type_id)
            .map(|(_, y)| *y)
    }
    /// Assignment: an existing key keeps its position.
    pub fn set(&mut self, type_id: &str, y: f64) {
        match self.entries.iter_mut().find(|(k, _)| k == type_id) {
            Some(slot) => slot.1 = y,
            None => self.entries.push((type_id.to_owned(), y)),
        }
    }
    /// `??=`: assigns only when absent.
    pub fn set_default(&mut self, type_id: &str, y: f64) {
        if self.get(type_id).is_none() {
            self.set(type_id, y);
        }
    }
    /// `delete`.
    pub fn remove(&mut self, type_id: &str) {
        self.entries.retain(|(k, _)| k != type_id);
    }
    /// Keeps entries matching a predicate.
    pub fn retain(&mut self, keep: impl Fn(&str) -> bool) {
        self.entries.retain(|(k, _)| keep(k));
    }
    /// Entries in order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, f64)> {
        self.entries.iter().map(|(k, y)| (k.as_str(), *y))
    }
    /// Number of entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    /// Whether the map is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// A Sidebar bar: members are widget types; positions keep each bar's free order.
#[derive(Clone, Debug, PartialEq)]
pub struct UserBar {
    /// Bar identity (`home` is protected).
    pub id: String,
    /// Name.
    pub name: String,
    /// Whether the user named it.
    pub user_named: bool,
    /// One of [`BAR_ICONS`].
    pub icon: String,
    /// Archived bars are kept but inactive.
    pub archived: bool,
    /// Member types in order.
    pub members: Vec<String>,
    /// Saved y per member type.
    pub positions: Positions,
}

/// Saved composition mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompositionMode {
    /// Format slots only.
    Format,
    /// Format slots plus widget associations.
    FormatWidgets,
}

impl CompositionMode {
    /// `'format' | 'format-widgets'`.
    pub fn as_str(self) -> &'static str {
        match self {
            CompositionMode::Format => "format",
            CompositionMode::FormatWidgets => "format-widgets",
        }
    }
    /// Parses a mode.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "format" => Some(CompositionMode::Format),
            "format-widgets" => Some(CompositionMode::FormatWidgets),
            _ => None,
        }
    }
}

/// A reusable format rectangle.
#[derive(Clone, Debug, PartialEq)]
pub struct FormatSlot {
    /// Slot identity.
    pub id: String,
    /// Region.
    pub region: Region,
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// A saved composition (library record).
#[derive(Clone, Debug, PartialEq)]
pub struct Composition {
    /// `composition:<…>` or `system:<…>`.
    pub id: String,
    /// User-visible name.
    pub name: String,
    /// Built-in preset.
    pub system: bool,
    /// Regions the composition applies to.
    pub scopes: Vec<Region>,
    /// Reference sizes of the saved geometry.
    pub reference: References,
    /// Saved widget placements.
    pub placements: Vec<Placement>,
    /// Saved view associations.
    pub views: Vec<View>,
    /// Mode.
    pub mode: CompositionMode,
    /// Format slots.
    pub format: Vec<FormatSlot>,
    /// Remembered chrome sizes.
    pub chrome: Option<super::chrome::ChromePatch>,
    /// Saved tab groups.
    pub groups: Option<WidgetGroups>,
    /// Inert imported recipe (envelope v3).
    pub portable: Option<PortableLayout>,
}

/// Session-only reserved slot (never persisted).
#[derive(Clone, Debug, PartialEq)]
pub struct SessionSlot {
    /// Slot identity.
    pub id: String,
    /// Region.
    pub region: Region,
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
    /// Bar that owns a Sidebar slot.
    pub sidebar_bar: Option<String>,
    /// Reference size the slot was projected for.
    pub reference: Size,
}

/// Typed organization of the workbench.
#[derive(Clone, Debug, PartialEq)]
pub struct Organization {
    /// Views (at most 16).
    pub views: Vec<View>,
    /// Bars; the first is Home.
    pub bars: Vec<UserBar>,
    /// Active bar identity.
    pub active_bar: String,
    /// Saved compositions.
    pub compositions: Vec<Composition>,
    /// Favorite composition identities.
    pub favorites: Vec<String>,
    /// Default composition (a favorite) or none.
    pub default_composition: Option<String>,
    /// Confirmed region chrome.
    pub chrome: WorkbenchChrome,
    /// Persistent widget presentations.
    pub presentations: Presentations,
    /// Tab groups.
    pub groups: Option<WidgetGroups>,
    /// Library order.
    pub composition_order: Option<Vec<String>>,
}

/// Archived retired demo views and their geometry.
#[derive(Clone, Debug, PartialEq)]
pub struct DemoArchive {
    /// Reference sizes when retired.
    pub reference: References,
    /// Archived placements.
    pub placements: Vec<Placement>,
    /// Archived views.
    pub views: Vec<View>,
    /// Archived bar memberships `(id, members, positions)`.
    pub bars: Vec<(String, Vec<String>, Positions)>,
    /// Archived presentation preferences.
    pub presentations: Presentations,
    /// JSON key order: archives created by retirement write `views` before `placements`.
    pub views_first: bool,
}

/// The whole workbench document: layout plus organization.
#[derive(Clone, Debug, PartialEq)]
pub struct WorkbenchSnapshot {
    /// Recorded inner reference size per region.
    pub reference: References,
    /// Placements (one per frame).
    pub placements: Vec<Placement>,
    /// Organization.
    pub organization: Organization,
    /// Archived retired demos.
    pub retired_demos: Option<DemoArchive>,
}

/// An editable session state: snapshot plus session-only slots and the applied format.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionDraft {
    /// Snapshot.
    pub snapshot: WorkbenchSnapshot,
    /// Reserved session slots.
    pub slots: Vec<SessionSlot>,
    /// Applied format composition.
    pub format_id: Option<String>,
}

impl SessionDraft {
    /// A draft without slots or format.
    pub fn new(snapshot: WorkbenchSnapshot) -> Self {
        Self {
            snapshot,
            slots: Vec::new(),
            format_id: None,
        }
    }
}

impl WorkbenchSnapshot {
    /// The view with an identity.
    pub fn view(&self, id: &str) -> Option<&View> {
        self.organization.views.iter().find(|v| v.id == id)
    }
    /// The type identity of a view.
    pub fn type_of(&self, id: &str) -> Option<&str> {
        self.view(id).map(|v| v.type_id.as_str())
    }
    /// The placement with an identity.
    pub fn placement(&self, id: &str) -> Option<&Placement> {
        self.placements.iter().find(|p| p.id == id)
    }
    /// The active bar.
    pub fn active_bar(&self) -> Option<&UserBar> {
        self.organization
            .bars
            .iter()
            .find(|b| b.id == self.organization.active_bar)
    }
    pub(crate) fn active_bar_index(&self) -> Option<usize> {
        self.organization
            .bars
            .iter()
            .position(|b| b.id == self.organization.active_bar)
    }
    /// This snapshot with another active bar.
    pub fn with_active_bar(&self, bar: &str) -> Self {
        let mut next = self.clone();
        next.organization.active_bar = bar.to_owned();
        next
    }
}

/// The group containing a view (`groupFor`).
pub fn group_for<'a>(source: &'a WorkbenchSnapshot, id: &str) -> Option<&'a WidgetGroup> {
    source
        .organization
        .groups
        .as_ref()?
        .entries
        .iter()
        .find(|g| g.members.iter().any(|m| m == id))
}

/// The combined constraint of a tab group (`groupConstraint`).
pub fn group_constraint(member_types: &[&str], registry: &Registry) -> Constraint {
    let originals: Vec<&Constraint> = member_types
        .iter()
        .map(|t| &registry.get(t).expect("group member type").constraint)
        .collect();
    let declarations: Vec<Constraint> = originals
        .iter()
        .map(|c| constraint_in_region(c, Region::Main))
        .collect();
    let base = declarations[0].clone();
    let regions: Vec<Region> = Region::ALL
        .into_iter()
        .filter(|r| originals.iter().all(|c| c.allows(*r)))
        .collect();
    let mut region_min = PerRegion::default();
    for &region in &regions {
        *region_min.get_mut(region) = Some(Size::new(
            js::max_of(
                originals
                    .iter()
                    .map(|c| constraint_in_region(c, region).min.width),
            ),
            js::max_of(
                originals
                    .iter()
                    .map(|c| constraint_in_region(c, region).min.height),
            ) + TAB_STRIP_HEIGHT,
        ));
    }
    Constraint {
        regions,
        region_min,
        min: Size::new(
            js::max_of(declarations.iter().map(|c| c.min.width)),
            js::max_of(declarations.iter().map(|c| c.min.height)) + TAB_STRIP_HEIGHT,
        ),
        max: Size::new(
            js::min_of(declarations.iter().map(|c| c.max.width)),
            js::min_of(
                std::iter::once(MAX_SIZE)
                    .chain(declarations.iter().map(|c| c.max.height + TAB_STRIP_HEIGHT)),
            ),
        ),
        resize_x: declarations.iter().all(|c| c.resize_x),
        resize_y: declarations.iter().all(|c| c.resize_y),
        default: base.default,
    }
}

/// Every surface presence, including non-frame group members at their frame (`surfacePlacements`).
pub fn surface_placements(source: &WorkbenchSnapshot) -> Vec<Placement> {
    let mut out = source.placements.clone();
    if let Some(groups) = &source.organization.groups {
        for group in &groups.entries {
            if let Some(frame) = source.placement(&group.frame_id) {
                for id in group.members.iter().filter(|id| **id != group.frame_id) {
                    let mut copy = frame.clone();
                    copy.id = id.clone();
                    out.push(copy);
                }
            }
        }
    }
    out
}

/// Removes one grouped presence, re-homing the frame when needed (`removeGroupedPresence`).
pub fn remove_grouped_presence(
    source: &WorkbenchSnapshot,
    id: &str,
    registry: Option<&Registry>,
) -> WorkbenchSnapshot {
    let Some(group) = group_for(source, id) else {
        return source.clone();
    };
    let mut next = source.clone();
    let members: Vec<String> = group.members.iter().filter(|m| *m != id).cloned().collect();
    let frame_id = if group.frame_id != id {
        Some(group.frame_id.clone())
    } else if members.len() == 1 || registry.is_none() {
        members.first().cloned()
    } else {
        let registry = registry.expect("checked");
        members
            .iter()
            .find(|m| {
                source
                    .type_of(m)
                    .and_then(|t| registry.get(t))
                    .is_some_and(|t| t.tab_host)
            })
            .cloned()
    };
    let Some(frame_id) = frame_id else {
        return source.clone();
    };
    for p in &mut next.placements {
        if p.id == group.frame_id {
            p.id = frame_id.clone();
        }
    }
    let groups = next.organization.groups.as_mut().expect("grouped");
    groups.entries = std::mem::take(&mut groups.entries)
        .into_iter()
        .flat_map(|item| {
            if item.id != group.id {
                vec![item]
            } else if members.len() < 2 {
                vec![]
            } else {
                let active = if members.contains(&item.active) {
                    item.active.clone()
                } else {
                    members[0].clone()
                };
                vec![WidgetGroup {
                    id: item.id,
                    frame_id: frame_id.clone(),
                    members: members.clone(),
                    active,
                }]
            }
        })
        .collect();
    let old_type = source.type_of(id).expect("grouped view").to_owned();
    let frame_type = source
        .type_of(&group.frame_id)
        .expect("frame view")
        .to_owned();
    let new_frame_type = source.type_of(&frame_id).expect("member view").to_owned();
    let frame = source.placement(&group.frame_id);
    if frame.is_some_and(|f| f.region == Region::Sidebar) {
        let frame_y = frame.expect("checked").y;
        for bar in &mut next.organization.bars {
            if !bar.members.contains(&frame_type) {
                continue;
            }
            let y = bar.positions.get(&frame_type).unwrap_or(frame_y);
            bar.members.retain(|t| *t != old_type);
            bar.positions.remove(&old_type);
            bar.positions.set(&new_frame_type, y);
        }
    }
    next
}

/// The member types of a frame, or the view's own type (`frameTypes`).
pub fn frame_types(source: &WorkbenchSnapshot, id: &str) -> Vec<String> {
    let members: Vec<String> = match group_for(source, id) {
        Some(group) => group.members.clone(),
        None => vec![id.to_owned()],
    };
    members
        .iter()
        .map(|m| source.type_of(m).expect("frame member view").to_owned())
        .collect()
}

/// Constraints keyed by view; a group frame uses the group constraint (`constraintsForViews`).
pub fn constraints_for_views(
    views: &[View],
    groups: Option<&WidgetGroups>,
    registry: &Registry,
) -> Constraints {
    let mut out = Constraints::new();
    for view in views {
        let Some(t) = registry.get(&view.type_id) else {
            continue;
        };
        let group = groups.and_then(|g| g.entries.iter().find(|g| g.members.contains(&view.id)));
        let constraint = match group {
            Some(group) if group.frame_id == view.id => {
                let types: Vec<&str> = group
                    .members
                    .iter()
                    .map(|m| {
                        views
                            .iter()
                            .find(|v| v.id == *m)
                            .expect("group member view")
                            .type_id
                            .as_str()
                    })
                    .collect();
                group_constraint(&types, registry)
            }
            _ => t.constraint.clone(),
        };
        out.insert(view.id.clone(), constraint);
    }
    out
}

/// [`constraints_for_views`] of a snapshot.
pub fn snapshot_constraints(snapshot: &WorkbenchSnapshot, registry: &Registry) -> Constraints {
    constraints_for_views(
        &snapshot.organization.views,
        snapshot.organization.groups.as_ref(),
        registry,
    )
}

/// Adopts a freeform layout into the workbench envelope (`adoptLayout`).
pub fn adopt_layout(layout: &Layout) -> WorkbenchSnapshot {
    use super::chrome::ChromeRegion;
    let mut chrome = default_chrome();
    // Explicit adoption maps an occupied legacy inner reference to approved chrome.
    for (region, chrome_region) in [
        (Region::Sidebar, ChromeRegion::Sidebar),
        (Region::Bottom, ChromeRegion::Bottom),
    ] {
        if layout.placements.iter().any(|p| p.region == region) {
            let limits = chrome_region.limits();
            let (extent, target) = if region == Region::Sidebar {
                (layout.reference.sidebar.width + 30.0, &mut chrome.sidebar)
            } else {
                (layout.reference.bottom.height + 20.0, &mut chrome.bottom)
            };
            target.size = js::max(limits.min, js::min(limits.max, extent));
        }
    }
    let sidebar: Vec<&Placement> = layout
        .placements
        .iter()
        .filter(|p| p.region == Region::Sidebar)
        .collect();
    let mut positions = Positions::new();
    for p in &sidebar {
        positions.set(&format!("host:{}", p.id), p.y);
    }
    WorkbenchSnapshot {
        reference: layout.reference,
        placements: layout.placements.clone(),
        organization: Organization {
            views: layout
                .placements
                .iter()
                .map(|p| View::new(p.id.clone(), &format!("host:{}", p.id)))
                .collect(),
            bars: vec![UserBar {
                id: HOME.to_owned(),
                name: "Ferramentas".to_owned(),
                user_named: false,
                icon: "home".to_owned(),
                archived: false,
                members: sidebar.iter().map(|p| format!("host:{}", p.id)).collect(),
                positions,
            }],
            active_bar: HOME.to_owned(),
            compositions: Vec::new(),
            favorites: vec![
                "system:default".to_owned(),
                "system:focus".to_owned(),
                "system:balanced".to_owned(),
            ],
            default_composition: Some("system:default".to_owned()),
            chrome,
            presentations: Presentations::default(),
            groups: None,
            composition_order: None,
        },
        retired_demos: None,
    }
}

/// The startup/reset workbench (`initialWorkbench`). Synthetic scenes are opt-in fixtures,
/// never the normal startup policy: without `demo_fixtures` the regions are empty.
pub fn initial_workbench(demo_fixtures: bool) -> WorkbenchSnapshot {
    let mut snapshot = adopt_layout(&default_freeform());
    snapshot.reference = PerRegion {
        main: Size::new(1567.0, 774.0),
        sidebar: Size::new(253.0, 950.0),
        bottom: Size::new(1543.0, 147.0),
    };
    let seeds = [
        ("summary", Region::Main, 0.0, 0.0, 778.5, 382.0),
        ("queue", Region::Main, 788.5, 0.0, 778.5, 382.0),
        ("properties", Region::Main, 0.0, 392.0, 778.5, 382.0),
        ("activity", Region::Main, 788.5, 392.0, 778.5, 382.0),
        ("notes", Region::Sidebar, 0.0, 0.0, 253.0, 300.0),
        ("library", Region::Sidebar, 0.0, 310.0, 253.0, 230.0),
        ("chart", Region::Bottom, 0.0, 0.0, 1543.0, 147.0),
    ];
    snapshot.placements = seeds
        .iter()
        .map(|&(id, region, x, y, w, h)| {
            Placement::new(id, region, crate::layout::Bounds::new(x, y, w, h))
        })
        .collect();
    let home = &mut snapshot.organization.bars[0];
    home.members = vec!["host:notes".to_owned(), "host:library".to_owned()];
    home.positions = Positions::new();
    home.positions.set("host:notes", 0.0);
    home.positions.set("host:library", 310.0);
    if !demo_fixtures {
        snapshot.placements.clear();
        snapshot.organization.views.clear();
        let home = &mut snapshot.organization.bars[0];
        home.members.clear();
        home.positions = Positions::new();
    }
    snapshot
}

/// Main/Bottom placements plus the active bar's Sidebar stack ordered by saved position;
/// `packed` stacks it from 0 with the gap (`activePlacements`).
pub fn active_placements(snapshot: &WorkbenchSnapshot, packed: bool) -> Vec<Placement> {
    active_parts(
        &snapshot.placements,
        &snapshot.organization.views,
        snapshot.active_bar(),
        packed,
    )
}

/// [`active_placements`] over the parts of a snapshot.
pub(crate) fn active_parts(
    placements: &[Placement],
    views: &[View],
    bar: Option<&UserBar>,
    packed: bool,
) -> Vec<Placement> {
    let mut sidebar: Vec<Placement> = Vec::new();
    for type_id in bar.map(|b| b.members.as_slice()).unwrap_or(&[]) {
        let view = views.iter().find(|v| {
            v.type_id == *type_id
                && placements
                    .iter()
                    .any(|p| p.id == v.id && p.region == Region::Sidebar)
        });
        let Some(placement) = view.and_then(|v| placements.iter().find(|p| p.id == v.id)) else {
            continue;
        };
        let y = bar
            .and_then(|b| b.positions.get(type_id))
            .unwrap_or(placement.y);
        let mut copy = placement.clone();
        copy.y = y;
        sidebar.push(copy);
    }
    // Saved free positions determine a stable per-bar order, never empty bands.
    sidebar.sort_by(|a, b| js::order(a.y - b.y));
    if packed {
        let mut bottom = 0.0;
        for p in &mut sidebar {
            p.x = 0.0;
            p.y = bottom;
            bottom += p.height + GAP;
        }
    }
    let mut out: Vec<Placement> = placements
        .iter()
        .filter(|p| p.region != Region::Sidebar)
        .cloned()
        .collect();
    out.extend(sidebar);
    out
}

/// Insertion index and line of a Sidebar drop at `y` (`sidebarInsertion`); peer
/// midpoints decide, for commands and drag feedback alike.
pub fn sidebar_insertion(
    snapshot: &WorkbenchSnapshot,
    id: Option<&str>,
    y: f64,
) -> (Vec<Placement>, usize, f64) {
    let peers: Vec<Placement> = active_placements(snapshot, true)
        .into_iter()
        .filter(|p| p.region == Region::Sidebar && Some(p.id.as_str()) != id)
        .collect();
    let index = peers
        .iter()
        .position(|p| y < p.y + p.height / 2.0)
        .unwrap_or(peers.len());
    let line = if index < peers.len() {
        peers[index].y
    } else if let Some(last) = peers.last() {
        last.y + last.height + GAP
    } else {
        0.0
    };
    (peers, index, line)
}

/// Operation evaluated by [`evaluate_placement`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    /// Catalog insertion.
    Catalog,
    /// Move of an existing view.
    Move,
    /// Swap of two views.
    Swap,
    /// Restoration.
    Restore,
}

/// Why a placement is refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlacementRefusal {
    /// Retired, missing or ineligible for the region.
    Incompatible,
    /// The owner is disabled.
    Paused,
    /// The type already occupies the destination.
    Occupied,
    /// The 16-view cap.
    Limit,
}

impl PlacementRefusal {
    /// `'incompatible' | 'paused' | 'occupied' | 'limit'`.
    pub fn as_str(self) -> &'static str {
        match self {
            PlacementRefusal::Incompatible => "incompatible",
            PlacementRefusal::Paused => "paused",
            PlacementRefusal::Occupied => "occupied",
            PlacementRefusal::Limit => "limit",
        }
    }
}

/// Shared eligibility of catalog, move, swap and restore (`evaluatePlacement`).
pub fn evaluate_placement(
    snapshot: &WorkbenchSnapshot,
    registry: &Registry,
    type_id: &str,
    region: Region,
    operation: Operation,
    ignored: &[&str],
    disabled: &[String],
) -> Result<(), PlacementRefusal> {
    let org = &snapshot.organization;
    let Some(t) = registry.get(type_id) else {
        return Err(PlacementRefusal::Incompatible);
    };
    if t.retired || t.missing || !t.constraint.allows(region) {
        return Err(PlacementRefusal::Incompatible);
    }
    if disabled.contains(&t.owner) {
        return Err(PlacementRefusal::Paused);
    }
    let grouped = org
        .views
        .iter()
        .any(|v| v.type_id == type_id && group_for(snapshot, &v.id).is_some());
    if grouped && operation == Operation::Catalog {
        return Err(PlacementRefusal::Occupied);
    }
    let moving_group = org.groups.as_ref().and_then(|g| {
        g.entries.iter().find(|group| {
            ignored.contains(&group.frame_id.as_str())
                && group.members.iter().any(|id| {
                    org.views
                        .iter()
                        .any(|v| v.id == *id && v.type_id == type_id)
                })
        })
    });
    if let Some(group) = moving_group
        && group.members.iter().any(|id| {
            !registry
                .get(snapshot.type_of(id).expect("group member view"))
                .expect("group member type")
                .constraint
                .allows(region)
        })
    {
        return Err(PlacementRefusal::Incompatible);
    }
    if region != Region::Sidebar
        && t.presence == Presence::SingleView
        && org.views.iter().any(|v| {
            v.type_id == type_id
                && (operation == Operation::Catalog || ignored.contains(&v.id.as_str()))
                && snapshot
                    .placements
                    .iter()
                    .any(|p| p.id == v.id && p.region == Region::Sidebar)
        })
        && org
            .bars
            .iter()
            .any(|b| b.id != org.active_bar && b.members.iter().any(|m| m == type_id))
    {
        return Err(PlacementRefusal::Occupied);
    }
    let existing: Vec<&View> = org
        .views
        .iter()
        .filter(|v| v.type_id == type_id && !ignored.contains(&v.id.as_str()))
        .collect();
    let occupied: Vec<Placement> = surface_placements(snapshot)
        .into_iter()
        .filter(|p| existing.iter().any(|v| v.id == p.id))
        .collect();
    if region == Region::Sidebar && operation == Operation::Catalog {
        let bar = snapshot.active_bar().expect("active bar");
        if bar.members.iter().any(|m| m == type_id) {
            return Err(PlacementRefusal::Occupied);
        }
    } else if occupied.iter().any(|p| p.region == region) {
        return Err(PlacementRefusal::Occupied);
    }
    if operation == Operation::Catalog
        && org.views.len() >= MAX_WIDGETS
        && !existing.iter().any(|v| {
            t.presence == Presence::SingleView || !snapshot.placements.iter().any(|p| p.id == v.id)
        })
    {
        return Err(PlacementRefusal::Limit);
    }
    Ok(())
}
