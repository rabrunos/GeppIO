//! The host workbench (`src/geppio/src/shared/workbench/`): registry, the persisted
//! envelope, edit commands, whole-intention history and the edit transaction.
#![warn(missing_docs)]
pub mod chrome;
pub mod codec;
pub mod commands;
pub mod groups;
pub mod history;
pub mod model;
pub mod portable;
pub mod presentations;
pub mod retirement;
pub mod session;

pub use chrome::{ChromePatch, ChromeRegion, RegionChrome, WorkbenchChrome, default_chrome};
pub use codec::{parse_workbench, serialize_workbench, snapshot_json};
pub use commands::{
    ResizePair, add_widget, configure_bar, delete_bar, fit_targets, move_view,
    reconcile_bar_heights, remove_presence, reorder_bar, resize_pair, swap_views, update_bar,
};
pub use history::{EditHistory, draft_json, format_signature};
pub use model::{
    Composition, CompositionMode, DemoArchive, FormatSlot, HOME, InstalledPlugin, Organization,
    PluginWidget, Positions, Presence, Registry, SessionDraft, SessionSlot, UserBar, View,
    WORKBENCH_KEY, WidgetGroup, WidgetGroups, WidgetType, WorkbenchSnapshot, active_placements,
    adopt_layout, demo_types, initial_workbench, snapshot_constraints, widget_registry,
};
pub use presentations::{Edge, Presentation, Presentations, WidgetPresentation};
pub use session::{
    DropZones, EditSession, GestureKind, MemoryStore, PointerFrame, Preview, SessionError,
    SessionSurfaces, WorkbenchStore, project_view, settle_snapshot,
};
