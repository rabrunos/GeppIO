//! Layout value types (`types.ts`). Geometry is in CSS pixels; fractional values are
//! intentional and there is no cell topology.

/// A width and height in CSS pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Size {
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

impl Size {
    /// A size.
    pub const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
    /// The extent along an axis (`width` for x, `height` for y).
    pub fn along(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => self.width,
            Axis::Y => self.height,
        }
    }
    /// Mutable extent along an axis.
    pub fn along_mut(&mut self, axis: Axis) -> &mut f64 {
        match axis {
            Axis::X => &mut self.width,
            Axis::Y => &mut self.height,
        }
    }
}

/// A rectangle in CSS pixels (`Rect` in the reference).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Bounds {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

impl Bounds {
    /// A rectangle.
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
    /// The start coordinate along an axis.
    pub fn start(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => self.x,
            Axis::Y => self.y,
        }
    }
    /// The extent along an axis.
    pub fn extent(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => self.width,
            Axis::Y => self.height,
        }
    }
    /// Mutable start coordinate along an axis.
    pub fn start_mut(&mut self, axis: Axis) -> &mut f64 {
        match axis {
            Axis::X => &mut self.x,
            Axis::Y => &mut self.y,
        }
    }
    /// Mutable extent along an axis.
    pub fn extent_mut(&mut self, axis: Axis) -> &mut f64 {
        match axis {
            Axis::X => &mut self.width,
            Axis::Y => &mut self.height,
        }
    }
    /// The size of the rectangle.
    pub fn size(&self) -> Size {
        Size::new(self.width, self.height)
    }
}

/// A geometric axis.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Axis {
    /// Horizontal.
    X,
    /// Vertical.
    Y,
}

impl Axis {
    /// `"x"` or `"y"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Axis::X => "x",
            Axis::Y => "y",
        }
    }
    /// The orthogonal axis.
    pub fn cross(self) -> Axis {
        match self {
            Axis::X => Axis::Y,
            Axis::Y => Axis::X,
        }
    }
    /// Parses `"x"` or `"y"`.
    pub fn parse(value: &str) -> Option<Axis> {
        match value {
            "x" => Some(Axis::X),
            "y" => Some(Axis::Y),
            _ => None,
        }
    }
}

/// A workbench region.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Region {
    /// The Main workspace.
    Main,
    /// The docked Sidebar (x fixed at 0, follows the inner width).
    Sidebar,
    /// The Bottom tray (y fixed at 0, follows the inner height).
    Bottom,
}

impl Region {
    /// `REGIONS`, in reference order.
    pub const ALL: [Region; 3] = [Region::Main, Region::Sidebar, Region::Bottom];
    /// The serialized name.
    pub fn as_str(self) -> &'static str {
        match self {
            Region::Main => "main",
            Region::Sidebar => "sidebar",
            Region::Bottom => "bottom",
        }
    }
    /// Parses a serialized name.
    pub fn parse(value: &str) -> Option<Region> {
        match value {
            "main" => Some(Region::Main),
            "sidebar" => Some(Region::Sidebar),
            "bottom" => Some(Region::Bottom),
            _ => None,
        }
    }
    /// Index in [`Region::ALL`].
    pub fn index(self) -> usize {
        self as usize
    }
}

/// A resize handle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Direction {
    /// North (top edge).
    N,
    /// East (right edge).
    E,
    /// South (bottom edge).
    S,
    /// West (left edge).
    W,
    /// North-east corner.
    Ne,
    /// North-west corner.
    Nw,
    /// South-east corner.
    Se,
    /// South-west corner.
    Sw,
}

impl Direction {
    /// `DIRECTIONS`, in reference order.
    pub const ALL: [Direction; 8] = [
        Direction::N,
        Direction::E,
        Direction::S,
        Direction::W,
        Direction::Ne,
        Direction::Nw,
        Direction::Se,
        Direction::Sw,
    ];
    /// The serialized name (`"n"`, `"ne"`, …).
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::N => "n",
            Direction::E => "e",
            Direction::S => "s",
            Direction::W => "w",
            Direction::Ne => "ne",
            Direction::Nw => "nw",
            Direction::Se => "se",
            Direction::Sw => "sw",
        }
    }
    /// Parses a serialized name.
    pub fn parse(value: &str) -> Option<Direction> {
        Direction::ALL.into_iter().find(|d| d.as_str() == value)
    }
    /// Whether the handle moves a horizontal edge (`/[ew]/`).
    pub fn horizontal(self) -> bool {
        self.as_str().contains(['e', 'w'])
    }
    /// Whether the handle moves a vertical edge (`/[ns]/`).
    pub fn vertical(self) -> bool {
        self.as_str().contains(['n', 's'])
    }
}

/// The kind of a geometry intention.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Gesture {
    /// Move without resizing.
    Move,
    /// Insertion of a new active rectangle (catalog/transfer fallback).
    Insert,
    /// Resize from a handle; the opposite edges stay anchored.
    Resize(Direction),
}

impl Gesture {
    /// The reference's string form (`'move' | 'insert' | Direction`). Several reference
    /// predicates test characters of this string, so the port does the same.
    pub fn name(self) -> &'static str {
        match self {
            Gesture::Move => "move",
            Gesture::Insert => "insert",
            Gesture::Resize(d) => d.as_str(),
        }
    }
    /// `kind.includes(c)`.
    pub fn has(self, c: char) -> bool {
        self.name().contains(c)
    }
    /// Parses `'move'`, `'insert'` or a direction.
    pub fn parse(value: &str) -> Option<Gesture> {
        match value {
            "move" => Some(Gesture::Move),
            "insert" => Some(Gesture::Insert),
            other => Direction::parse(other).map(Gesture::Resize),
        }
    }
}

/// A placed widget frame: actual geometry plus the preferred (automatic baseline) size.
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    /// View identity.
    pub id: String,
    /// Owning region.
    pub region: Region,
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
    /// Preferred size that recovery restores when space allows.
    pub preferred: Size,
}

impl Placement {
    /// A placement whose preferred size equals its actual size.
    pub fn new(id: impl Into<String>, region: Region, bounds: Bounds) -> Self {
        Self {
            id: id.into(),
            region,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            preferred: bounds.size(),
        }
    }
    /// The actual rectangle.
    pub fn bounds(&self) -> Bounds {
        Bounds::new(self.x, self.y, self.width, self.height)
    }
    /// Replaces the actual rectangle.
    pub fn set_bounds(&mut self, b: Bounds) {
        self.x = b.x;
        self.y = b.y;
        self.width = b.width;
        self.height = b.height;
    }
    /// This placement with another rectangle.
    pub fn with_bounds(&self, b: Bounds) -> Self {
        let mut next = self.clone();
        next.set_bounds(b);
        next
    }
    /// The actual size.
    pub fn size(&self) -> Size {
        Size::new(self.width, self.height)
    }
    /// Start coordinate along an axis.
    pub fn start(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => self.x,
            Axis::Y => self.y,
        }
    }
    /// Extent along an axis.
    pub fn extent(&self, axis: Axis) -> f64 {
        match axis {
            Axis::X => self.width,
            Axis::Y => self.height,
        }
    }
}

/// Per-region values in [`Region::ALL`] order.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PerRegion<T> {
    /// Main.
    pub main: T,
    /// Sidebar.
    pub sidebar: T,
    /// Bottom.
    pub bottom: T,
}

impl<T> PerRegion<T> {
    /// The value for a region.
    pub fn get(&self, region: Region) -> &T {
        match region {
            Region::Main => &self.main,
            Region::Sidebar => &self.sidebar,
            Region::Bottom => &self.bottom,
        }
    }
    /// The mutable value for a region.
    pub fn get_mut(&mut self, region: Region) -> &mut T {
        match region {
            Region::Main => &mut self.main,
            Region::Sidebar => &mut self.sidebar,
            Region::Bottom => &mut self.bottom,
        }
    }
}

/// Recorded inner reference size of each region (`References`).
pub type References = PerRegion<Size>;

/// Declared sizing contract of a widget type or view (`Constraint`). `overflow` is always
/// `'auto'` and `responsive` always `'region'`, so they are not represented.
#[derive(Clone, Debug, PartialEq)]
pub struct Constraint {
    /// Minimum size.
    pub min: Size,
    /// Default size of a new placement.
    pub default: Size,
    /// Maximum size.
    pub max: Size,
    /// Whether the width may change.
    pub resize_x: bool,
    /// Whether the height may change.
    pub resize_y: bool,
    /// Bundled host responsive minima per region (`regionMin`).
    pub region_min: PerRegion<Option<Size>>,
    /// Eligible regions.
    pub regions: Vec<Region>,
}

impl Constraint {
    /// Whether the region is eligible.
    pub fn allows(&self, region: Region) -> bool {
        self.regions.contains(&region)
    }
}

/// Constraints keyed by view identity, in insertion order (`Constraints`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Constraints {
    entries: Vec<(String, Constraint)>,
}

impl Constraints {
    /// An empty map.
    pub fn new() -> Self {
        Self::default()
    }
    /// The constraint of an identity.
    pub fn get(&self, id: &str) -> Option<&Constraint> {
        self.entries.iter().find(|(k, _)| k == id).map(|(_, c)| c)
    }
    /// Inserts or replaces (keeping the first position, like `Object.fromEntries`).
    pub fn insert(&mut self, id: impl Into<String>, constraint: Constraint) {
        let id = id.into();
        match self.entries.iter_mut().find(|(k, _)| *k == id) {
            Some(slot) => slot.1 = constraint,
            None => self.entries.push((id, constraint)),
        }
    }
    /// Entries in order.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &Constraint)> {
        self.entries.iter().map(|(k, c)| (k.as_str(), c))
    }
    /// Maps every constraint, keeping identities and order.
    pub fn map(&self, f: impl Fn(&Constraint) -> Constraint) -> Self {
        Self {
            entries: self
                .entries
                .iter()
                .map(|(k, c)| (k.clone(), f(c)))
                .collect(),
        }
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

impl FromIterator<(String, Constraint)> for Constraints {
    fn from_iter<I: IntoIterator<Item = (String, Constraint)>>(iter: I) -> Self {
        let mut out = Self::new();
        for (k, c) in iter {
            out.insert(k, c);
        }
        out
    }
}

/// A measured region surface: inner size plus Main's horizontal expansion option.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Surface {
    /// Region.
    pub region: Region,
    /// Inner width.
    pub width: f64,
    /// Inner height.
    pub height: f64,
    /// Whether Main is horizontally expanded (ignored for other regions by the limit).
    pub expanded: bool,
}

impl Surface {
    /// A surface.
    pub const fn new(region: Region, width: f64, height: f64, expanded: bool) -> Self {
        Self {
            region,
            width,
            height,
            expanded,
        }
    }
    /// A surface of a region's recorded reference size.
    pub fn of(region: Region, size: Size, expanded: bool) -> Self {
        Self::new(region, size.width, size.height, expanded)
    }
    /// The surface size.
    pub fn size(&self) -> Size {
        Size::new(self.width, self.height)
    }
}
