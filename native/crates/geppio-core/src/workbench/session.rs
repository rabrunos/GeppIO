//! The edit transaction the GPUI host drives, extracted from the renderer's
//! `useTransaction.ts` and `useInteraction.ts` (no React, no DOM):
//!
//! - **draft vs committed**: `committed` is the last confirmed document, the draft is what
//!   the user sees; nothing is persisted implicitly.
//! - **Save** validates, writes with a byte compare-and-swap and advances Cancel's checkpoint
//!   without leaving Edit; **Conclude** does the same and exits; **Cancel** restores the
//!   checkpoint.
//! - **Undo/redo** move between whole intentions; a pointer gesture is one intention.
//! - **Gestures**: pickup → preview frames (each solved from the gesture's starting scene,
//!   so reversal restores it exactly) → commit, drop into another region, or cancel.
use super::codec::{parse_workbench, serialize_workbench};
use super::commands::{
    add_widget as add_command, move_view, reconcile_bar_heights, remove_presence,
};
use super::compositions::{
    SlotIntention, apply_to_draft, available_composition, composition_scene, fill_reservation,
    system_compositions,
};
use super::groups::group_transfer_plan;
use super::history::{EditHistory, format_signature};
use super::model::{
    ApplyMode, Composition, FormatSource, Registry, SessionDraft, SessionSlot, UserBar,
    WorkbenchSnapshot, active_placements, initial_workbench, sidebar_insertion,
    snapshot_constraints,
};
use super::presentations::{panel_ids, validate_presentation_edges};
use crate::freeform::{CodecError, constraints_for, project_region, region_label};
use crate::js;
use crate::layout::{
    AlignedGesture, AlignmentGuide, AlignmentLocks, BlockReason, Budget, Constraints, Gesture,
    PerRegion, Placement, Region, Size, Status, Surface, aligned_gesture, candidate,
    settle_placements,
};

/// Measured inner sizes of the three regions plus Main's expansion option.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SessionSurfaces {
    /// Inner size per region.
    pub sizes: PerRegion<Size>,
    /// Whether Main is horizontally expanded.
    pub expanded: bool,
}

impl SessionSurfaces {
    /// The solver surface of a region.
    pub fn surface(&self, region: Region) -> Surface {
        Surface::of(
            region,
            *self.sizes.get(region),
            self.expanded && region == Region::Main,
        )
    }
}

/// Kind of a pointer gesture (a move or one of the eight resize handles).
pub type GestureKind = Gesture;

/// Regions a picked-up frame may be dropped into (`movementTargets`).
pub type DropZones = Vec<Region>;

/// What became of region chrome an older host kept outside the document.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChromeAdoption {
    /// The document took the values and was saved with them.
    Adopted,
    /// The document already has its own regions (or the values are the defaults): the old
    /// values are stale.
    Kept,
    /// Not now: recovery, a pending normalization, Edit or a refused write. Ask again later.
    Deferred,
}

/// Whether two chromes show the same regions (visibility and size; key order aside).
fn same_regions(a: &super::chrome::WorkbenchChrome, b: &super::chrome::WorkbenchChrome) -> bool {
    let same = |x: &super::chrome::RegionChrome, y: &super::chrome::RegionChrome| {
        x.visible == y.visible && x.size == y.size
    };
    same(&a.sidebar, &b.sidebar) && same(&a.bottom, &b.bottom)
}

/// Why a session operation was refused. The draft is unchanged in every case.
#[derive(Clone, Debug, PartialEq)]
pub enum SessionError {
    /// The operation needs an open edit session.
    NotEditing,
    /// The stored document is in recovery; an explicit preview must be chosen first.
    Recovery,
    /// A gesture is open (save, undo and new gestures wait for it).
    GestureActive,
    /// No gesture is open.
    NoGesture,
    /// The view or placement does not exist.
    UnknownView,
    /// The region cannot fit its content at the current size.
    Infeasible,
    /// The intention is incompatible or has no space.
    Rejected,
    /// Two active panels would share an edge.
    PresentationEdge,
    /// Validation of the document failed.
    Invalid(CodecError),
    /// The stored bytes changed in another session.
    Conflict,
    /// The store failed.
    Storage(String),
}

/// Storage of the `geppio:workbench:v1` bytes (the host's `localStorage` equivalent).
pub trait WorkbenchStore {
    /// The stored bytes, if any.
    fn get(&self) -> Result<Option<String>, String>;
    /// Replaces the stored bytes.
    fn set(&mut self, raw: &str) -> Result<(), String>;
}

/// An in-memory store (tests and previews).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MemoryStore {
    /// Stored bytes.
    pub raw: Option<String>,
}

impl WorkbenchStore for MemoryStore {
    fn get(&self) -> Result<Option<String>, String> {
        Ok(self.raw.clone())
    }
    fn set(&mut self, raw: &str) -> Result<(), String> {
        self.raw = Some(raw.to_owned());
        Ok(())
    }
}

/// One pointer frame of the active gesture.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PointerFrame {
    /// Horizontal CSS-pixel delta from pickup (including scroll changes).
    pub dx: f64,
    /// Vertical CSS-pixel delta from pickup.
    pub dy: f64,
    /// Whether the pointer is over the gesture's own region (alignment only applies there).
    pub over_origin: bool,
}

/// The result of a preview frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Preview {
    /// Valid (the draft shows it) or blocked (the last valid preview is kept).
    pub status: Status,
    /// Why the frame was blocked.
    pub reason: Option<BlockReason>,
    /// The draft placements of the gesture's region after this frame.
    pub placements: Vec<Placement>,
    /// Alignment guides of an accepted snap.
    pub guides: Vec<AlignmentGuide>,
    /// Locks carried into the next frame.
    pub locks: AlignmentLocks,
    /// Regions a move may be dropped into (computed at pickup).
    pub drop_zones: DropZones,
    /// Solver counters of the frame.
    pub states: i64,
    /// Solver probes of the frame.
    pub probes: i64,
}

#[derive(Clone, Debug)]
struct ActiveGesture {
    id: String,
    kind: Gesture,
    original: Placement,
    source_bar: String,
    snapshot: WorkbenchSnapshot,
    source: WorkbenchSnapshot,
    locks: Option<AlignmentLocks>,
    drop_zones: DropZones,
    constraints: Constraints,
}

/// The settled snapshot (`settleSnapshot`).
pub fn settle_snapshot(snapshot: &WorkbenchSnapshot) -> WorkbenchSnapshot {
    let mut next = snapshot.clone();
    settle_placements(&mut next.placements);
    next
}

/// The visible scene the host renders: the active Sidebar stack and every region projected
/// into its measured size; references follow feasible measurements (`App.tsx` `view`).
pub fn project_view(
    snapshot: &WorkbenchSnapshot,
    registry: &Registry,
    surfaces: &SessionSurfaces,
) -> (WorkbenchSnapshot, PerRegion<bool>) {
    let constraints = snapshot_constraints(snapshot, registry);
    let panels = panel_ids(snapshot);
    let visible: Vec<Placement> = active_placements(snapshot, true)
        .into_iter()
        .filter(|p| constraints.get(&p.id).is_some() && !panels.contains(&p.id))
        .collect();
    let project = |region: Region| {
        project_region(
            &visible,
            &snapshot.reference,
            region,
            *surfaces.sizes.get(region),
            surfaces.expanded && region == Region::Main,
            &constraints,
        )
    };
    let projected = PerRegion {
        main: project(Region::Main),
        sidebar: project(Region::Sidebar),
        bottom: project(Region::Bottom),
    };
    let feasible = PerRegion {
        main: projected.main.feasible,
        sidebar: projected.sidebar.feasible,
        bottom: projected.bottom.feasible,
    };
    let mut view = snapshot.clone();
    for p in &mut view.placements {
        if let Some(q) = projected
            .get(p.region)
            .placements
            .iter()
            .find(|q| q.id == p.id)
        {
            *p = q.clone();
        }
    }
    for region in Region::ALL {
        let m = *surfaces.sizes.get(region);
        if *feasible.get(region) && m.width > 0.0 && m.height > 0.0 {
            *view.reference.get_mut(region) = Size::new(
                m.width,
                if region == Region::Sidebar {
                    js::max(m.height, projected.sidebar.world.height)
                } else {
                    m.height
                },
            );
        }
    }
    (view, feasible)
}

/// The edit transaction: committed document, draft, Cancel checkpoint, history and the
/// active pointer gesture. Every method keeps the draft unchanged when it fails.
#[derive(Clone, Debug)]
pub struct EditSession {
    registry: Registry,
    committed: WorkbenchSnapshot,
    observed: Option<String>,
    initial_raw: Option<String>,
    initial_recovery: bool,
    recovery: bool,
    normalization_pending: bool,
    draft: SessionDraft,
    checkpoint: SessionDraft,
    history: EditHistory,
    editing: bool,
    baseline: String,
    gesture: Option<ActiveGesture>,
    message: String,
    demo_fixtures: bool,
}

impl EditSession {
    /// Opens the stored bytes (`readWorkbench` without the legacy freeform choices): no
    /// bytes start the initial workbench; invalid bytes start it in recovery and are kept.
    pub fn open(registry: Registry, stored: Option<&str>, demo_fixtures: bool) -> Self {
        let (snapshot, recovery, message) = match stored {
            None => (
                initial_workbench(demo_fixtures),
                false,
                "Modo de uso · layout livre protegido.",
            ),
            Some(raw) => match parse_workbench(raw, &registry) {
                Ok(snapshot) => (snapshot, false, "Composição protegida."),
                Err(_) => (
                    initial_workbench(false),
                    true,
                    "Composição incompatível, plugin ausente ou armazenamento indisponível. Dados preservados; escolha uma prévia explícita em Configurações.",
                ),
            },
        };
        let normalization_pending = snapshot
            .placements
            .iter()
            .any(|p| p.width != p.preferred.width || p.height != p.preferred.height);
        let snapshot = settle_snapshot(&snapshot);
        let baseline = format_signature(&snapshot, &[]);
        Self {
            registry,
            committed: snapshot.clone(),
            observed: stored.map(str::to_owned),
            initial_raw: stored.map(str::to_owned),
            initial_recovery: recovery,
            recovery,
            normalization_pending,
            draft: SessionDraft::new(snapshot.clone()),
            checkpoint: SessionDraft::new(snapshot),
            history: EditHistory::new(),
            editing: false,
            baseline,
            gesture: None,
            message: message.to_owned(),
            demo_fixtures,
        }
    }

    /// Opens over a stored document that exists but could not be read (too large, invalid
    /// UTF-8, an I/O error): the same recovery as an invalid document, and nothing observed,
    /// so edit stays closed and the file is never replaced.
    pub fn open_unreadable(registry: Registry) -> Self {
        let mut session = Self::open(registry, Some(""), false);
        session.observed = None;
        session.initial_raw = None;
        session
    }

    /// The widget registry.
    pub fn registry(&self) -> &Registry {
        &self.registry
    }
    /// The draft the user sees (equal to the committed document outside Edit).
    pub fn draft(&self) -> &WorkbenchSnapshot {
        &self.draft.snapshot
    }
    /// The last confirmed document.
    pub fn committed(&self) -> &WorkbenchSnapshot {
        &self.committed
    }
    /// The Cancel checkpoint.
    pub fn checkpoint(&self) -> &WorkbenchSnapshot {
        &self.checkpoint.snapshot
    }
    /// The stored bytes this session last observed.
    pub fn stored(&self) -> Option<&str> {
        self.observed.as_deref()
    }
    /// Whether Edit is open.
    pub fn editing(&self) -> bool {
        self.editing
    }
    /// Whether the stored document is in recovery.
    pub fn recovery(&self) -> bool {
        self.recovery
    }
    /// Whether undo is available.
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }
    /// Whether redo is available.
    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }
    /// Whether a pointer gesture is open.
    pub fn gesture_active(&self) -> bool {
        self.gesture.is_some()
    }
    /// Whether the draft's format differs from the checkpoint (`hasPending`).
    pub fn has_pending(&self) -> bool {
        format_signature(&self.draft.snapshot, &self.draft.slots) != self.baseline
    }
    /// The status message (pt-BR) of the last transition, as the reference shows it.
    pub fn message(&self) -> &str {
        &self.message
    }
    /// The visible scene for `surfaces` and each region's feasibility.
    pub fn view(&self, surfaces: &SessionSurfaces) -> (WorkbenchSnapshot, PerRegion<bool>) {
        project_view(&self.draft.snapshot, &self.registry, surfaces)
    }

    fn put(&mut self, next: WorkbenchSnapshot) -> Result<(), SessionError> {
        if validate_presentation_edges(&next).is_err() {
            self.message = String::from(
                "Borda de apresentação ocupada. Mova o outro painel antes de restaurar esta presença.",
            );
            return Err(SessionError::PresentationEdge);
        }
        self.draft.snapshot = next;
        Ok(())
    }

    fn apply(&mut self, draft: SessionDraft) {
        let _ = self.put(draft.snapshot);
        self.draft.slots = draft.slots;
        self.draft.format_id = draft.format_id;
        self.draft.format_mode = draft.format_mode;
        self.draft.format_source = draft.format_source;
        if draft.local.is_some() {
            self.draft.local = draft.local;
        }
    }

    /// One whole intention outside a gesture (`action`).
    fn action(&mut self, next: WorkbenchSnapshot) -> Result<(), SessionError> {
        let after = SessionDraft {
            snapshot: next,
            ..self.draft.clone()
        };
        self.action_draft(after)
    }

    /// One whole intention that may also change slots and the applied format.
    fn action_draft(&mut self, after: SessionDraft) -> Result<(), SessionError> {
        if validate_presentation_edges(&after.snapshot).is_err() {
            self.message = String::from(
                "Borda de apresentação ocupada. Mova o outro painel antes de restaurar esta presença.",
            );
            return Err(SessionError::PresentationEdge);
        }
        let before = self.draft.clone();
        if self.editing && !self.history.active() {
            self.history.record(&before, &after);
        }
        self.apply(after);
        Ok(())
    }

    /// The Cancel checkpoint opened over the committed document (`begin`, `preview`): the
    /// draft's format mode and held widgets carry over; slots and the format do not.
    fn open_checkpoint(&mut self) {
        self.checkpoint = SessionDraft {
            snapshot: self.committed.clone(),
            slots: Vec::new(),
            format_id: None,
            ..self.draft.clone()
        };
    }

    /// Opens Edit from the visible scene (`begin`). The checkpoint is the committed
    /// document; history starts empty.
    pub fn begin(&mut self, surfaces: &SessionSurfaces) -> Result<(), SessionError> {
        if self.recovery && !self.editing {
            return Err(SessionError::Recovery);
        }
        let (view, _) = self.view(surfaces);
        let visible = if panel_ids(&self.draft.snapshot).is_empty() {
            view
        } else {
            self.draft.snapshot.clone()
        };
        if !self.editing {
            self.history.clear();
            self.open_checkpoint();
            self.baseline = format_signature(&settle_snapshot(&visible), &[]);
            self.editing = true;
        }
        let _ = self.put(settle_snapshot(&visible));
        self.message = String::from(
            "Edite a composição. Salvar edição confirma um checkpoint; Concluir encerra a sessão.",
        );
        Ok(())
    }

    fn movement_targets(
        &self,
        gesture: &ActiveGesture,
        surfaces: &SessionSurfaces,
        feasible: &PerRegion<bool>,
    ) -> DropZones {
        let source = gesture
            .snapshot
            .with_active_bar(&self.draft.snapshot.organization.active_bar);
        Region::ALL
            .into_iter()
            .filter(|&region| {
                *feasible.get(region)
                    && ((region == gesture.original.region
                        && (region != Region::Sidebar
                            || gesture.source_bar == source.organization.active_bar))
                        || move_view(
                            &source,
                            &self.registry,
                            &gesture.id,
                            &surfaces.surface(region),
                            None,
                            Some(&gesture.source_bar),
                            None,
                            &[],
                        )
                        .is_some()
                        || self.draft.slots.iter().any(|slot| {
                            slot.region == region
                                && self
                                    .reservation(
                                        &slot.id,
                                        &SlotIntention::Move {
                                            view_id: gesture.id.clone(),
                                            source_bar: gesture.source_bar.clone(),
                                        },
                                        Some(&source),
                                        surfaces,
                                        &[],
                                    )
                                    .is_some()
                        }))
            })
            .collect()
    }

    /// Picks up a frame for a move or a resize (`start`). Returns the drop zones of a move.
    pub fn pickup(
        &mut self,
        id: &str,
        kind: GestureKind,
        surfaces: &SessionSurfaces,
    ) -> Result<DropZones, SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        if self.gesture.is_some() {
            return Err(SessionError::GestureActive);
        }
        if kind == Gesture::Insert {
            return Err(SessionError::Rejected);
        }
        let (view, feasible) = self.view(surfaces);
        let original = view
            .placement(id)
            .cloned()
            .ok_or(SessionError::UnknownView)?;
        if !*feasible.get(original.region) {
            return Err(SessionError::Infeasible);
        }
        self.history.begin(&self.draft);
        let mut gesture = ActiveGesture {
            id: id.to_owned(),
            kind,
            source_bar: self.draft.snapshot.organization.active_bar.clone(),
            snapshot: settle_snapshot(&view),
            source: self.draft.snapshot.clone(),
            locks: None,
            drop_zones: Vec::new(),
            constraints: snapshot_constraints(&self.draft.snapshot, &self.registry),
            original,
        };
        if kind == Gesture::Move {
            gesture.drop_zones = self.movement_targets(&gesture, surfaces, &feasible);
        }
        let zones = gesture.drop_zones.clone();
        self.gesture = Some(gesture);
        Ok(zones)
    }

    /// A move frame of the active gesture.
    pub fn preview_move(
        &mut self,
        frame: PointerFrame,
        surfaces: &SessionSurfaces,
    ) -> Result<Preview, SessionError> {
        match &self.gesture {
            Some(g) if g.kind == Gesture::Move => self.preview(frame, surfaces),
            Some(_) => Err(SessionError::Rejected),
            None => Err(SessionError::NoGesture),
        }
    }

    /// A resize frame of the active gesture.
    pub fn preview_resize(
        &mut self,
        frame: PointerFrame,
        surfaces: &SessionSurfaces,
    ) -> Result<Preview, SessionError> {
        match &self.gesture {
            Some(g) if matches!(g.kind, Gesture::Resize(_)) => self.preview(frame, surfaces),
            Some(_) => Err(SessionError::Rejected),
            None => Err(SessionError::NoGesture),
        }
    }

    fn region_placements(&self, region: Region) -> Vec<Placement> {
        self.draft
            .snapshot
            .placements
            .iter()
            .filter(|p| p.region == region)
            .cloned()
            .collect()
    }

    /// Solves one frame from the gesture's starting scene (`apply`). A blocked frame keeps
    /// the last valid preview.
    pub fn preview(
        &mut self,
        frame: PointerFrame,
        surfaces: &SessionSurfaces,
    ) -> Result<Preview, SessionError> {
        let gesture = self.gesture.clone().ok_or(SessionError::NoGesture)?;
        let (_, feasible) = self.view(surfaces);
        let p = &gesture.original;
        let region = p.region;
        let unchanged = |this: &Self, status: Status, reason: Option<BlockReason>| Preview {
            status,
            reason,
            placements: this.region_placements(region),
            guides: Vec::new(),
            locks: AlignmentLocks::default(),
            drop_zones: gesture.drop_zones.clone(),
            states: 0,
            probes: 0,
        };
        if !*feasible.get(region) {
            return Err(SessionError::Infeasible);
        }
        if region == Region::Sidebar
            && gesture.source_bar != self.draft.snapshot.organization.active_bar
        {
            return Ok(unchanged(self, Status::Valid, None));
        }
        let (dx, dy) = (frame.dx, frame.dy);
        if region == Region::Sidebar {
            // Movement commits at release; only the insertion line follows the pointer.
            let Gesture::Resize(_) = gesture.kind else {
                return Ok(unchanged(self, Status::Valid, None));
            };
            let surface = surfaces.surface(Region::Sidebar);
            let cs = constraints_for(&surface, &gesture.constraints);
            let c = cs.get(&p.id).ok_or(SessionError::UnknownView)?;
            let delta = if gesture.kind.has('n') { -dy } else { dy };
            let height = js::max(c.min.height, js::min(c.max.height, p.height + delta));
            let mut scene = gesture.snapshot.clone();
            for q in &mut scene.placements {
                if q.id == p.id {
                    q.height = height;
                    q.preferred = Size::new(q.width, height);
                }
            }
            return match reconcile_bar_heights(&scene) {
                Some(next) => {
                    let _ = self.put(next);
                    Ok(unchanged(self, Status::Valid, None))
                }
                None => Ok(unchanged(self, Status::Blocked, Some(BlockReason::Space))),
            };
        }
        let surface = surfaces.surface(region);
        let snapshot = &gesture.snapshot;
        let panels = panel_ids(snapshot);
        let peers: Vec<Placement> = snapshot
            .placements
            .iter()
            .filter(|q| q.region == region && !panels.contains(&q.id))
            .cloned()
            .collect();
        let cs = constraints_for(&surface, &gesture.constraints);
        let adapted = (region == Region::Main && snapshot.reference.main.height != surface.height)
            .then(|| {
                project_region(
                    &peers,
                    &snapshot.reference,
                    Region::Main,
                    surface.size(),
                    surface.expanded,
                    &gesture.constraints,
                )
            });
        if adapted.as_ref().is_some_and(|a| !a.feasible) {
            self.message = String::from(
                "Sem espaço para os mínimos deste widget. A última prévia válida foi mantida.",
            );
            if let Some(g) = &mut self.gesture {
                g.locks = None;
            }
            return Ok(unchanged(self, Status::Blocked, Some(BlockReason::Space)));
        }
        let source = adapted.map_or(peers, |a| a.placements);
        // Responsive neighbour fitting cannot change a resize's stable opposite edges.
        let original = if gesture.kind == Gesture::Move {
            source
                .iter()
                .find(|q| q.id == p.id)
                .cloned()
                .ok_or(SessionError::UnknownView)?
        } else {
            p.clone()
        };
        let constraint = cs.get(&p.id).ok_or(SessionError::UnknownView)?;
        let requested = candidate(&original, dx, dy, gesture.kind, &surface, constraint)
            .ok_or(SessionError::Rejected)?;
        let aligned: AlignedGesture = if frame.over_origin {
            aligned_gesture(
                &source,
                &p.id,
                requested,
                &surface,
                &cs,
                gesture.kind,
                gesture.locks.as_ref().unwrap_or(&AlignmentLocks::default()),
                Budget::default(),
            )
        } else {
            AlignedGesture {
                result: crate::layout::reflow(
                    &source,
                    &p.id,
                    requested,
                    &surface,
                    &cs,
                    gesture.kind,
                    Budget::default(),
                ),
                locks: AlignmentLocks::default(),
                guides: Vec::new(),
            }
        };
        let valid = aligned.result.status == Status::Valid;
        if let Some(g) = &mut self.gesture {
            g.locks = (valid && frame.over_origin).then(|| aligned.locks.clone());
        }
        if !valid {
            self.message = String::from(
                "Sem espaço para os mínimos deste widget. A última prévia válida foi mantida.",
            );
            let mut preview = unchanged(self, Status::Blocked, aligned.result.reason);
            preview.states = aligned.result.states;
            preview.probes = aligned.result.probes;
            return Ok(preview);
        }
        let mut next = snapshot.clone();
        next.organization = self.draft.snapshot.organization.clone();
        *next.reference.get_mut(region) = surface.size();
        for q in &mut next.placements {
            if let Some(solved) = aligned.result.placements.iter().find(|s| s.id == q.id) {
                *q = solved.clone();
            }
        }
        let _ = self.put(next);
        self.message = String::from(
            "Prévia válida. Ao soltar, posições e tamanhos serão mantidos para o próximo gesto. Salve ou cancele.",
        );
        Ok(Preview {
            status: Status::Valid,
            reason: None,
            placements: self.region_placements(region),
            guides: if frame.over_origin {
                aligned.guides
            } else {
                Vec::new()
            },
            locks: aligned.locks,
            drop_zones: gesture.drop_zones.clone(),
            states: aligned.result.states,
            probes: aligned.result.probes,
        })
    }

    /// Releases the gesture in its own region: the preview's actual geometry becomes the
    /// next size baseline and the whole gesture is one undoable intention.
    pub fn commit_gesture(&mut self) -> Result<(), SessionError> {
        if self.gesture.take().is_none() {
            return Err(SessionError::NoGesture);
        }
        let settled = settle_snapshot(&self.draft.snapshot);
        if settled != self.draft.snapshot {
            let _ = self.put(settled);
        }
        self.history.finish(&self.draft);
        Ok(())
    }

    /// Opens the history gesture of a catalog drag at its lift (`beginGesture`): a bar
    /// switched by hovering and the drop are then one intention.
    pub fn begin_catalog_drag(&mut self) {
        if self.editing {
            self.history.begin(&self.draft);
        }
    }

    /// Closes a catalog drag: an accepted drop is recorded as one intention, a refused or
    /// cancelled one restores the draft from its lift (`finishGesture` / `cancelGesture`).
    pub fn finish_catalog_drag(&mut self, accepted: bool) {
        if self.gesture.is_some() {
            return;
        }
        if accepted {
            self.history.finish(&self.draft);
        } else if let Some(before) = self.history.abort() {
            self.apply(before);
        }
    }

    /// Hovering a rail bar for 250 ms during a drag makes it the active bar (`hoverBar`).
    /// Returns whether the bar changed; the drag keeps its own source bar.
    pub fn hover_bar(&mut self, bar: &str) -> bool {
        if !self.editing || !self.history.active() {
            return false;
        }
        let org = &self.draft.snapshot.organization;
        if org.active_bar == bar || !org.bars.iter().any(|b| b.id == bar && !b.archived) {
            return false;
        }
        let next = self.draft.snapshot.with_active_bar(bar);
        let _ = self.put(next);
        if let Some(g) = &mut self.gesture {
            g.snapshot = g.snapshot.with_active_bar(bar);
        }
        true
    }

    /// The drop zones of the open move, recomputed for the current active bar.
    pub fn move_zones(&mut self, surfaces: &SessionSurfaces) -> DropZones {
        let Some(gesture) = self.gesture.clone() else {
            return Vec::new();
        };
        if gesture.kind != Gesture::Move {
            return Vec::new();
        }
        let (_, feasible) = self.view(surfaces);
        let zones = self.movement_targets(&gesture, surfaces, &feasible);
        if let Some(g) = &mut self.gesture {
            g.drop_zones = zones.clone();
        }
        zones
    }

    /// Cancels the gesture (Escape, lost capture, changed measurements): the gesture's
    /// source scene is restored and nothing enters history.
    pub fn cancel_gesture(&mut self) -> Result<(), SessionError> {
        let gesture = self.gesture.take().ok_or(SessionError::NoGesture)?;
        if let Some(before) = self.history.abort() {
            self.apply(before);
        }
        let _ = self.put(gesture.source);
        self.message = String::from("Gesto cancelado. A prévia anterior foi restaurada.");
        Ok(())
    }

    /// Drops a picked-up frame into `region` at content coordinates `at`. Another region
    /// transfers from the pre-gesture scene; the Sidebar reinserts at the pointer's y. A
    /// rejected drop restores the gesture source atomically.
    pub fn drop_into(
        &mut self,
        region: Region,
        at: (f64, f64),
        surfaces: &SessionSurfaces,
    ) -> Result<(), SessionError> {
        let gesture = self.gesture.clone().ok_or(SessionError::NoGesture)?;
        if gesture.kind != Gesture::Move
            || (region == gesture.original.region && region != Region::Sidebar)
        {
            return self.commit_gesture();
        }
        let (_, feasible) = self.view(surfaces);
        let active_bar = self.draft.snapshot.organization.active_bar.clone();
        let _ = self.cancel_gesture();
        let result = if region == gesture.original.region {
            let source = gesture.snapshot.with_active_bar(&active_bar);
            move_view(
                &source,
                &self.registry,
                &gesture.id,
                &surfaces.surface(Region::Sidebar),
                Some((0.0, at.1)),
                Some(&gesture.source_bar),
                None,
                &[],
            )
        } else if *feasible.get(region) {
            move_view(
                &gesture.snapshot,
                &self.registry,
                &gesture.id,
                &surfaces.surface(region),
                Some(at),
                Some(&gesture.source_bar),
                None,
                &[],
            )
        } else {
            None
        };
        match result {
            Some(next) => {
                self.action(settle_snapshot(&next))?;
                self.message = if region == gesture.original.region {
                    String::from("Widget inserido na barra lateral. Salve ou cancele.")
                } else {
                    format!(
                        "Widget transferido para {}. Salve ou cancele.",
                        region_label(region)
                    )
                };
                Ok(())
            }
            None if region == gesture.original.region => {
                let _ = self.put(gesture.source.with_active_bar(&active_bar));
                self.message =
                    String::from("Destino incompatível. A composição anterior foi preservada.");
                Err(SessionError::Rejected)
            }
            None => {
                self.message = String::from(
                    match group_transfer_plan(&gesture.source, &self.registry, &gesture.id, region)
                    {
                        Some(plan) => plan.reason.unwrap_or(
                            "Sem espaço para todas as abas elegíveis. Composição preservada.",
                        ),
                        None => {
                            "Transferência incompatível ou sem espaço. A composição anterior foi restaurada."
                        }
                    },
                );
                Err(SessionError::Rejected)
            }
        }
    }

    /// Moves a placed view to `region` outside a gesture: the catalog's move mode
    /// (`transferTo`). A refusal keeps the draft and names the reason.
    pub fn transfer_view(
        &mut self,
        id: &str,
        region: Region,
        at: Option<(f64, f64)>,
        surfaces: &SessionSurfaces,
    ) -> Result<(), SessionError> {
        let preserve = self
            .draft
            .snapshot
            .type_of(id)
            .and_then(|t| self.registry.get(t))
            .is_some_and(|t| t.preserve_normal_geometry);
        if preserve
            && panel_ids(&self.draft.snapshot).iter().any(|p| p == id)
            && self
                .draft
                .snapshot
                .placement(id)
                .is_some_and(|p| p.region != region)
        {
            self.message =
                String::from("Volte a Normal antes de transferir este widget para outra região.");
            return Err(SessionError::Rejected);
        }
        let (view, feasible) = self.view(surfaces);
        if !self.editing || !*feasible.get(region) {
            self.message = String::from(
                "Região sem espaço disponível. Reabra ou amplie a região antes de transferir.",
            );
            return Err(SessionError::Rejected);
        }
        match move_view(
            &settle_snapshot(&view),
            &self.registry,
            id,
            &surfaces.surface(region),
            at,
            None,
            None,
            &[],
        ) {
            Some(next) => {
                self.action(settle_snapshot(&next))?;
                self.message = format!(
                    "Widget transferido para {} na prévia. Salve ou cancele.",
                    region_label(region)
                );
                Ok(())
            }
            None => {
                self.message = format!(
                    "Transferência para {} incompatível ou sem espaço para os mínimos. Composição preservada.",
                    region_label(region)
                );
                Err(SessionError::Rejected)
            }
        }
    }

    /// The Sidebar insertion line for a drop at content y (drag feedback).
    pub fn sidebar_insertion_line(&self, y: f64) -> f64 {
        let id = self.gesture.as_ref().map(|g| g.id.as_str());
        let baseline = self
            .gesture
            .as_ref()
            .map_or(&self.draft.snapshot, |g| &g.snapshot)
            .with_active_bar(&self.draft.snapshot.organization.active_bar);
        sidebar_insertion(&baseline, id, y).2
    }

    /// Removes one presence after the host confirmed it (`removePresence` through `action`):
    /// one whole intention, undoable while editing.
    pub fn remove_view(&mut self, id: &str) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        if self.gesture.is_some() {
            return Err(SessionError::GestureActive);
        }
        if self.draft.snapshot.placement(id).is_none() {
            return Err(SessionError::UnknownView);
        }
        let next = remove_presence(&self.draft.snapshot, id, Some(&self.registry));
        self.action(settle_snapshot(&next))
    }

    /// Steps back one whole intention.
    pub fn undo(&mut self) -> bool {
        match self.history.undo(&self.draft) {
            Some(previous) => {
                self.apply(previous);
                true
            }
            None => false,
        }
    }

    /// Steps forward one whole intention.
    pub fn redo(&mut self) -> bool {
        match self.history.redo(&self.draft) {
            Some(next) => {
                self.apply(next);
                true
            }
            None => false,
        }
    }

    /// Adds a catalog widget to `region` at content coordinates `at` (`add`).
    pub fn add_widget(
        &mut self,
        type_id: &str,
        region: Region,
        at: Option<(f64, f64)>,
        surfaces: &SessionSurfaces,
        disabled: &[String],
    ) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        if !panel_ids(&self.draft.snapshot).is_empty() && region == Region::Main {
            return Err(SessionError::Rejected);
        }
        let (view, _) = self.view(surfaces);
        match add_command(
            &view,
            &self.registry,
            type_id,
            &surfaces.surface(region),
            at,
            disabled,
            None,
        ) {
            Some(next) => self.action(next),
            None => {
                self.message = String::from("Widget incompatível ou sem espaço nesta área.");
                Err(SessionError::Rejected)
            }
        }
    }

    fn commit(
        &mut self,
        next: WorkbenchSnapshot,
        conclude: bool,
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        self.commit_with(next, conclude, store, None)
    }

    /// Opens Edit on a previewed scene without touching the stored document (`preview`):
    /// Save adopts it and leaves recovery; Cancel keeps the previous data (and recovery).
    pub fn preview_scene(&mut self, next: WorkbenchSnapshot, message: &str) {
        self.gesture = None;
        self.history.clear();
        self.open_checkpoint();
        self.baseline = format_signature(&self.committed, &[]);
        let next =
            super::retirement::retire_demo_views(next.clone(), &self.registry).unwrap_or(next);
        let _ = self.put(settle_snapshot(&next));
        self.editing = true;
        self.message = message.to_owned();
    }

    /// Settings "Importar layout" (`importFile`): a workbench envelope or a freeform layout
    /// opens in the preview; Save adopts it without touching the original file. Returns
    /// whether the preview opened.
    pub fn import_preview(&mut self, text: &str) -> bool {
        if self.editing {
            self.message = String::from("Conclua ou cancele a edição antes de importar.");
            return false;
        }
        if text.len() > crate::layout::policy::MAX_BYTES {
            self.message = String::from("A composição deve ter até 64 KiB.");
            return false;
        }
        let next = match parse_workbench(text, &self.registry) {
            Ok(snapshot) => snapshot,
            Err(_) => match crate::freeform::schema::parse_freeform(text) {
                Ok(layout) => super::model::adopt_layout(&layout),
                Err(_) => {
                    self.message =
                        String::from("Arquivo incompatível. Dados anteriores preservados.");
                    return false;
                }
            },
        };
        self.preview_scene(
            next,
            "Composição importada na prévia. Salvar adota sem alterar originais.",
        );
        true
    }

    /// The initial-composition preview of Settings (`resetPreview`).
    pub fn reset_preview(&mut self, demo_fixtures: bool) {
        let next = super::retirement::reset_workbench(&self.draft.snapshot, demo_fixtures);
        self.preview_scene(
            next,
            "Composição inicial na prévia. Salvar confirma; Cancelar preserva os dados anteriores.",
        );
    }

    /// Creates or edits a bar from the bar form (`saveBar` in `App.tsx`). Inside Edit it is
    /// one more intention on the displayed scene; outside it is saved at once, only on a
    /// clean committed document. The bar's members are placed in the Sidebar surface.
    pub fn save_bar(
        &mut self,
        bar: &UserBar,
        surfaces: &SessionSurfaces,
        disabled: &[String],
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        let surface = &surfaces.surface(Region::Sidebar);
        if self.editing {
            let base = if panel_ids(&self.draft.snapshot).is_empty() {
                self.view(surfaces).0
            } else {
                self.draft.snapshot.clone()
            };
            let Some(next) =
                super::commands::configure_bar(&base, &self.registry, bar, surface, disabled)
            else {
                self.message = String::from("Widget incompatível ou sem espaço nesta barra.");
                return Err(SessionError::Rejected);
            };
            return self.action(next);
        }
        if self.normalization_pending {
            self.message = String::from(
                "Confirme a composição em Editar antes de alterar as barras. Os dados anteriores foram preservados.",
            );
            return Err(SessionError::Rejected);
        }
        if self.recovery || self.draft.snapshot != self.committed {
            return Err(SessionError::Rejected);
        }
        let Some(next) =
            super::commands::configure_bar(&self.committed, &self.registry, bar, surface, disabled)
        else {
            self.message = String::from(
                "Barra incompatível ou sem espaço. Os dados anteriores foram preservados.",
            );
            return Err(SessionError::Rejected);
        };
        self.commit_with(next, false, store, Some("Barra salva."))
    }

    /// Commits an organization change (bars). Inside Edit it is one more whole intention;
    /// outside it is saved at once unless recovery or a pending normalization holds the
    /// document, and only when the placements are unchanged (`commitOrganization`).
    pub fn commit_organization(
        &mut self,
        next: WorkbenchSnapshot,
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        if self.editing {
            return self.action(next);
        }
        if self.normalization_pending {
            self.message = String::from(
                "Confirme a composição em Editar antes de alterar as barras. Os dados anteriores foram preservados.",
            );
            return Err(SessionError::Rejected);
        }
        if self.recovery {
            self.message =
                String::from("Escolha e confirme uma prévia explícita antes de alterar as barras.");
            return Err(SessionError::Recovery);
        }
        if next.placements != self.committed.placements {
            return Err(SessionError::Rejected);
        }
        self.commit_with(next, false, store, Some("Preferência salva."))
    }

    fn commit_with(
        &mut self,
        next: WorkbenchSnapshot,
        conclude: bool,
        store: &mut dyn WorkbenchStore,
        success: Option<&str>,
    ) -> Result<(), SessionError> {
        let validated = self.persist(next, store)?;
        self.normalization_pending = false;
        let retain_slots = !conclude;
        self.checkpoint = SessionDraft {
            snapshot: validated.clone(),
            ..self.draft.clone()
        };
        self.baseline = format_signature(
            &validated,
            if retain_slots { &self.draft.slots } else { &[] },
        );
        let _ = self.put(validated);
        self.recovery = false;
        if !retain_slots {
            self.draft.slots.clear();
            self.draft.format_id = None;
            self.draft.format_mode = None;
            self.draft.format_source = None;
        }
        if conclude {
            self.editing = false;
            self.history.clear();
        }
        self.message = String::from(success.unwrap_or(if conclude {
            "Composição salva. Edição concluída."
        } else {
            "Edição salva. O checkpoint de Cancelar foi atualizado."
        }));
        Ok(())
    }

    /// Validates `next`, checks the stored bytes are the ones observed and writes it.
    fn persist(
        &mut self,
        next: WorkbenchSnapshot,
        store: &mut dyn WorkbenchStore,
    ) -> Result<WorkbenchSnapshot, SessionError> {
        if self.history.active() || self.gesture.is_some() {
            return Err(SessionError::GestureActive);
        }
        let settled = settle_snapshot(&next);
        let validated = serialize_workbench(&settled, &self.registry)
            .and_then(|raw| parse_workbench(&raw, &self.registry))
            .map_err(|e| {
                self.message = String::from("Composição inválida ou sem espaço. A prévia e os dados salvos foram preservados.");
                SessionError::Invalid(e)
            })?;
        let raw = serialize_workbench(&validated, &self.registry).map_err(SessionError::Invalid)?;
        let current = store.get().map_err(|e| {
            self.message = String::from(
                "Não foi possível salvar. A prévia e todos os dados anteriores foram preservados.",
            );
            SessionError::Storage(e)
        })?;
        if current != self.observed {
            self.message = String::from(
                "A composição salva mudou em outra sessão. Sua prévia foi mantida; reabra para recuperar.",
            );
            return Err(SessionError::Conflict);
        }
        store.set(&raw).map_err(|e| {
            self.message = String::from(
                "Não foi possível salvar. A prévia e todos os dados anteriores foram preservados.",
            );
            SessionError::Storage(e)
        })?;
        self.observed = Some(raw);
        self.committed = validated.clone();
        Ok(validated)
    }

    fn save_target(&self, surfaces: &SessionSurfaces) -> Result<WorkbenchSnapshot, SessionError> {
        let (view, feasible) = self.view(surfaces);
        let constraints = snapshot_constraints(&self.draft.snapshot, &self.registry);
        let panels = panel_ids(&self.draft.snapshot);
        let visible: Vec<Placement> = active_placements(&self.draft.snapshot, true)
            .into_iter()
            .filter(|p| constraints.get(&p.id).is_some() && !panels.contains(&p.id))
            .collect();
        if Region::ALL
            .into_iter()
            .any(|r| !*feasible.get(r) && visible.iter().any(|p| p.region == r))
        {
            return Err(SessionError::Infeasible);
        }
        if !panel_ids(&self.draft.snapshot).is_empty() {
            return Ok(self.draft.snapshot.clone());
        }
        let mut next = view;
        next.organization = self.draft.snapshot.organization.clone();
        Ok(self.with_organization(next))
    }

    /// While a format is applied, saving adopts displayed geometry only in its regions
    /// (`withOrganization`).
    fn with_organization(&self, next: WorkbenchSnapshot) -> WorkbenchSnapshot {
        let Some(item) = self
            .draft
            .format_id
            .as_deref()
            .and_then(|id| self.composition(id))
        else {
            return next;
        };
        let mut live = self.draft.snapshot.clone();
        live.organization = next.organization.clone();
        composition_scene(&live, &next, &item.scopes)
    }

    /// Saves the visible draft and advances Cancel's checkpoint without leaving Edit.
    pub fn save(
        &mut self,
        surfaces: &SessionSurfaces,
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        let next = match self.save_target(surfaces) {
            Ok(next) => next,
            Err(e) => {
                self.message =
                    String::from("Espaço insuficiente. Amplie a região antes de salvar.");
                return Err(e);
            }
        };
        self.commit(next, false, store)
    }

    /// Saves the visible draft and closes Edit.
    pub fn conclude(
        &mut self,
        surfaces: &SessionSurfaces,
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        let next = match self.save_target(surfaces) {
            Ok(next) => next,
            Err(e) => {
                self.message =
                    String::from("Espaço insuficiente. Amplie a região antes de salvar.");
                return Err(e);
            }
        };
        self.commit(next, true, store)
    }

    /// Leaves Edit and restores the last confirmed checkpoint.
    pub fn cancel(&mut self) {
        self.gesture = None;
        self.history.clear();
        let restored = SessionDraft {
            snapshot: self.checkpoint.snapshot.clone(),
            slots: Vec::new(),
            format_id: None,
            format_mode: self.checkpoint.format_mode,
            format_source: None,
            local: self.checkpoint.local.clone(),
        };
        self.apply(restored);
        self.editing = false;
        self.recovery = self.initial_recovery && self.observed == self.initial_raw;
        self.message = String::from("Edição cancelada. Último checkpoint confirmado restaurado.");
    }

    /// Whether the opened document still needs an explicit confirmation of normalized sizes.
    pub fn normalization_pending(&self) -> bool {
        self.normalization_pending
    }

    /// The host's session-local state as it serialized it (`localState`).
    pub fn local(&self) -> Option<&str> {
        self.draft.local.as_deref()
    }

    /// A change of the host's local state (`changeLocal`): one intention inside Edit (undo,
    /// redo and Cancel restore it), applied as is outside. The host applies what
    /// [`Self::local`] returns after undo, redo and Cancel.
    pub fn change_local(&mut self, local: String) {
        let before = self.draft.clone();
        let after = SessionDraft {
            local: Some(local),
            ..self.draft.clone()
        };
        if self.editing && !self.history.active() {
            self.history.record(&before, &after);
        }
        self.apply(after);
    }

    /// Adopts region chrome kept by an older host outside the document (native
    /// `preferences.json` up to alpha.104) when the document still shows the default
    /// regions, and saves it at once so the old values can be dropped. The session message
    /// is left as it was.
    pub fn adopt_initial_chrome(
        &mut self,
        chrome: super::chrome::WorkbenchChrome,
        store: &mut dyn WorkbenchStore,
    ) -> ChromeAdoption {
        if self.editing || self.recovery || self.normalization_pending {
            return ChromeAdoption::Deferred;
        }
        let default = super::chrome::default_chrome();
        if !same_regions(&self.committed.organization.chrome, &default)
            || same_regions(&chrome, &default)
        {
            return ChromeAdoption::Kept;
        }
        let mut next = self.committed.clone();
        for (to, from) in [
            (&mut next.organization.chrome.sidebar, chrome.sidebar),
            (&mut next.organization.chrome.bottom, chrome.bottom),
        ] {
            to.visible = from.visible;
            to.size = from.size;
        }
        let message = self.message.clone();
        let result = self.commit_with(next, false, store, None);
        self.message = message;
        match result {
            Ok(()) => ChromeAdoption::Adopted,
            Err(_) => ChromeAdoption::Deferred,
        }
    }

    /// Whether the demo fixtures (and their presets) are enabled.
    pub fn demo_fixtures(&self) -> bool {
        self.demo_fixtures
    }
    /// The reserved format slots of the draft.
    pub fn slots(&self) -> &[SessionSlot] {
        &self.draft.slots
    }
    /// The applied composition, if any.
    pub fn format_id(&self) -> Option<&str> {
        self.draft.format_id.as_deref()
    }
    /// How the applied composition was applied.
    pub fn format_mode(&self) -> Option<ApplyMode> {
        self.draft.format_mode
    }
    /// The widgets an emptied format holds aside.
    pub fn format_source(&self) -> Option<&FormatSource> {
        self.draft.format_source.as_ref()
    }

    /// The library: the presets, then the saved records with retired views removed.
    pub fn compositions(&self) -> Vec<Composition> {
        system_compositions(self.demo_fixtures)
            .into_iter()
            .chain(
                self.draft
                    .snapshot
                    .organization
                    .compositions
                    .iter()
                    .map(|c| available_composition(c, &self.registry)),
            )
            .collect()
    }
    /// A library entry by identity.
    pub fn composition(&self, id: &str) -> Option<Composition> {
        self.compositions().into_iter().find(|c| c.id == id)
    }

    /// The library's "Formato" / "Widgets" (`applyLocal`), one undoable intention. A
    /// portable record's widgets are applied with the candidate `resolve_portable_widgets`
    /// returns.
    pub fn apply_composition(
        &mut self,
        item: &Composition,
        mode: ApplyMode,
        surfaces: &SessionSurfaces,
    ) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        if self.history.active() || self.gesture.is_some() {
            return Err(SessionError::GestureActive);
        }
        if item.portable.is_some() && (mode == ApplyMode::Widgets || !self.can_import_composition())
        {
            return Err(SessionError::Rejected);
        }
        let (view, _) = self.view(surfaces);
        match apply_to_draft(&self.draft, &view, &self.registry, item, mode) {
            Ok(after) => self.action_draft(after),
            Err(message) => {
                self.message = message.to_owned();
                Err(SessionError::Rejected)
            }
        }
    }

    /// Library metadata (favorites, default, order, deletion) as one more intention.
    pub fn edit_action(&mut self, next: WorkbenchSnapshot) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        self.action(next)
    }

    fn reservation(
        &self,
        id: &str,
        intention: &SlotIntention,
        baseline: Option<&WorkbenchSnapshot>,
        surfaces: &SessionSurfaces,
        disabled: &[String],
    ) -> Option<(WorkbenchSnapshot, Vec<SessionSlot>)> {
        let stored = self.draft.slots.iter().find(|s| s.id == id)?;
        if !self.editing
            || (!panel_ids(&self.draft.snapshot).is_empty() && stored.region == Region::Main)
        {
            return None;
        }
        let view;
        let baseline = match baseline {
            Some(b) => b,
            None => {
                view = self.view(surfaces).0;
                &view
            }
        };
        fill_reservation(
            baseline,
            &self.registry,
            &self.draft.slots,
            id,
            &surfaces.surface(stored.region),
            intention,
            disabled,
        )
    }

    /// Whether a reserved slot accepts the intention (`reserve` without commit).
    pub fn slot_accepts(
        &self,
        id: &str,
        intention: &SlotIntention,
        surfaces: &SessionSurfaces,
        disabled: &[String],
    ) -> bool {
        self.reservation(id, intention, None, surfaces, disabled)
            .is_some()
    }

    /// Fills a reserved slot by click or drop (`reserve`): one intention. `baseline` is the
    /// scene a gesture started from (the displayed scene otherwise).
    pub fn fill_slot(
        &mut self,
        id: &str,
        intention: &SlotIntention,
        baseline: Option<&WorkbenchSnapshot>,
        surfaces: &SessionSurfaces,
        disabled: &[String],
    ) -> Result<(), SessionError> {
        // A catalog drag keeps the history gesture open: the fill joins its intention.
        if self.gesture.is_some() {
            return Err(SessionError::GestureActive);
        }
        let (snapshot, slots) = self
            .reservation(id, intention, baseline, surfaces, disabled)
            .ok_or(SessionError::Rejected)?;
        self.action_draft(SessionDraft {
            snapshot,
            slots,
            ..self.draft.clone()
        })?;
        self.message = String::from("Espaço preenchido. Salve ou cancele.");
        Ok(())
    }

    /// Unsaved format or library changes that an import must save first
    /// (`pendingImportCheckpoint`).
    pub fn pending_import_checkpoint(&self) -> bool {
        let library = |d: &SessionDraft| {
            let o = &d.snapshot.organization;
            (
                o.compositions.clone(),
                o.composition_order.clone(),
                o.favorites.clone(),
                o.default_composition.clone(),
                d.local.clone(),
            )
        };
        self.normalization_pending
            || self.has_pending()
            || library(&self.draft) != library(&self.checkpoint)
    }
    /// A record as last saved (`savedComposition`).
    pub fn saved_composition(&self, id: &str) -> Option<&Composition> {
        self.committed
            .organization
            .compositions
            .iter()
            .find(|c| c.id == id)
    }
    /// Whether the library may import, export or apply a portable record now
    /// (`canImportComposition`).
    pub fn can_import_composition(&self) -> bool {
        self.editing && !self.recovery && !self.history.active() && self.gesture.is_none()
    }

    /// "Salvar atual" (`saveComposition`): saves the draft with the new record and records
    /// the save as one intention.
    pub fn save_composition(
        &mut self,
        record: Composition,
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        if !self.editing {
            return Err(SessionError::NotEditing);
        }
        let before = self.draft.clone();
        let mut next = self.draft.snapshot.clone();
        next.organization.compositions.push(record);
        self.commit_with(next, false, store, Some("Composição salva."))?;
        self.history.record(&before, &self.draft);
        Ok(())
    }

    /// An imported record (`saveImportedComposition`): only the library of the stored
    /// document, the checkpoint and the draft gain it; projections, slots and the rest of the
    /// draft are preserved.
    pub fn save_imported_composition(
        &mut self,
        record: Composition,
        store: &mut dyn WorkbenchStore,
    ) -> Result<(), SessionError> {
        if !self.can_import_composition() || self.pending_import_checkpoint() {
            return Err(SessionError::Rejected);
        }
        let before = self.draft.clone();
        let mut next = self.committed.clone();
        next.organization.compositions.push(record.clone());
        self.persist(next, store)?;
        self.checkpoint
            .snapshot
            .organization
            .compositions
            .push(record.clone());
        let mut draft = self.draft.snapshot.clone();
        draft.organization.compositions.push(record);
        let _ = self.put(draft);
        self.message = String::from("Composição importada.");
        self.history.record(&before, &self.draft);
        Ok(())
    }
}
